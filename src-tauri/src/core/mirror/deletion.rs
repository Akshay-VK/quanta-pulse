//! Frozen, retryable scopes for deleting explicitly saved mirror files.
//!
//! Scopes are process-local and expire after ten minutes unless they hold
//! staged recovery bytes; recovery records remain reachable until resolved. A
//! restart or expiry requires a fresh confirmation rather than silently
//! widening a retry to include newly published files.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Serialize;
use uuid::Uuid;

use crate::db::{self, MirrorDeleteFile};

use super::paths::is_within;
use super::{join_within, Mirror};

const SCOPE_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_SCOPES: usize = 16;

/// A frozen deletion confirmation. `count` includes saved copies and retained
/// version files captured at this instant.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorDeleteScope {
    pub scope_id: String,
    pub count: usize,
}

/// One captured file that could not be removed safely.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorDeleteFailure {
    pub resource_id: i64,
    pub path: String,
    pub error: String,
}

/// Outcome for the entries processed by a frozen deletion scope.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorDeleteResult {
    pub removed: usize,
    pub failed: Vec<MirrorDeleteFailure>,
}

pub(super) struct DeleteScopeState {
    root: PathBuf,
    root_identity: Option<PathBuf>,
    created: Instant,
    remaining: Vec<MirrorDeleteFile>,
    recovery: HashMap<DeleteKey, PathBuf>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct DeleteKey(i64, String, Option<i64>);

fn delete_key(file: &MirrorDeleteFile) -> DeleteKey {
    DeleteKey(file.resource_id, file.rel_path.clone(), file.version_rowid)
}

impl Mirror {
    /// Capture every confirmed saved copy and retained version under the
    /// current root. Queue and unfinished attempts are not part of this scope.
    pub fn snapshot_delete_scope(&self, conn: &Connection) -> Result<MirrorDeleteScope, String> {
        let conn = conn;
        let root = self.root.lock().unwrap().clone();
        let root_identity = root.canonicalize().ok();
        let files = db::mirror_delete_files(conn).map_err(|e| e.to_string())?;
        let mut scopes = self.delete_scopes.lock().unwrap();
        scopes.retain(|_, scope| scope.created.elapsed() < SCOPE_TTL || !scope.recovery.is_empty());
        if scopes.len() >= MAX_SCOPES {
            if let Some(oldest) = scopes
                .iter()
                .filter(|(_, scope)| scope.recovery.is_empty())
                .min_by_key(|(_, scope)| scope.created)
                .map(|(id, _)| id.clone())
            {
                scopes.remove(&oldest);
            } else {
                return Err("MIRROR_DELETE_RECOVERY_PENDING: Saved-file recovery capacity reached; retry outstanding cleanup before confirming another deletion.".into());
            }
        }
        let scope_id = Uuid::new_v4().to_string();
        let count = files.len();
        scopes.insert(
            scope_id.clone(),
            DeleteScopeState {
                root,
                root_identity,
                created: Instant::now(),
                remaining: files,
                recovery: HashMap::new(),
            },
        );
        Ok(MirrorDeleteScope { scope_id, count })
    }

    /// Delete only the still-pending entries from a previously captured scope.
    /// A missing file is an idempotent success once its exact index entry is
    /// cleared; `removed` describes scope entries, not bytes unlinked.
    pub fn delete_scope(
        &self,
        conn: &Connection,
        scope_id: &str,
    ) -> Result<MirrorDeleteResult, String> {
        self.delete_scope_with_ops(
            conn,
            scope_id,
            FsOps {
                rename: |from: &Path, to: &Path| fs::rename(from, to),
                remove: |path: &Path| fs::remove_file(path),
                after_stage: |_: &Path| Ok(()),
            },
        )
    }

    #[cfg(test)]
    fn delete_scope_with(
        &self,
        conn: &Connection,
        scope_id: &str,
        remove: impl Fn(&Path) -> io::Result<()>,
    ) -> Result<MirrorDeleteResult, String> {
        self.delete_scope_with_ops(
            conn,
            scope_id,
            FsOps {
                rename: |from: &Path, to: &Path| fs::rename(from, to),
                remove,
                after_stage: |_: &Path| Ok(()),
            },
        )
    }

    fn delete_scope_with_ops<R, D, A>(
        &self,
        conn: &Connection,
        scope_id: &str,
        ops: FsOps<R, D, A>,
    ) -> Result<MirrorDeleteResult, String>
    where
        R: Fn(&Path, &Path) -> io::Result<()>,
        D: Fn(&Path) -> io::Result<()>,
        A: Fn(&Path) -> io::Result<()>,
    {
        // Publication takes the connection before the root and attempt locks.
        // Keep that order and the root lock through unlink/index update so a
        // settings root change or a publication cannot race this operation.
        let conn = conn;
        let root = self.root.lock().unwrap();
        let mut scopes = self.delete_scopes.lock().unwrap();
        scopes.retain(|_, scope| scope.created.elapsed() < SCOPE_TTL || !scope.recovery.is_empty());
        let scope = scopes.get_mut(scope_id).ok_or_else(|| {
            "MIRROR_DELETE_SCOPE_EXPIRED: Deletion scope expired or is unknown; confirm deletion again.".to_string()
        })?;
        let mut result = MirrorDeleteResult {
            removed: 0,
            failed: Vec::new(),
        };
        let mut remaining = Vec::new();
        let pending = std::mem::take(&mut scope.remaining);
        for file in pending {
            let key = delete_key(&file);
            if root_changed(root.as_path(), &scope.root, &scope.root_identity) {
                result.failed.push(failure(
                    &file,
                    "Mirror root changed after confirmation; confirm deletion again.".into(),
                ));
                remaining.push(file);
                continue;
            }
            let path = match join_within(&scope.root, &file.rel_path) {
                Some(path) => path,
                _ => {
                    result.failed.push(failure(
                        &file,
                        "Saved path is invalid or resolves outside the mirror root.".into(),
                    ));
                    remaining.push(file);
                    continue;
                }
            };
            if let Some(staged) = scope.recovery.remove(&key) {
                match db::mirror_delete_file_matches(conn, &file) {
                    Ok(true) => {
                        match fs::symlink_metadata(&path) {
                            Ok(_) => {
                                scope.recovery.insert(key.clone(), staged.clone());
                                result.failed.push(failure(
                                    &file,
                                    format!(
                                        "Recovery file retained at {}; original path is occupied.",
                                        staged.display()
                                    ),
                                ));
                                remaining.push(file);
                                continue;
                            }
                            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                            Err(error) => {
                                scope.recovery.insert(key.clone(), staged.clone());
                                result.failed.push(failure(&file, format!("Recovery file retained at {}; could not inspect original path {}: {error}", staged.display(), path.display())));
                                remaining.push(file);
                                continue;
                            }
                        }
                        if let Err(error) = (ops.rename)(&staged, &path) {
                            scope.recovery.insert(key.clone(), staged.clone());
                            result.failed.push(failure(
                                &file,
                                format!(
                                    "Could not restore saved bytes from {} to {}: {error}",
                                    staged.display(),
                                    path.display()
                                ),
                            ));
                            remaining.push(file);
                            continue;
                        }
                    }
                    Ok(false) => match (ops.remove)(&staged) {
                        Ok(()) => {
                            result.removed += 1;
                            continue;
                        }
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {
                            result.removed += 1;
                            continue;
                        }
                        Err(error) => {
                            scope.recovery.insert(key.clone(), staged.clone());
                            result.failed.push(failure(&file, format!("Index entry is deleted; staged bytes remain at {} and could not be removed: {error}", staged.display())));
                            remaining.push(file);
                            continue;
                        }
                    },
                    Err(error) => {
                        scope.recovery.insert(key.clone(), staged.clone());
                        result.failed.push(failure(
                            &file,
                            format!(
                                "Could not inspect index while recovering staged file {}: {error}",
                                staged.display()
                            ),
                        ));
                        remaining.push(file);
                        continue;
                    }
                }
            }
            let present = match validate_target(&scope.root, &path) {
                Ok(present) => present,
                Err(error) => {
                    result.failed.push(failure(&file, error));
                    remaining.push(file);
                    continue;
                }
            };

            let tx = match conn.unchecked_transaction() {
                Ok(tx) => tx,
                Err(error) => {
                    result.failed.push(failure(
                        &file,
                        format!("Could not start index update: {error}"),
                    ));
                    remaining.push(file);
                    continue;
                }
            };
            let matches = match db::mirror_delete_file_matches(&tx, &file) {
                Ok(matches) => matches,
                Err(error) => {
                    result.failed.push(failure(
                        &file,
                        format!("Could not verify saved-file identity: {error}"),
                    ));
                    remaining.push(file);
                    continue;
                }
            };
            if !matches {
                result.failed.push(failure(
                    &file,
                    "Saved file changed after confirmation; confirm deletion again.".into(),
                ));
                remaining.push(file);
                continue;
            }

            if present {
                // Recheck immediately before the injected/production unlink to
                // catch a symlink or root substitution after the DB identity
                // read. The root lock blocks Settings changes in this process.
                if root_changed(root.as_path(), &scope.root, &scope.root_identity) {
                    result.failed.push(failure(
                        &file,
                        "Mirror root changed after confirmation; confirm deletion again.".into(),
                    ));
                    remaining.push(file);
                    continue;
                }
                match validate_target(&scope.root, &path) {
                    Ok(false) => {}
                    Ok(true) => {
                        let staged = staging_path(&path);
                        match (ops.rename)(&path, &staged) {
                            Ok(()) => {
                                scope.recovery.insert(key.clone(), staged);
                                let staged = scope.recovery.get(&key).unwrap().clone();
                                if let Err(error) = (ops.after_stage)(&staged) {
                                    let recovery =
                                        rollback_staging(&path, Some(&staged), &ops.rename);
                                    if recovery.is_none() {
                                        scope.recovery.remove(&key);
                                    }
                                    result.failed.push(failure(&file, format!("Could not complete staged filesystem removal: {error}{}", recovery.unwrap_or_default())));
                                    remaining.push(file);
                                    continue;
                                }
                            }
                            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                            Err(error) => {
                                result.failed.push(failure(
                                    &file,
                                    format!("Could not remove saved file: {error}"),
                                ));
                                remaining.push(file);
                                continue;
                            }
                        }
                    }
                    Err(error) => {
                        result.failed.push(failure(&file, error));
                        remaining.push(file);
                        continue;
                    }
                }
            }
            let staged = scope.recovery.get(&key).cloned();
            match db::mirror_delete_captured_file(&tx, &file) {
                Ok(1) => match tx.commit() {
                    Ok(()) => {
                        if let Some(staged) = staged {
                            scope.recovery.remove(&key);
                            match (ops.remove)(&staged) {
                                Ok(()) => result.removed += 1,
                                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                                    result.removed += 1
                                }
                                Err(error) => {
                                    scope.recovery.insert(key.clone(), staged.clone());
                                    result.failed.push(failure(&file, format!("Index entry was deleted; staged bytes remain at {}: {error}", staged.display())));
                                    remaining.push(file);
                                }
                            }
                        } else {
                            result.removed += 1;
                        }
                    }
                    Err(error) => {
                        let recovery = rollback_staging(&path, staged.as_deref(), &ops.rename);
                        let recovery_failed = recovery.is_some();
                        result.failed.push(failure(
                            &file,
                            format!(
                                "Index update failed: {error}{}",
                                recovery.unwrap_or_default()
                            ),
                        ));
                        if !recovery_failed {
                            scope.recovery.remove(&key);
                        }
                        remaining.push(file);
                    }
                },
                Ok(_) => {
                    let recovery = rollback_staging(&path, staged.as_deref(), &ops.rename);
                    let recovery_failed = recovery.is_some();
                    result.failed.push(failure(
                        &file,
                        format!("Saved-file identity changed during deletion; confirm deletion again.{}", recovery.unwrap_or_default()),
                    ));
                    if !recovery_failed {
                        scope.recovery.remove(&key);
                    }
                    remaining.push(file);
                }
                Err(error) => {
                    let recovery = rollback_staging(&path, staged.as_deref(), &ops.rename);
                    let recovery_failed = recovery.is_some();
                    result.failed.push(failure(
                        &file,
                        format!(
                            "Index update failed: {error}{}",
                            recovery.unwrap_or_default()
                        ),
                    ));
                    if !recovery_failed {
                        scope.recovery.remove(&key);
                    }
                    remaining.push(file);
                }
            }
        }
        scope.remaining = remaining;
        let complete = scope.remaining.is_empty();
        if complete {
            scopes.remove(scope_id);
        }
        Ok(result)
    }
}

struct FsOps<R, D, A> {
    rename: R,
    remove: D,
    after_stage: A,
}

fn staging_path(path: &Path) -> PathBuf {
    let original = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("saved-file");
    let name = format!(".{original}.quanta-delete-{}.stage", Uuid::new_v4());
    path.with_file_name(name)
}

fn rollback_staging(
    path: &Path,
    staged: Option<&Path>,
    rename: &impl Fn(&Path, &Path) -> io::Result<()>,
) -> Option<String> {
    let staged = staged?;
    match rename(staged, path) {
        Ok(()) => None,
        Err(error) => Some(format!(
            "; bytes remain recoverable at {} (restore to {} failed: {error})",
            staged.display(),
            path.display()
        )),
    }
}

fn root_changed(root: &Path, captured_root: &Path, captured_identity: &Option<PathBuf>) -> bool {
    if root != captured_root {
        return true;
    }
    let current = root.canonicalize().ok();
    match (captured_identity, &current) {
        (Some(original), Some(current)) => original != current,
        (None, Some(_)) => true,
        (_, None) => false,
    }
}

/// Validate an existing target and report whether there are bytes/link entries
/// to unlink. A missing path is safe to clear from this exact scope, even when
/// the root directory itself has since disappeared.
fn validate_target(root: &Path, path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) if is_within(root, path) => Ok(true),
        Ok(_) => Err("Saved path resolves outside the mirror root.".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Could not inspect saved path: {error}")),
    }
}

fn failure(file: &MirrorDeleteFile, error: String) -> MirrorDeleteFailure {
    MirrorDeleteFailure {
        resource_id: file.resource_id,
        path: file.rel_path.clone(),
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::mirror::{MirrorConfig, ST_KEPT, ST_OK};
    use crate::db::{self, MirrorRow, MirrorVersion};
    use rusqlite::{params, Connection};
    use std::sync::Arc;

    fn setup() -> (tempfile::TempDir, Connection, Arc<Mirror>) {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let mirror = Mirror::new(dir.path().to_path_buf(), MirrorConfig::default());
        (dir, conn, mirror)
    }

    fn seed_resource(conn: &Connection, id: i64) {
        conn.execute(
            "INSERT INTO resources(id, external_resource_id, title, url, resource_type, first_seen_at)
             VALUES(?1, ?2, 'Saved', 'https://example.invalid/file', 'file', 't0')",
            params![id, format!("external-{id}")],
        )
        .unwrap();
    }

    fn seed_copy(conn: &Connection, root: &Path, id: i64, rel_path: &str, status: &str) {
        seed_resource(conn, id);
        let path = root.join(rel_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, format!("bytes-{id}")).unwrap();
        db::mirror_upsert(
            conn,
            &MirrorRow {
                resource_id: id,
                rel_path: rel_path.into(),
                sha256: Some(format!("hash-{id}")),
                size_bytes: 7,
                mime: None,
                status: status.into(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some(format!("publication-{id}")),
                last_checked: Some("t0".into()),
            },
        )
        .unwrap();
    }

    #[test]
    fn partial_success_retains_failed_rows_and_retry_is_limited_to_frozen_failures() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/one.pdf", ST_OK);
        seed_copy(&conn, dir.path(), 2, "Course/two.pdf", ST_KEPT);
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        assert_eq!(scope.count, 2);

        let first = mirror
            .delete_scope_with_ops(
                &conn,
                &scope.scope_id,
                FsOps {
                    rename: |from: &Path, to: &Path| fs::rename(from, to),
                    remove: |path: &Path| fs::remove_file(path),
                    after_stage: |path: &Path| {
                        if path.to_string_lossy().contains("two.pdf") {
                            Err(io::Error::new(
                                io::ErrorKind::PermissionDenied,
                                "locked for test",
                            ))
                        } else {
                            Ok(())
                        }
                    },
                },
            )
            .unwrap();
        assert_eq!(first.removed, 1);
        assert_eq!(first.failed.len(), 1);
        assert!(db::mirror_get(&conn, 1).unwrap().is_none());
        assert!(db::mirror_get(&conn, 2).unwrap().is_some());

        // A later publication is outside this scope even when deletion retries.
        seed_copy(&conn, dir.path(), 3, "Course/three.pdf", ST_OK);
        let retried = Vec::<PathBuf>::new();
        let seen = std::sync::Mutex::new(retried);
        let second = mirror
            .delete_scope_with(&conn, &scope.scope_id, |path| {
                seen.lock().unwrap().push(path.to_path_buf());
                fs::remove_file(path)
            })
            .unwrap();
        assert_eq!(second.removed, 1);
        assert!(second.failed.is_empty());
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert!(seen[0].to_string_lossy().contains("two.pdf"));
        drop(seen);
        assert!(db::mirror_get(&conn, 3).unwrap().is_some());
        assert!(dir.path().join("Course/three.pdf").is_file());
        assert!(mirror.delete_scope(&conn, &scope.scope_id).is_err());
    }

    #[test]
    fn missing_files_are_idempotent_and_retained_versions_are_in_scope() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/current.pdf", ST_OK);
        let version_path = ".history/1/old.pdf";
        fs::create_dir_all(dir.path().join(".history/1")).unwrap();
        fs::write(dir.path().join(version_path), b"old").unwrap();
        db::version_insert(
            &conn,
            &MirrorVersion {
                resource_id: 1,
                rel_path: version_path.into(),
                sha256: Some("old-hash".into()),
                size_bytes: 3,
                replaced_at: "t1".into(),
            },
        )
        .unwrap();
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        assert_eq!(scope.count, 2);
        fs::remove_dir_all(dir.path()).unwrap();
        let result = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(result.removed, 2);
        assert!(result.failed.is_empty());
        assert!(db::mirror_get(&conn, 1).unwrap().is_none());
        assert!(db::mirror_delete_files(&conn).unwrap().is_empty());
    }

    #[test]
    fn invalid_traversal_paths_and_changed_root_or_publication_preserve_successors() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/file.pdf", ST_OK);
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        let changed = MirrorRow {
            attempts: 2,
            ..db::mirror_get(&conn, 1).unwrap().unwrap()
        };
        db::mirror_upsert(&conn, &changed).unwrap();
        let result = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(result.removed, 0);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(
            fs::read(dir.path().join("Course/file.pdf")).unwrap(),
            b"bytes-1"
        );
        assert_eq!(db::mirror_get(&conn, 1).unwrap().unwrap().attempts, 2);

        mirror.set_root(dir.path().join("new-root"));
        let moved = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert!(moved.failed[0].error.contains("root changed"));
    }

    #[test]
    fn traversal_rows_are_reported_without_touching_outside_paths() {
        let (_dir, conn, mirror) = setup();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside = outside_dir.path().join("outside-delete-scope.txt");
        fs::write(&outside, b"outside").unwrap();
        seed_resource(&conn, 1);
        db::mirror_upsert(
            &conn,
            &MirrorRow {
                resource_id: 1,
                rel_path: "../outside-delete-scope.txt".into(),
                sha256: Some("outside-hash".into()),
                size_bytes: 7,
                mime: None,
                status: ST_OK.into(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some("t0".into()),
                last_checked: None,
            },
        )
        .unwrap();
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        let result = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(result.removed, 0);
        assert_eq!(result.failed.len(), 1);
        assert!(outside.exists());
        assert!(db::mirror_get(&conn, 1).unwrap().is_some());
        fs::remove_file(outside).unwrap();
    }

    #[test]
    fn failed_database_delete_keeps_row_and_scope_retryable() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/file.pdf", ST_OK);
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER refuse_mirror_delete BEFORE DELETE ON local_files
             BEGIN SELECT RAISE(FAIL, 'forced database failure'); END;",
        )
        .unwrap();
        let failed = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(failed.removed, 0);
        assert_eq!(failed.failed.len(), 1);
        assert!(db::mirror_get(&conn, 1).unwrap().is_some());
        assert!(
            dir.path().join("Course/file.pdf").exists(),
            "database failure must preserve the confirmed saved bytes"
        );
        assert_eq!(fs::read_dir(dir.path().join("Course")).unwrap().count(), 1);

        conn.execute_batch("DROP TRIGGER refuse_mirror_delete;")
            .unwrap();
        let retried = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(retried.removed, 1);
        assert!(db::mirror_get(&conn, 1).unwrap().is_none());
    }

    #[test]
    fn deferred_commit_failure_restores_bytes_and_retries_exact_entry() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/file.pdf", ST_KEPT);
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE deferred_parent(id INTEGER PRIMARY KEY);
             CREATE TABLE deferred_child(parent_id INTEGER REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED);
             CREATE TRIGGER defer_failure AFTER DELETE ON local_files BEGIN INSERT INTO deferred_child VALUES(99); END;",
        ).unwrap();
        let failed = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(failed.removed, 0);
        assert_eq!(failed.failed.len(), 1);
        assert!(db::mirror_get(&conn, 1).unwrap().is_some());
        assert_eq!(
            fs::read(dir.path().join("Course/file.pdf")).unwrap(),
            b"bytes-1"
        );
        assert_eq!(fs::read_dir(dir.path().join("Course")).unwrap().count(), 1);
        conn.execute_batch("DROP TRIGGER defer_failure;").unwrap();
        let retried = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(retried.removed, 1);
        assert!(db::mirror_get(&conn, 1).unwrap().is_none());
        assert_eq!(fs::read_dir(dir.path().join("Course")).unwrap().count(), 0);
    }

    #[test]
    fn failed_staged_cleanup_is_reported_and_retry_removes_recovery_file() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/file.pdf", ST_OK);
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        let failed = mirror
            .delete_scope_with(&conn, &scope.scope_id, |_| {
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "staged file locked",
                ))
            })
            .unwrap();
        assert_eq!(
            failed.removed, 0,
            "outstanding cleanup must not also count as completed"
        );
        assert_eq!(failed.failed.len(), 1);
        assert!(failed.failed[0].error.contains("staged bytes remain at"));
        assert!(db::mirror_get(&conn, 1).unwrap().is_none());
        let stage = fs::read_dir(dir.path().join("Course"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert!(stage
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains("quanta-delete"));
        let retried = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(retried.removed, 1);
        assert!(retried.failed.is_empty());
        assert_eq!(fs::read_dir(dir.path().join("Course")).unwrap().count(), 0);
    }

    #[test]
    fn expired_scope_keeps_staged_recovery_reachable() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/file.pdf", ST_OK);
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        mirror
            .delete_scope_with(&conn, &scope.scope_id, |_| {
                Err(io::Error::new(io::ErrorKind::PermissionDenied, "locked"))
            })
            .unwrap();
        mirror
            .delete_scopes
            .lock()
            .unwrap()
            .get_mut(&scope.scope_id)
            .unwrap()
            .created = Instant::now() - SCOPE_TTL - Duration::from_secs(1);
        let _new_scope = mirror.snapshot_delete_scope(&conn).unwrap();
        assert!(
            mirror
                .delete_scopes
                .lock()
                .unwrap()
                .contains_key(&scope.scope_id),
            "expiry must preserve recovery metadata"
        );
        let result = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert!(result.failed.is_empty());
        assert_eq!(fs::read_dir(dir.path().join("Course")).unwrap().count(), 0);
    }

    #[test]
    fn scope_capacity_never_evicts_staged_recovery() {
        let (dir, conn, mirror) = setup();
        let mut ids = Vec::new();
        for index in 0..MAX_SCOPES {
            seed_copy(
                &conn,
                dir.path(),
                index as i64 + 1,
                &format!("Course/{index}.pdf"),
                ST_OK,
            );
            let scope = mirror.snapshot_delete_scope(&conn).unwrap();
            mirror
                .delete_scope_with(&conn, &scope.scope_id, |_| {
                    Err(io::Error::new(io::ErrorKind::PermissionDenied, "locked"))
                })
                .unwrap();
            ids.push(scope.scope_id);
        }
        assert!(
            mirror.snapshot_delete_scope(&conn).is_err(),
            "capacity must fail closed rather than discard staged recovery"
        );
        assert_eq!(mirror.delete_scopes.lock().unwrap().len(), MAX_SCOPES);
        for id in ids {
            assert!(mirror.delete_scope(&conn, &id).unwrap().failed.is_empty());
        }
        assert_eq!(fs::read_dir(dir.path().join("Course")).unwrap().count(), 0);
    }

    #[test]
    fn retained_version_database_failure_restores_bytes_and_retries() {
        let (dir, conn, mirror) = setup();
        seed_resource(&conn, 1);
        let rel_path = ".history/1/old.pdf";
        let path = dir.path().join(rel_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"old-version").unwrap();
        db::version_insert(
            &conn,
            &MirrorVersion {
                resource_id: 1,
                rel_path: rel_path.into(),
                sha256: Some("old-hash".into()),
                size_bytes: 11,
                replaced_at: "t1".into(),
            },
        )
        .unwrap();
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        conn.execute_batch("CREATE TRIGGER refuse_version_delete BEFORE DELETE ON local_file_versions BEGIN SELECT RAISE(FAIL, 'version failure'); END;").unwrap();
        let failed = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(failed.removed, 0);
        assert_eq!(failed.failed.len(), 1);
        assert_eq!(fs::read(&path).unwrap(), b"old-version");
        assert_eq!(db::mirror_delete_files(&conn).unwrap().len(), 1);
        conn.execute_batch("DROP TRIGGER refuse_version_delete;")
            .unwrap();
        let retried = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(retried.removed, 1);
        assert!(db::mirror_delete_files(&conn).unwrap().is_empty());
        assert!(!path.exists());
    }

    #[test]
    fn failed_compensation_reports_staged_location_and_retries_without_overwrite() {
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/file.pdf", ST_OK);
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        let rename_count = std::cell::Cell::new(0);
        let failed = mirror
            .delete_scope_with_ops(
                &conn,
                &scope.scope_id,
                FsOps {
                    rename: |from: &Path, to: &Path| {
                        let count = rename_count.get() + 1;
                        rename_count.set(count);
                        if count == 2 {
                            Err(io::Error::new(
                                io::ErrorKind::PermissionDenied,
                                "restore blocked",
                            ))
                        } else {
                            fs::rename(from, to)
                        }
                    },
                    remove: |path: &Path| fs::remove_file(path),
                    after_stage: |_: &Path| {
                        Err(io::Error::new(io::ErrorKind::Other, "injected after stage"))
                    },
                },
            )
            .unwrap();
        assert_eq!(failed.removed, 0);
        assert!(failed.failed[0]
            .error
            .contains("bytes remain recoverable at"));
        let staged = fs::read_dir(dir.path().join("Course"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert!(staged
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains("quanta-delete"));
        assert!(db::mirror_get(&conn, 1).unwrap().is_some());
        let successor = dir.path().join("Course/file.pdf");
        fs::write(&successor, b"successor").unwrap();
        let retry = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(retry.removed, 0);
        assert!(retry.failed[0].error.contains("original path is occupied"));
        assert_eq!(fs::read(&successor).unwrap(), b"successor");
        fs::remove_file(successor).unwrap();
        let retry = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(retry.removed, 1);
        assert!(db::mirror_get(&conn, 1).unwrap().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected_without_touching_outside_file() {
        use std::os::unix::fs::symlink;
        let (dir, conn, mirror) = setup();
        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::create_dir_all(dir.path().join("Course")).unwrap();
        symlink(outside.path(), dir.path().join("Course/escape.pdf")).unwrap();
        seed_resource(&conn, 1);
        db::mirror_upsert(
            &conn,
            &MirrorRow {
                resource_id: 1,
                rel_path: "Course/escape.pdf".into(),
                sha256: Some("hash".into()),
                size_bytes: 0,
                mime: None,
                status: ST_OK.into(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some("t0".into()),
                last_checked: None,
            },
        )
        .unwrap();
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        let result = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(result.removed, 0);
        assert_eq!(result.failed.len(), 1);
        assert!(outside.path().exists());
    }

    #[cfg(unix)]
    #[test]
    fn retargeted_root_symlink_is_a_scope_change() {
        use std::os::unix::fs::symlink;
        let (dir, conn, mirror) = setup();
        seed_copy(&conn, dir.path(), 1, "Course/file.pdf", ST_OK);
        let link_dir = tempfile::tempdir().unwrap();
        let alternate = tempfile::tempdir().unwrap();
        let root_link = link_dir.path().join("mirror-root");
        symlink(dir.path(), &root_link).unwrap();
        mirror.set_root(root_link.clone());
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();

        fs::remove_file(&root_link).unwrap();
        symlink(alternate.path(), &root_link).unwrap();
        let successor = alternate.path().join("Course/file.pdf");
        fs::create_dir_all(successor.parent().unwrap()).unwrap();
        fs::write(&successor, b"successor").unwrap();
        let result = mirror.delete_scope(&conn, &scope.scope_id).unwrap();
        assert_eq!(result.removed, 0);
        assert!(result.failed[0].error.contains("root changed"));
        assert_eq!(fs::read(successor).unwrap(), b"successor");
    }

    #[test]
    fn snapshot_count_excludes_unfinished_queue_and_wire_fields_are_camel_case() {
        let (_dir, conn, mirror) = setup();
        seed_resource(&conn, 1);
        db::queue_enqueue(&conn, 1, 0, "t0").unwrap();
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        assert_eq!(scope.count, 0);
        assert!(serde_json::to_value(scope)
            .unwrap()
            .get("scopeId")
            .is_some());
    }

    #[test]
    fn scopes_are_instance_bound_expiring_and_bounded() {
        let (dir, conn, mirror) = setup();
        let scope = mirror.snapshot_delete_scope(&conn).unwrap();
        let other_mirror = Mirror::new(dir.path().to_path_buf(), MirrorConfig::default());
        assert!(other_mirror.delete_scope(&conn, &scope.scope_id).is_err());

        mirror
            .delete_scopes
            .lock()
            .unwrap()
            .get_mut(&scope.scope_id)
            .unwrap()
            .created = Instant::now() - SCOPE_TTL;
        assert!(mirror.delete_scope(&conn, &scope.scope_id).is_err());

        let first = mirror.snapshot_delete_scope(&conn).unwrap();
        for _ in 1..MAX_SCOPES {
            mirror.snapshot_delete_scope(&conn).unwrap();
        }
        mirror.snapshot_delete_scope(&conn).unwrap();
        assert!(mirror.delete_scope(&conn, &first.scope_id).is_err());
    }
}

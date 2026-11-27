//! Disposable, desktop-only search for current local material bytes.

use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::{Duration, Instant, SystemTime},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::core::{files::hash_bytes, mirror::join_within};

/// Only enable extraction on the native platform verified for this prototype.
pub const PLATFORM_SUPPORTED: bool = cfg!(all(target_os = "windows", target_arch = "x86_64"));

const MAX_INVENTORY: i64 = 5_000;
const MAX_DOCUMENTS: usize = 256;
const MAX_BYTES: usize = 128 * 1024;
const BATCH: i64 = 16;
const EXTRACTION_VERSION: i64 = 1;
const BUILD_TIME: Duration = Duration::from_secs(3);
const SEARCH_TIME: Duration = Duration::from_millis(150);

#[derive(Default)]
pub struct ContentSearch {
    index: Mutex<Option<Index>>,
    job: Mutex<Option<bool>>,
}

/// A reserved rebuild, cancellable even before its blocking worker starts.
pub struct Rebuild(Arc<ContentSearch>);

impl Drop for Rebuild {
    fn drop(&mut self) {
        *self.0.job.lock().unwrap() = None;
    }
}

struct Index {
    db: Connection,
    sources: HashMap<i64, (Source, Stamp)>,
    documents: usize,
    skipped: usize,
    limited: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Source {
    id: i64,
    path: String,
    hash: String,
    mime: Option<String>,
    fingerprint: Option<String>,
    cache_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Stamp {
    path: PathBuf,
    len: u64,
    modified: SystemTime,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    resource_id: i64,
    snippet: String,
}

#[derive(Serialize)]
pub struct ContentResults {
    state: &'static str,
    indexed: usize,
    skipped: usize,
    hits: Vec<ContentHit>,
}

impl ContentResults {
    pub fn state(state: &'static str) -> Self {
        Self {
            state,
            indexed: 0,
            skipped: 0,
            hits: Vec::new(),
        }
    }
}

// A cache row has no source revision. It is eligible only as an alternate
// location for bytes whose hash is corroborated by the current mirror record.
const SOURCES: &str = "
    SELECT r.id, f.rel_path, f.sha256, f.mime, r.content_fingerprint, c.path
    FROM local_files f JOIN resources r ON r.id = f.resource_id
    LEFT JOIN file_cache c ON c.resource_id = r.id AND c.content_hash = f.sha256
    WHERE r.availability_status = 'available' AND r.is_external = 0
      AND r.resource_type NOT IN ('assignment', 'grade', 'attendance')
      AND f.status = 'ok' AND f.sha256 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM change_events e WHERE e.resource_id = r.id AND e.change_type = 'updated'
          AND e.detected_at >= COALESCE(f.last_checked, f.downloaded_at, '')
      )";

fn source(row: &rusqlite::Row<'_>) -> rusqlite::Result<Source> {
    Ok(Source {
        id: row.get(0)?,
        path: row.get(1)?,
        hash: row.get(2)?,
        mime: row.get(3)?,
        fingerprint: row.get(4)?,
        cache_path: row.get(5)?,
    })
}

fn within_budget(db: &Connection) -> rusqlite::Result<bool> {
    Ok(db
        .query_row(
            "SELECT 1 FROM resources LIMIT 1 OFFSET ?1",
            [MAX_INVENTORY],
            |_| Ok(()),
        )
        .optional()?
        .is_none())
}

fn lock_until<'a, T>(lock: &'a Mutex<T>, stop: &impl Fn() -> bool) -> Option<MutexGuard<'a, T>> {
    while !stop() {
        match lock.try_lock() {
            Ok(guard) => return Some(guard),
            Err(std::sync::TryLockError::WouldBlock) => thread::sleep(Duration::from_millis(2)),
            Err(std::sync::TryLockError::Poisoned(_)) => return None,
        }
    }
    None
}

fn with_deadline<T>(
    db: &Connection,
    deadline: Instant,
    run: impl FnOnce() -> rusqlite::Result<T>,
) -> rusqlite::Result<T> {
    db.progress_handler(1_000, Some(move || Instant::now() >= deadline));
    let result = run();
    db.progress_handler(0, None::<fn() -> bool>);
    result
}

fn batch_deadline(deadline: Instant) -> Instant {
    deadline.min(Instant::now() + Duration::from_millis(20))
}

impl Source {
    fn stamp(&self, mirror: &Path, cache: &Path) -> Option<Stamp> {
        if self
            .path
            .split('/')
            .any(|component| component.eq_ignore_ascii_case(".history") || component.contains(':'))
        {
            return None;
        }
        if self.hash.len() != 64 || !self.hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let local = join_within(mirror, &self.path)?;
        let cache_copy = cache.join(self.id.to_string()).join(&self.hash);
        let local_stamp = stamp_within(mirror, &local);
        if local_stamp.is_some() {
            return local_stamp;
        }
        (self.cache_path.as_deref().map(Path::new) == Some(cache_copy.as_path()))
            .then(|| stamp_within(cache, &cache_copy))
            .flatten()
    }

    fn extract(&self, stamp: &Stamp, stop: &impl Fn() -> bool) -> Option<String> {
        if stamp.len > MAX_BYTES as u64 || stop() {
            return None;
        }
        // Bound the actual read as well as the metadata size. A file can grow
        // or be replaced after its metadata was read.
        let mut file = File::open(&stamp.path).ok()?.take(MAX_BYTES as u64 + 1);
        let mut bytes = Vec::with_capacity(stamp.len as usize);
        let mut chunk = [0; 8192];
        while !stop() {
            let read = file.read(&mut chunk).ok()?;
            if read == 0 {
                if bytes.len() > MAX_BYTES || hash_bytes(&bytes) != self.hash || bytes.contains(&0)
                {
                    return None;
                }
                let text = String::from_utf8(bytes).ok()?;
                let text = text.trim_start_matches('\u{feff}').trim();
                return (!text.is_empty() && !stop()).then(|| text.to_owned());
            }
            bytes.extend_from_slice(&chunk[..read]);
        }
        None
    }
}

fn is_supported_text(source: &Source) -> bool {
    let extension = Path::new(&source.path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let textual_extension = matches!(
        extension.as_str(),
        "txt" | "md" | "markdown" | "csv" | "log"
    );
    if !textual_extension {
        return false;
    }
    source.mime.as_deref().map_or(true, |mime| {
        matches!(
            mime.split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "" | "text/plain" | "text/markdown" | "text/csv" | "application/octet-stream"
        )
    })
}

fn stamp_within(root: &Path, path: &Path) -> Option<Stamp> {
    #[cfg(windows)]
    if !drive_path(root) {
        return None;
    }
    let relative = path.strip_prefix(root).ok()?;
    let mut original = root.to_path_buf();
    if !local_metadata(&original)?.is_dir() {
        return None;
    }
    for part in relative.components() {
        let std::path::Component::Normal(name) = part else {
            return None;
        };
        original.push(name);
        // Canonicalization follows symlinks and junctions, so check every
        // component under the original root before resolving the path.
        local_metadata(&original)?;
    }
    let root = root.canonicalize().ok()?;
    let real = path.canonicalize().ok()?;
    #[cfg(windows)]
    if !drive_path(&real) {
        return None;
    }
    let relative = real.strip_prefix(root).ok()?;
    if relative.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".history")
    }) {
        return None;
    }
    let meta = local_metadata(&real)?;
    meta.is_file().then_some(Stamp {
        path: real,
        len: meta.len(),
        modified: meta.modified().ok()?,
    })
}

fn local_metadata(path: &Path) -> Option<fs::Metadata> {
    let meta = fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() {
        return None;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Avoid hydrating placeholder files and opening Windows reparse points.
        const OFFLINE_OR_REPARSE: u32 = 0x1000 | 0x400;
        if meta.file_attributes() & OFFLINE_OR_REPARSE != 0 {
            return None;
        }
    }
    Some(meta)
}

#[cfg(windows)]
fn drive_path(path: &Path) -> bool {
    use std::path::{Component, Prefix};
    matches!(path.components().next(), Some(Component::Prefix(prefix))
        if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
}

impl ContentSearch {
    pub fn cancel(&self) {
        if let Some(cancelled) = self.job.lock().unwrap().as_mut() {
            *cancelled = true;
        }
    }

    pub fn begin_rebuild(self: &Arc<Self>) -> Option<Rebuild> {
        let mut job = self.job.lock().unwrap();
        if job.is_some() {
            return None;
        }
        *job = Some(false);
        Some(Rebuild(self.clone()))
    }
}

impl Rebuild {
    pub fn run(
        self,
        db: &Mutex<Connection>,
        mirror: &Path,
        cache: &Path,
    ) -> rusqlite::Result<ContentResults> {
        let expired = Instant::now() + BUILD_TIME;
        let cancelled = || self.0.job.lock().unwrap().unwrap_or(false);
        let stop = || cancelled() || Instant::now() >= expired;
        let Some(guard) = lock_until(db, &stop) else {
            return Ok(ContentResults::state(if cancelled() {
                "cancelled"
            } else {
                "limited"
            }));
        };
        if !within_budget(&guard)? {
            return Ok(ContentResults::state("tooLarge"));
        }
        drop(guard);
        let mut index = Index::new()?;
        let mut cursor = 0;
        let sql = format!("{SOURCES} AND f.resource_id > ?1 ORDER BY f.resource_id LIMIT ?2");
        'batches: loop {
            let Some(guard) = lock_until(db, &stop) else {
                index.limited = true;
                break;
            };
            let candidates = with_deadline(&guard, batch_deadline(expired), || {
                let mut query = guard.prepare_cached(&sql)?;
                let rows = query.query_map(params![cursor, BATCH], source)?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })?;
            drop(guard);
            if candidates.is_empty() {
                break;
            }
            for candidate in candidates {
                if stop() || index.documents >= MAX_DOCUMENTS {
                    index.limited = true;
                    break 'batches;
                }
                cursor = candidate.id;
                let document = is_supported_text(&candidate)
                    .then(|| candidate.stamp(mirror, cache))
                    .flatten()
                    .and_then(|stamp| {
                        let text = candidate.extract(&stamp, &stop)?;
                        (candidate.stamp(mirror, cache)? == stamp).then_some((stamp, text))
                    });
                if let Some((stamp, text)) = document {
                    index.insert(candidate, stamp, &text)?;
                } else {
                    index.skipped += 1;
                }
            }
        }
        // Fence cancellation at publication, including cancellation between the
        // final batch and the swap. A cancelled rebuild retains the prior index.
        let job = self.0.job.lock().unwrap();
        if job.unwrap_or(false) {
            return Ok(ContentResults::state("cancelled"));
        }
        let result = index.summary();
        let previous = self.0.index.lock().unwrap().replace(index);
        drop(job);
        drop(previous);
        Ok(result)
    }
}

impl ContentSearch {
    pub fn search(
        &self,
        db: &Mutex<Connection>,
        mirror: &Path,
        cache: &Path,
        terms: &[String],
    ) -> rusqlite::Result<ContentResults> {
        let deadline = Instant::now() + SEARCH_TIME;
        let stop = || Instant::now() >= deadline;
        let Some(guard) = lock_until(db, &stop) else {
            return Ok(ContentResults::state("limited"));
        };
        if !within_budget(&guard)? {
            return Ok(ContentResults::state("tooLarge"));
        }
        drop(guard);
        let building = self.job.lock().unwrap().is_some();
        let (mut result, matches) = {
            let Some(guard) = lock_until(&self.index, &stop) else {
                return Ok(ContentResults::state("limited"));
            };
            let Some(index) = guard.as_ref() else {
                return Ok(ContentResults::state(if building {
                    "building"
                } else {
                    "empty"
                }));
            };
            let mut summary = index.summary();
            if building {
                summary.state = "building";
            }
            if terms.is_empty() {
                return Ok(summary);
            }
            if terms.len() > 12
                || terms
                    .iter()
                    .any(|term| term.is_empty() || term.contains('\0'))
                || terms.iter().map(String::len).sum::<usize>() > 256
            {
                return Ok(ContentResults::state("queryTooLong"));
            }
            // Every parsed free term is a literal FTS phrase. The parameter
            // and doubled quotes keep FTS operators/columns out of user input.
            let query = terms
                .iter()
                .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" AND ");
            (summary, index.matches(&query, deadline)?)
        };
        let sql = format!("{SOURCES} AND r.id = ?1");
        for matched in matches {
            if stop() {
                result.state = "limited";
                break;
            }
            let Some(guard) = lock_until(db, &stop) else {
                result.state = "limited";
                break;
            };
            let current = with_deadline(&guard, batch_deadline(deadline), || {
                guard
                    .prepare_cached(&sql)?
                    .query_row([matched.source.id], source)
                    .optional()
            })?;
            drop(guard);
            if current.is_some_and(|mut current| {
                let stamp = current.stamp(mirror, cache);
                current.cache_path.clone_from(&matched.source.cache_path);
                current == matched.source && stamp.as_ref() == Some(&matched.stamp)
            }) {
                result.hits.push(ContentHit {
                    resource_id: matched.source.id,
                    snippet: matched.snippet,
                });
            } else {
                result.state = "stale";
            }
        }
        Ok(result)
    }
}

struct IndexedMatch {
    source: Source,
    stamp: Stamp,
    snippet: String,
}

impl Index {
    fn new() -> rusqlite::Result<Self> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(
            "CREATE VIRTUAL TABLE body USING fts5(text, hash UNINDEXED, version UNINDEXED)",
        )?;
        Ok(Self {
            db,
            sources: HashMap::new(),
            documents: 0,
            skipped: 0,
            limited: false,
        })
    }

    fn summary(&self) -> ContentResults {
        ContentResults {
            state: if self.limited { "limited" } else { "ready" },
            indexed: self.documents,
            skipped: self.skipped,
            hits: Vec::new(),
        }
    }

    fn insert(&mut self, source: Source, stamp: Stamp, text: &str) -> rusqlite::Result<()> {
        self.db.execute(
            "INSERT INTO body(rowid, text, hash, version) VALUES(?1, ?2, ?3, ?4)",
            params![source.id, text, source.hash, EXTRACTION_VERSION],
        )?;
        self.sources.insert(source.id, (source, stamp));
        self.documents += 1;
        Ok(())
    }

    fn matches(&self, query: &str, deadline: Instant) -> rusqlite::Result<Vec<IndexedMatch>> {
        with_deadline(&self.db, deadline, || {
            let mut stmt = self.db.prepare_cached(
                "SELECT rowid, substr(snippet(body, 0, '', '', '…', 24), 1, 360)
                FROM body WHERE body MATCH ?1 AND version = ?2",
            )?;
            let rows = stmt.query_map(params![query, EXTRACTION_VERSION], |row| {
                let id = row.get(0)?;
                let (source, stamp) = &self.sources[&id];
                let snippet: String = row.get(1)?;
                Ok(IndexedMatch {
                    source: source.clone(),
                    stamp: stamp.clone(),
                    snippet: snippet
                        .chars()
                        .map(|ch| if ch.is_control() { ' ' } else { ch })
                        .collect(),
                })
            })?;
            rows.collect()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{core::files::FileStore, db};

    struct Fixture {
        dir: tempfile::TempDir,
        db: Mutex<Connection>,
        index: Arc<ContentSearch>,
        cache: FileStore,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let db = Connection::open(dir.path().join("fixture.sqlite")).unwrap();
            db::migrate(&db).unwrap();
            let cache = FileStore::new(dir.path());
            Self {
                dir,
                db: Mutex::new(db),
                index: Arc::default(),
                cache,
            }
        }

        fn mirror(&self) -> PathBuf {
            self.dir.path().join("mirror")
        }

        fn material(&self, id: i64, name: &str, body: &[u8], kind: &str) -> PathBuf {
            let conn = self.db.lock().unwrap();
            conn.execute(
                "INSERT OR IGNORE INTO resources(id,external_resource_id,title,url,resource_type,first_seen_at)
                 VALUES(?1,?2,'Synthetic handout','https://example.test/fixture',?3,'2026-11-20T00:00:00Z')",
                params![id, format!("synthetic:{id}"), kind],
            ).unwrap();
            let path = self.mirror().join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, body).unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO local_files(resource_id,rel_path,sha256,size_bytes,status,downloaded_at)
                 VALUES(?1,?2,?3,?4,'ok','2026-11-20T00:01:00Z')",
                params![id, name, hash_bytes(body), body.len()],
            ).unwrap();
            path
        }

        fn rebuild(&self) -> ContentResults {
            let build = self.index.begin_rebuild().unwrap();
            build
                .run(&self.db, &self.mirror(), self.cache.root())
                .unwrap()
        }

        fn search(&self, terms: &[&str]) -> ContentResults {
            let terms = terms
                .iter()
                .map(|term| term.to_string())
                .collect::<Vec<_>>();
            self.index
                .search(&self.db, &self.mirror(), self.cache.root(), &terms)
                .unwrap()
        }
    }

    #[test]
    fn saved_text_replacement_removal_eviction_and_rebuild_keep_metadata_and_events() {
        let fixture = Fixture::new();
        let old = b"Laplace transform <img src=x> for real analysis.";
        fixture.material(1, "current.txt", old, "text");
        let cached = b"Synthetic canonical cache triangle";
        let cache_only = fixture.material(2, "cached.txt", cached, "text");
        let deleted = fixture.material(3, "deleted.txt", b"Synthetic manual deletion", "text");
        fixture
            .cache
            .put(&fixture.db.lock().unwrap(), 2, cached)
            .unwrap();
        fixture
            .cache
            .put(&fixture.db.lock().unwrap(), 2, b"Obsolete cache variant")
            .unwrap();
        fs::remove_file(cache_only).unwrap();
        fixture.material(
            4,
            "assignment.txt",
            b"Restricted academic token",
            "assignment",
        );
        fixture.material(
            5,
            ".history/5/archived.txt",
            b"Retained old version",
            "text",
        );
        fixture.material(6, "slides.pdf", b"%PDF-1.4 Synthetic PDF sentinel", "pdf");
        fixture.db.lock().unwrap().execute_batch("INSERT INTO academic_grades(
            origin,owner_id,course_id,source_id,source_url,observed_at,visibility,title,item_kind,display_value)
            VALUES('https://example.test',1,1,'synthetic','https://example.test/grade','2026-11-20',
                   'released','Private academic grade','item','Privatetestgrade')").unwrap();
        let initial = fixture.rebuild();
        assert_eq!(initial.indexed, 3);
        let hit = fixture
            .search(&["Laplace transform", "analysis"])
            .hits
            .pop()
            .unwrap();
        assert_eq!(hit.resource_id, 1);
        assert!(hit.snippet.contains("<img src=x>"));
        let wire = serde_json::to_value(&hit).unwrap();
        assert_eq!(wire["resourceId"], 1);
        assert_eq!(wire["snippet"], hit.snippet);
        assert_eq!(fixture.search(&["triangle"]).hits[0].resource_id, 2);
        assert!(fixture.search(&["Laplace OR triangle"]).hits.is_empty());
        assert!(fixture.search(&["\" OR *"]).hits.is_empty());
        for excluded in [
            "obsolete",
            "Restricted",
            "old version",
            "sentinel",
            "Privatetestgrade",
        ] {
            assert!(fixture.search(&[excluded]).hits.is_empty(), "{excluded}");
        }

        fixture.material(1, "current.txt", b"Fourier substitution", "text");
        assert!(fixture.search(&["Laplace"]).hits.is_empty());
        fs::remove_file(deleted).unwrap();
        assert!(fixture.search(&["manual deletion"]).hits.is_empty());
        assert_eq!(fixture.cache.evict_to(&fixture.db.lock().unwrap(), 0), 2);
        assert!(fixture.search(&["triangle"]).hits.is_empty());
        assert_eq!(fixture.rebuild().indexed, 1);
        assert_eq!(fixture.search(&["Fourier"]).hits[0].resource_id, 1);
        fixture
            .db
            .lock()
            .unwrap()
            .execute("DELETE FROM local_files WHERE resource_id=1", [])
            .unwrap();
        assert!(fixture.search(&["Fourier"]).hits.is_empty());
        assert_eq!(fixture.rebuild().indexed, 0);
        let conn = fixture.db.lock().unwrap();
        assert_eq!(
            crate::search::desktop_inventory(&conn)
                .unwrap()
                .resources
                .len(),
            6
        );
        assert_eq!(db::count_events(&conn), 0);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn rust_review_saved_text_excludes_in_root_directory_links() {
        let fixture = Fixture::new();
        let body = b"quartz directory linked text";
        let saved = fixture.material(1, "alias/document.txt", body, "resource");
        assert_eq!(fixture.rebuild().indexed, 1);
        let alias = saved.parent().unwrap();
        let target = fixture.mirror().join("target");
        fs::rename(alias, &target).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, alias).unwrap();
        #[cfg(windows)]
        {
            // Junctions exercise the reparse attribute without needing the
            // Windows privilege required to create symbolic links.
            let output = std::process::Command::new("cmd.exe")
                .args(["/C", "mklink", "/J"])
                .arg(alias)
                .arg(&target)
                .output()
                .unwrap();
            assert!(output.status.success(), "{output:?}");
        }
        assert!(fixture.search(&["quartz"]).hits.is_empty());
        assert_eq!(fixture.rebuild().indexed, 0);
    }

    #[test]
    fn cancelled_or_concurrent_rebuild_preserves_previous_search() {
        let fixture = Fixture::new();
        fixture.material(1, "current.txt", b"Preserved text", "text");
        fixture.rebuild();

        // Reserve the operation the same way the command does, then cancel
        // before the blocking worker has been scheduled.
        let build = fixture.index.begin_rebuild().unwrap();
        assert!(fixture.index.begin_rebuild().is_none());
        assert_eq!(fixture.search(&["preserved"]).state, "building");
        fixture.index.cancel();
        let result = build
            .run(&fixture.db, &fixture.mirror(), fixture.cache.root())
            .unwrap();
        assert_eq!(result.state, "cancelled");
        assert_eq!(fixture.search(&["preserved"]).hits.len(), 1);
    }

    #[test]
    fn invalid_and_oversized_text_falls_back_and_inventory_limit_does_not_affect_metadata() {
        let fixture = Fixture::new();
        fixture.material(1, "oversize.txt", &vec![b'a'; MAX_BYTES + 1], "text");
        fixture.material(2, "invalid.txt", b"\xffSynthetic binary", "text");
        let report = fixture.rebuild();
        assert_eq!(report.indexed, 0);
        assert_eq!(report.skipped, 2);
        let conn = fixture.db.lock().unwrap();
        conn.execute_batch("WITH RECURSIVE ids(id) AS (SELECT 3 UNION ALL SELECT id+1 FROM ids WHERE id < 5001)
            INSERT INTO resources(id,external_resource_id,title,url,resource_type,first_seen_at)
            SELECT id, 'extra:' || id, 'Metadata', 'https://example.test', 'text', '2026-11-20' FROM ids;").unwrap();
        assert_eq!(
            crate::search::desktop_inventory(&conn)
                .unwrap()
                .resources
                .len(),
            5_001
        );
        drop(conn);
        assert_eq!(fixture.rebuild().state, "tooLarge");
        assert_eq!(fixture.search(&["Metadata"]).state, "tooLarge");
    }
}

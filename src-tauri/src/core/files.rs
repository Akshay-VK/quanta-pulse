//! On-demand local cache of downloaded resource bytes.
//!
//! Layout: `<data dir>/files/<resource_id>/<sha256 of the bytes>`. The
//! `file_cache` table indexes it; the filesystem holds the payload.
//!
//! Two invariants keep this honest:
//!
//! - A row whose file has vanished is treated as a miss, not an error. The
//!   entry is left for the next `put` to replace, so the cache self-heals
//!   instead of serving a stale path.
//! - Caching bytes is not a content change. Nothing here writes a
//!   `change_events` row, and the baseline-scan rule is untouched.
//!
//! The hash is over the file's bytes, so an updated resource gets a fresh
//! entry and text extraction can skip work when the bytes are unchanged.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::db;
use crate::models::CacheStats;

/// Root of the byte cache, rooted at the application data directory.
pub struct FileStore {
    root: PathBuf,
}

impl FileStore {
    /// `dir` is the app data directory — the database file's parent.
    pub fn new(dir: &Path) -> Self {
        FileStore { root: dir.join("files") }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Where a given content hash would live.
    pub fn path_for(&self, resource_id: i64, content_hash: &str) -> PathBuf {
        self.root.join(resource_id.to_string()).join(content_hash)
    }

    /// Read a cached file and refresh its LRU stamp. `None` when the row is
    /// missing or its bytes are gone from disk.
    pub fn read(&self, conn: &Connection, resource_id: i64, content_hash: &str) -> Option<Vec<u8>> {
        let row = db::cache_get(conn, resource_id, content_hash).ok().flatten()?;
        let bytes = fs::read(&row.path).ok()?;
        let _ = db::cache_touch(conn, resource_id, content_hash, &db::now_rfc3339());
        Some(bytes)
    }

    /// The most recently used cached bytes for a resource, whatever its hash.
    pub fn read_latest(&self, conn: &Connection, resource_id: i64) -> Option<(String, Vec<u8>)> {
        let row = db::cache_for_resource(conn, resource_id).ok()?.into_iter().next()?;
        let bytes = fs::read(&row.path).ok()?;
        let _ = db::cache_touch(conn, resource_id, &row.content_hash, &db::now_rfc3339());
        Some((row.content_hash, bytes))
    }

    /// Write bytes to disk and index them. Returns the content hash used for the
    /// path, so callers can key extraction on the same value.
    pub fn put(&self, conn: &Connection, resource_id: i64, bytes: &[u8]) -> std::io::Result<String> {
        let hash = hash_bytes(bytes);
        let path = self.path_for(resource_id, &hash);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, bytes)?;
        db::cache_upsert(
            conn,
            resource_id,
            &hash,
            &path.to_string_lossy(),
            bytes.len() as i64,
            &db::now_rfc3339(),
        )
        .map_err(std::io::Error::other)?;
        Ok(hash)
    }

    /// Remove every cached variant of one resource. Returns how many were
    /// dropped (bytes on disk and index rows alike).
    pub fn remove_resource(&self, conn: &Connection, resource_id: i64) -> usize {
        let rows = db::cache_for_resource(conn, resource_id).unwrap_or_default();
        for row in &rows {
            let _ = fs::remove_file(&row.path);
            let _ = db::cache_delete(conn, resource_id, &row.content_hash);
        }
        let _ = fs::remove_dir(self.root.join(resource_id.to_string()));
        rows.len()
    }

    /// Unlink least-recently-used files until the cache is back under
    /// `limit_bytes`. Returns the number of files evicted.
    pub fn evict_to(&self, conn: &Connection, limit_bytes: u64) -> usize {
        let (mut total, _) = db::cache_stats(conn).unwrap_or((0, 0));
        let mut removed = 0;
        while total > 0 && total as u64 > limit_bytes {
            // One row at a time keeps the accounting exact; the cache holds
            // hundreds of files, not millions.
            let Some(oldest) = db::cache_lru(conn, 1).ok().and_then(|v| v.into_iter().next()) else {
                break;
            };
            let _ = fs::remove_file(&oldest.path);
            let _ = db::cache_delete(conn, oldest.resource_id, &oldest.content_hash);
            total -= oldest.size_bytes;
            removed += 1;
        }
        if removed > 0 {
            self.prune_empty_dirs();
        }
        removed
    }

    /// Delete the entire cache. Returns how many files were dropped.
    pub fn clear(&self, conn: &Connection) -> usize {
        let rows = db::cache_clear(conn).unwrap_or_default();
        let _ = fs::remove_dir_all(&self.root);
        rows.len()
    }

    /// Occupancy as the UI reports it.
    pub fn stats(&self, conn: &Connection, limit_bytes: u64) -> CacheStats {
        let (total_bytes, file_count) = db::cache_stats(conn).unwrap_or((0, 0));
        CacheStats { file_count, total_bytes, limit_bytes }
    }

    /// Remove `<root>/<id>` directories left behind by `remove_resource`.
    fn prune_empty_dirs(&self) {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let _ = fs::remove_dir(entry.path());
            }
        }
    }
}

/// Content hash of a file's bytes, used for both the cache path and the
/// extraction key.
pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ResourceWrite;

    fn store_and_conn() -> (tempfile::TempDir, FileStore, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let store = FileStore::new(dir.path());
        (dir, store, conn)
    }

    /// file_cache has a foreign key on resources, so a resource has to exist.
    fn seed_resource(conn: &Connection, external_id: &str) -> i64 {
        let cid = db::upsert_course(conn, "10", "CS F222", None, "https://x/10", "t0").unwrap();
        db::upsert_resource(
            conn,
            &ResourceWrite {
                external_id,
                course_id: Some(cid),
                title: "Lecture 1",
                url: "https://x/1.pdf",
                source_page_url: None,
                section_path: None,
                resource_type: "pdf",
                uploaded_at: None,
                published_at: None,
                modified_at: None,
                due_at: None,
                fingerprint: "fp1",
                size_bytes: Some(4),
                section: None,
                is_external: false,
                availability: "available",
            },
            "t1",
        )
        .unwrap();
        db::get_resource(conn, external_id).unwrap().id
    }

    #[test]
    fn put_then_read_round_trips_and_shares_the_path_hash() {
        let (_dir, store, conn) = store_and_conn();
        let id = seed_resource(&conn, "mod:resource:1");
        let hash = store.put(&conn, id, b"hello").unwrap();

        assert_eq!(hash, hash_bytes(b"hello"));
        assert!(store.path_for(id, &hash).exists());
        assert_eq!(store.read(&conn, id, &hash).as_deref(), Some(&b"hello"[..]));
        assert_eq!(store.read_latest(&conn, id).unwrap().1, b"hello");
    }

    #[test]
    fn a_row_whose_file_vanished_reads_as_a_miss() {
        let (_dir, store, conn) = store_and_conn();
        let id = seed_resource(&conn, "mod:resource:1");
        let hash = store.put(&conn, id, b"gone").unwrap();
        fs::remove_file(store.path_for(id, &hash)).unwrap();

        assert!(store.read(&conn, id, &hash).is_none());
        assert!(store.read_latest(&conn, id).is_none());
    }

    #[test]
    fn eviction_drops_the_oldest_files_first_and_unlinks_them() {
        let (_dir, store, conn) = store_and_conn();
        let id = seed_resource(&conn, "mod:resource:1");

        // Three 100-byte files, written oldest to newest.
        let older = store.put(&conn, id, &[b'a'; 100]).unwrap();
        db::cache_touch(&conn, id, &older, "2026-01-01T00:00:00Z").unwrap();
        let middle = store.put(&conn, id, &[b'b'; 100]).unwrap();
        db::cache_touch(&conn, id, &middle, "2026-01-02T00:00:00Z").unwrap();
        let newest = store.put(&conn, id, &[b'c'; 100]).unwrap();
        db::cache_touch(&conn, id, &newest, "2026-01-03T00:00:00Z").unwrap();

        assert_eq!(store.evict_to(&conn, 150), 2);
        assert!(!store.path_for(id, &older).exists());
        assert!(!store.path_for(id, &middle).exists());
        assert!(store.path_for(id, &newest).exists());
        assert_eq!(store.stats(&conn, 1_000_000_000).file_count, 1);
    }

    #[test]
    fn clear_removes_every_row_and_file() {
        let (_dir, store, conn) = store_and_conn();
        let id = seed_resource(&conn, "mod:resource:1");
        store.put(&conn, id, b"one").unwrap();
        store.put(&conn, id, b"two").unwrap();

        assert_eq!(store.clear(&conn), 2);
        assert!(!store.root().exists());
        assert_eq!(store.stats(&conn, 1).file_count, 0);
    }

    #[test]
    fn removing_a_resource_leaves_other_resources_alone() {
        let (_dir, store, conn) = store_and_conn();
        let a = seed_resource(&conn, "mod:resource:1");
        let b = seed_resource(&conn, "mod:resource:2");
        store.put(&conn, a, b"a").unwrap();
        store.put(&conn, b, b"b").unwrap();

        assert_eq!(store.remove_resource(&conn, a), 1);
        assert!(store.read_latest(&conn, a).is_none());
        assert!(store.read_latest(&conn, b).is_some());
    }

    #[test]
    fn hash_is_stable_and_distinguishes_content() {
        assert_eq!(hash_bytes(b"x"), hash_bytes(b"x"));
        assert_ne!(hash_bytes(b"x"), hash_bytes(b"y"));
    }
}

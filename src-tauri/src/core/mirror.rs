//! The permanent local mirror of everything Quanta serves.
//!
//! The job: every file and page Quanta serves is downloaded, kept, and readable
//! instantly — opening, previewing, searching or sending it should never need
//! the network. Files are laid out for a human:
//!
//! ```text
//! <root>/<course display name>/<section path>/<filename>
//! <root>/<course display name>/Announcements/<yyyy-MM-dd> <title>.md
//! <root>/.history/<resource_id>/<yyyyMMdd-HHmmss>_<name>
//! ```
//!
//! Rules that make this a mirror and not a cache:
//!
//! - **Nothing is evicted and nothing is deleted automatically.** A resource
//!   that disappears from Quanta keeps its copy with status `kept`. Only an
//!   explicit user action removes anything. (`core::files` is the evictable
//!   preview cache and stays that way; `local_file` reads the mirror first.)
//! - **Mirroring is not a content change.** Nothing here writes a
//!   `change_events` row, and the baseline-scan rule is untouched.
//! - **A login page is never saved as a file.** Moodle answers an expired
//!   session with HTTP 200 and HTML; that is detected and treated as an auth
//!   failure, the queue waits, and it resumes when the session is restored.
//! - **Nothing is lost on a failure.** Bytes stream to `<name>.part` while the
//!   SHA-256 is computed, and the finished file is renamed into place only after
//!   the previous copy has been moved into `.history`. An interrupted download
//!   resumes with a `Range` request.
//!
//! The queue lives in SQLite (`download_queue`) so an interrupted backfill
//! survives a restart, and the whole module takes plain handles — a connection
//! mutex and a client — so the Tauri commands, and later a Telegram bot or an
//! MCP server, can drive the same code.

mod markdown;
mod paths;

pub use markdown::{html_to_markdown, snapshot};
pub use paths::{build_rel_path, join_within, sanitize_segment, unique_rel_path};

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use tokio::sync::broadcast;

use crate::db::{self, MirrorRow, MirrorVersion};
use crate::models::{LocalFile, MirrorDownloadProgress, MirrorStats};
use crate::quanta::client::{DownloadRequest, QuantaClient, QuantaError};
use crate::quanta::preview::{preview_kind, PreviewKind};
use crate::quanta::urlnorm;
use crate::settings::Settings;

/// Downloads in flight at once.
pub const CONCURRENCY: usize = 3;
/// Minimum gap between two downloads starting.
const START_GAP: Duration = Duration::from_millis(200);
/// No bytes for this long counts as a stall and ends the transfer.
const STALL_TIMEOUT: Duration = Duration::from_secs(60);
/// Windows can refuse a rename while a scanner holds the file open.
const RENAME_ATTEMPTS: u32 = 5;
const RENAME_DELAY: Duration = Duration::from_millis(200);
/// How long `ensure_local` waits for an on-demand download by default.
pub const ENSURE_TIMEOUT: Duration = Duration::from_secs(60);
/// Free space is re-checked at most this often while the queue is busy.
const FREE_SPACE_CACHE: Duration = Duration::from_secs(30);

/// Priority tiers. Lower runs first.
pub const P_ON_DEMAND: i64 = 0;
pub const P_CHANGED: i64 = 1;
pub const P_BACKFILL: i64 = 2;

pub const ST_QUEUED: &str = "queued";
pub const ST_DOWNLOADING: &str = "downloading";
pub const ST_OK: &str = "ok";
pub const ST_FAILED: &str = "failed";
pub const ST_SKIPPED: &str = "skipped";
pub const ST_KEPT: &str = "kept";

pub const S_IDLE: &str = "idle";
pub const S_RUNNING: &str = "running";
pub const S_PAUSED: &str = "paused";
pub const S_LOW_DISK: &str = "low_disk";
pub const S_SIGN_IN: &str = "waiting_for_sign_in";

const HISTORY_DIR: &str = ".history";

/// What the mirror needs from the application. Built by the adapter (a Tauri
/// command today) so this module never reaches into the app state itself.
pub struct MirrorCtx<'a> {
    pub conn: &'a Mutex<Connection>,
    pub client: Option<Arc<QuantaClient>>,
}

impl MirrorCtx<'_> {
    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MirrorConfig {
    pub enabled: bool,
    /// Files larger than this are skipped. 0 means no limit.
    pub max_bytes: u64,
    /// Pause rather than fill the disk below this floor. 0 disables the check.
    pub min_free_bytes: u64,
    pub keep_versions: usize,
}

impl Default for MirrorConfig {
    fn default() -> Self {
        MirrorConfig {
            enabled: true,
            max_bytes: 500 * 1024 * 1024,
            min_free_bytes: 5 * 1024 * 1024 * 1024,
            keep_versions: 3,
        }
    }
}

impl MirrorConfig {
    pub fn from_settings(s: &Settings) -> Self {
        MirrorConfig {
            enabled: s.mirror_enabled,
            max_bytes: s.mirror_max_bytes,
            min_free_bytes: s.mirror_min_free_bytes,
            keep_versions: s.mirror_keep_versions,
        }
    }
}

/// What the mirror tells the rest of the app. The Tauri layer forwards these as
/// `mirror:progress` and `mirror:file`; a bot would subscribe the same way.
#[derive(Debug, Clone)]
pub enum MirrorEvent {
    Progress(Box<MirrorStats>),
    File {
        resource_id: i64,
        status: String,
        error: Option<String>,
    },
}

struct DownloadAttempt {
    progress: Mutex<MirrorDownloadProgress>,
    cancelled: AtomicBool,
    started: AtomicBool,
}

/// The result of one download attempt.
enum Attempt {
    /// The local copy is on disk and current.
    Done,
    /// Transient: stay queued and retry after a backoff.
    Retry(String),
    /// Permanent for this resource: off the queue.
    Fail(String),
    /// Deliberately not downloaded (too large, external link).
    Skip(String),
    /// A global condition, or nothing at all. The item keeps its place in the
    /// queue and the state becomes the given value (or idle when `None`).
    Defer(Option<&'static str>),
    Cancelled,
}

pub struct Mirror {
    root: Mutex<PathBuf>,
    /// Where the mirror lives when the user has not chosen a folder.
    default_root: PathBuf,
    config: Mutex<MirrorConfig>,
    paused: AtomicBool,
    state: Mutex<String>,
    events: broadcast::Sender<MirrorEvent>,
    download_events: broadcast::Sender<MirrorDownloadProgress>,
    /// Wakes an idle worker when work is enqueued.
    wake: tokio::sync::Notify,
    free_space: Mutex<(u64, Instant)>,
    attempts: Mutex<HashMap<i64, Arc<DownloadAttempt>>>,
    next_attempt: AtomicU64,
    #[cfg(test)]
    before_publish: Mutex<Option<(Arc<std::sync::Barrier>, Arc<std::sync::Barrier>)>>,
}

impl Mirror {
    pub fn new(default_root: PathBuf, config: MirrorConfig) -> Arc<Self> {
        let (events, _) = broadcast::channel(64);
        let (download_events, _) = broadcast::channel(128);
        Arc::new(Mirror {
            root: Mutex::new(default_root.clone()),
            default_root,
            config: Mutex::new(config),
            paused: AtomicBool::new(false),
            state: Mutex::new(S_IDLE.to_string()),
            events,
            download_events,
            wake: tokio::sync::Notify::new(),
            free_space: Mutex::new((0, Instant::now() - FREE_SPACE_CACHE)),
            attempts: Mutex::new(HashMap::new()),
            next_attempt: AtomicU64::new(1),
            #[cfg(test)]
            before_publish: Mutex::new(None),
        })
    }

    /// `<Documents>/Quanta Pulse/Files`, or a sensible fallback when the
    /// platform does not report a Documents directory.
    pub fn default_root(documents: Option<PathBuf>, fallback: &Path) -> PathBuf {
        documents
            .unwrap_or_else(|| fallback.to_path_buf())
            .join("Quanta Pulse")
            .join("Files")
    }

    pub fn subscribe(&self) -> broadcast::Receiver<MirrorEvent> {
        self.events.subscribe()
    }

    pub fn subscribe_download_progress(&self) -> broadcast::Receiver<MirrorDownloadProgress> {
        self.download_events.subscribe()
    }

    /// Ask an idle worker to look at the queue now. `notify_one` rather than
    /// `notify_waiters`: a wake that arrives between two waits must not be lost.
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// Block until work may exist again (or the timeout expires).
    pub async fn idle_wait(&self, timeout: Duration) {
        let _ = tokio::time::timeout(timeout, self.wake.notified()).await;
    }

    pub fn root(&self) -> PathBuf {
        self.root.lock().unwrap().clone()
    }

    pub fn set_root(&self, root: PathBuf) {
        *self.root.lock().unwrap() = root;
        *self.free_space.lock().unwrap() = (0, Instant::now() - FREE_SPACE_CACHE);
    }

    pub fn config(&self) -> MirrorConfig {
        self.config.lock().unwrap().clone()
    }

    /// Adopt a settings row: the config, and the root — resolving "no folder
    /// chosen" against the default, so clearing the field moves the mirror back
    /// instead of orphaning it on the old path.
    pub fn apply_settings(&self, s: &Settings) {
        *self.config.lock().unwrap() = MirrorConfig::from_settings(s);
        let resolved = match s
            .mirror_root
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
        {
            Some(raw) => PathBuf::from(raw),
            None => self.default_root.clone(),
        };
        if self.root() != resolved {
            self.set_root(resolved);
        }
    }

    pub fn state(&self) -> String {
        self.state.lock().unwrap().clone()
    }

    fn set_state(&self, state: &str) {
        let mut current = self.state.lock().unwrap();
        if *current != state {
            *current = state.to_string();
        }
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
        self.set_state(S_PAUSED);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
        self.set_state(S_IDLE);
        self.wake();
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    /// Clear `waiting_for_sign_in` and pick the queue back up. Called after a
    /// successful sign-in.
    pub fn session_restored(&self) {
        if self.state() == S_SIGN_IN {
            self.set_state(S_IDLE);
        }
        self.resume();
    }

    fn emit(&self, event: MirrorEvent) {
        // Nobody listening is not an error: `mirror_status` is the fallback.
        let _ = self.events.send(event);
    }

    fn emit_file(&self, resource_id: i64, status: &str, error: Option<&str>) {
        self.emit(MirrorEvent::File {
            resource_id,
            status: status.to_string(),
            error: error.map(str::to_string),
        });
    }

    fn begin_attempt(&self, resource_id: i64) -> Arc<DownloadAttempt> {
        let mut attempts = self.attempts.lock().unwrap();
        if let Some(current) = attempts.get(&resource_id) {
            if !current.cancelled.load(Ordering::SeqCst)
                && current.progress.lock().unwrap().state != "saved"
                && current.progress.lock().unwrap().state != "failed"
            {
                return current.clone();
            }
        }
        let attempt = self.new_attempt(resource_id, "downloading");
        attempts.insert(resource_id, attempt.clone());
        attempt
    }

    fn new_attempt(&self, resource_id: i64, state: &str) -> Arc<DownloadAttempt> {
        let id = self.next_attempt.fetch_add(1, Ordering::Relaxed);
        Arc::new(DownloadAttempt {
            progress: Mutex::new(MirrorDownloadProgress {
                resource_id,
                attempt_id: format!("{resource_id}-{id}"),
                state: state.into(),
                bytes_done: 0,
                bytes_total: None,
                error: None,
            }),
            cancelled: AtomicBool::new(false),
            started: AtomicBool::new(false),
        })
    }

    fn emit_file_progress(&self, attempt: &DownloadAttempt) {
        let _ = self
            .download_events
            .send(attempt.progress.lock().unwrap().clone());
    }

    /// Remove a shared partial only while this attempt still owns the resource.
    /// Holding the attempt map lock makes this atomic with retry replacing it:
    /// either cleanup finishes before the successor starts, or stale cleanup
    /// leaves the successor's partial alone.
    fn remove_part_if_current(
        &self,
        resource_id: i64,
        attempt: &Arc<DownloadAttempt>,
        part: &Path,
    ) {
        let attempts = self.attempts.lock().unwrap();
        if attempts
            .get(&resource_id)
            .is_some_and(|active| Arc::ptr_eq(active, attempt))
        {
            let _ = fs::remove_file(part);
        }
    }

    pub fn download_progress(&self, conn: &Connection) -> Vec<MirrorDownloadProgress> {
        let mut rows = HashMap::new();
        for row in db::mirror_all(conn).unwrap_or_default() {
            let state = match row.status.as_str() {
                ST_OK | ST_KEPT => "saved",
                ST_FAILED => "failed",
                ST_QUEUED => "queued",
                _ => continue,
            };
            rows.insert(
                row.resource_id,
                MirrorDownloadProgress {
                    resource_id: row.resource_id,
                    attempt_id: format!("{}-saved", row.resource_id),
                    state: state.into(),
                    bytes_done: if state == "saved" {
                        row.size_bytes.max(0) as u64
                    } else {
                        0
                    },
                    bytes_total: if state == "saved" {
                        Some(row.size_bytes.max(0) as u64)
                    } else {
                        None
                    },
                    error: row.error,
                },
            );
        }
        for (id, attempt) in self.attempts.lock().unwrap().iter() {
            rows.insert(*id, attempt.progress.lock().unwrap().clone());
        }
        rows.into_values().collect()
    }

    pub fn cancel_download(&self, conn: &Connection, resource_id: i64) -> MirrorDownloadProgress {
        let mut attempts = self.attempts.lock().unwrap();
        let attempt = attempts.get(&resource_id).cloned().unwrap_or_else(|| {
            let created = self.new_attempt(resource_id, "cancelled");
            attempts.insert(resource_id, created.clone());
            created
        });
        attempt.cancelled.store(true, Ordering::SeqCst);
        let _ = db::queue_remove(conn, resource_id);
        let saved = db::mirror_get(conn, resource_id)
            .ok()
            .flatten()
            .filter(|row| matches!(row.status.as_str(), ST_OK | ST_KEPT))
            .filter(|row| {
                join_within(&self.root(), &row.rel_path).is_some_and(|path| path.is_file())
            });
        {
            let mut p = attempt.progress.lock().unwrap();
            if let Some(row) = saved {
                p.state = "saved".into();
                p.bytes_done = row.size_bytes.max(0) as u64;
                p.bytes_total = Some(row.size_bytes.max(0) as u64);
            } else {
                p.state = "cancelled".into();
            }
            p.error = None;
        }
        if let Some(row) = db::mirror_get(conn, resource_id).ok().flatten() {
            if let Some(path) = join_within(&self.root(), &row.rel_path) {
                if let Some(name) = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                {
                    let _ = fs::remove_file(path.with_file_name(format!("{name}.part")));
                }
            }
        }
        self.emit_file_progress(&attempt);
        let result = attempt.progress.lock().unwrap().clone();
        drop(attempts);
        result
    }

    pub fn retry_download(&self, conn: &Connection, resource_id: i64) -> MirrorDownloadProgress {
        if let Some(row) = db::mirror_get(conn, resource_id)
            .ok()
            .flatten()
            .filter(|r| matches!(r.status.as_str(), ST_OK | ST_KEPT))
        {
            if join_within(&self.root(), &row.rel_path).is_some_and(|p| p.is_file()) {
                return MirrorDownloadProgress {
                    resource_id,
                    attempt_id: format!("{resource_id}-saved"),
                    state: "saved".into(),
                    bytes_done: row.size_bytes.max(0) as u64,
                    bytes_total: Some(row.size_bytes.max(0) as u64),
                    error: None,
                };
            }
        }
        let mut attempts = self.attempts.lock().unwrap();
        if let Some(old) = attempts.remove(&resource_id) {
            old.cancelled.store(true, Ordering::SeqCst);
        }
        let attempt = self.new_attempt(resource_id, "queued");
        attempts.insert(resource_id, attempt.clone());
        let _ = db::queue_enqueue(conn, resource_id, P_ON_DEMAND, &db::now_rfc3339());
        self.wake();
        self.emit_file_progress(&attempt);
        let result = attempt.progress.lock().unwrap().clone();
        drop(attempts);
        result
    }

    fn emit_progress(&self, ctx: &MirrorCtx<'_>) {
        let stats = {
            let conn = ctx.lock();
            self.stats(&conn)
        };
        self.emit(MirrorEvent::Progress(Box::new(stats)));
    }

    /* ------------------------------------------------------------ lookup */

    /// The local copy of a resource: the mirror first, then the preview cache.
    ///
    /// A row whose file has vanished reads as a miss rather than an error, so a
    /// resource the user deleted by hand simply downloads again. The cache is a
    /// legitimate fallback because it holds the same bytes under the same
    /// content hash — a preview paid for that download already.
    pub fn local_file(&self, conn: &Connection, resource_id: i64) -> Option<LocalFile> {
        if let Some(row) = db::mirror_get(conn, resource_id).ok().flatten() {
            if matches!(row.status.as_str(), ST_OK | ST_KEPT) {
                if let Some(path) = join_within(&self.root(), &row.rel_path) {
                    if path.is_file() {
                        return Some(LocalFile {
                            resource_id,
                            rel_path: row.rel_path,
                            path: path.to_string_lossy().into_owned(),
                            size_bytes: row.size_bytes,
                            mime: row.mime,
                            sha256: row.sha256,
                            status: row.status,
                            error: row.error,
                        });
                    }
                }
            }
        }

        let cached = db::cache_for_resource(conn, resource_id)
            .ok()?
            .into_iter()
            .next()?;
        let path = PathBuf::from(&cached.path);
        if !path.is_file() {
            return None;
        }
        Some(LocalFile {
            resource_id,
            rel_path: cached.content_hash.clone(),
            path: cached.path,
            size_bytes: cached.size_bytes,
            mime: None,
            sha256: Some(cached.content_hash),
            status: ST_OK.to_string(),
            error: None,
        })
    }

    /// The local copy's bytes, at most `max_bytes`. `None` when there is no
    /// local copy or the file is larger than the caller wants to hold.
    ///
    /// The reading half of `local_file`, for callers that need the content and
    /// not only the path: the in-app preview, the content index, and a future
    /// Telegram `/get`.
    pub fn local_bytes(
        &self,
        conn: &Connection,
        resource_id: i64,
        max_bytes: u64,
    ) -> Option<(LocalFile, Vec<u8>)> {
        let file = self.local_file(conn, resource_id)?;
        if u64::try_from(file.size_bytes).unwrap_or(u64::MAX) > max_bytes {
            return None;
        }
        let bytes = fs::read(&file.path).ok()?;
        Some((file, bytes))
    }

    pub fn stats(&self, conn: &Connection) -> MirrorStats {
        let counts = db::mirror_counts(conn).unwrap_or_default();
        let count = |status: &str| {
            counts
                .iter()
                .find(|(s, _)| s == status)
                .map(|(_, c)| *c)
                .unwrap_or(0)
        };
        let (bytes_done, done) = db::mirror_bytes(conn).unwrap_or((0, 0));
        let (bytes_total, total_resources) = db::mirror_totals(conn).unwrap_or((0, 0));
        let root = self.root();
        MirrorStats {
            queued: db::queue_len(conn),
            downloading: count(ST_DOWNLOADING),
            done,
            failed: count(ST_FAILED),
            skipped: count(ST_SKIPPED),
            kept: count(ST_KEPT),
            total_resources,
            bytes_done,
            bytes_total,
            state: self.state(),
            root: root.to_string_lossy().into_owned(),
            free_bytes: self.free_space(&root),
        }
    }

    /* ------------------------------------------------------------- queue */

    pub fn enqueue(&self, conn: &Connection, resource_id: i64, priority: i64) {
        if db::queue_enqueue(conn, resource_id, priority, &db::now_rfc3339()).is_ok() {
            self.wake();
        }
    }

    /// Backfill every resource that has no local copy, and re-check anything
    /// whose metadata changed since we last looked.
    pub fn enqueue_all(&self, conn: &Connection) -> usize {
        let now = db::now_rfc3339();
        let backfill = db::queue_backfill(conn, &now).unwrap_or(0);
        let recheck = db::queue_recheck_modified(conn, &now).unwrap_or(0);
        self.wake();
        backfill + recheck
    }

    /// Put every failed or skipped resource back in the queue, clearing the
    /// attempt count so the backoff starts over.
    pub fn retry_failed(&self, conn: &Connection) -> usize {
        let mut retried = 0;
        for status in [ST_FAILED, ST_SKIPPED] {
            for row in db::mirror_list_status(conn, status).unwrap_or_default() {
                let cleared = MirrorRow {
                    status: ST_QUEUED.to_string(),
                    error: None,
                    attempts: 0,
                    ..row
                };
                if db::mirror_upsert(conn, &cleared).is_ok() {
                    self.enqueue(conn, cleared.resource_id, P_CHANGED);
                    retried += 1;
                }
            }
        }
        if retried > 0 {
            self.set_state(S_IDLE);
            self.wake();
        }
        retried
    }

    /// Mark every locally held copy of an unavailable resource as `kept`.
    /// The file is never deleted.
    pub fn mark_unavailable_kept(&self, conn: &Connection) -> usize {
        conn.execute(
            "UPDATE local_files SET status = 'kept'
              WHERE status IN ('ok', 'failed', 'skipped')
                AND resource_id IN (SELECT id FROM resources WHERE availability_status = 'unavailable')",
            [],
        )
        .unwrap_or(0)
    }

    /* ------------------------------------------------------------ worker */

    /// One pass of the queue: up to [`CONCURRENCY`] downloads, each starting
    /// [`START_GAP`] after the previous. Returns how many were attempted.
    pub async fn tick(&self, ctx: &MirrorCtx<'_>) -> usize {
        if self.is_paused() || !self.config().enabled || self.state() == S_SIGN_IN {
            return 0;
        }

        let items = {
            let conn = ctx.lock();
            db::queue_next(&conn, CONCURRENCY as i64).unwrap_or_default()
        };
        if items.is_empty() {
            self.set_state(S_IDLE);
            return 0;
        }

        self.set_state(S_RUNNING);
        match items.len() {
            1 => {
                self.download_one(ctx, &items[0], 0).await;
            }
            2 => {
                tokio::join!(
                    self.download_one(ctx, &items[0], 0),
                    self.download_one(ctx, &items[1], 1)
                );
            }
            _ => {
                tokio::join!(
                    self.download_one(ctx, &items[0], 0),
                    self.download_one(ctx, &items[1], 1),
                    self.download_one(ctx, &items[2], 2)
                );
            }
        }

        self.emit_progress(ctx);
        let remaining = {
            let conn = ctx.lock();
            db::queue_len(&conn)
        };
        if remaining == 0 {
            self.set_state(S_IDLE);
        }
        items.len()
    }

    /// Download one resource, then record the outcome.
    async fn download_one(&self, ctx: &MirrorCtx<'_>, item: &db::QueueItem, slot: usize) {
        if slot > 0 {
            // Smooths the start bursts a backfill would otherwise produce.
            tokio::time::sleep(START_GAP * slot as u32).await;
        }
        if self.is_paused() {
            return;
        }
        let attempt = self.begin_attempt(item.resource_id);
        if attempt.cancelled.load(Ordering::SeqCst) {
            return;
        }
        // The queue row remains present until `apply` records the outcome, so
        // overlapping ticks can select it again. Only one worker owns the
        // network attempt represented by this shared progress identity.
        if attempt
            .started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        self.emit_file_progress(&attempt);
        let outcome = self.attempt(ctx, item.resource_id, &attempt).await;
        if attempt.cancelled.load(Ordering::SeqCst) {
            return;
        }
        let current = self
            .attempts
            .lock()
            .unwrap()
            .get(&item.resource_id)
            .is_some_and(|active| Arc::ptr_eq(active, &attempt));
        if !current {
            return;
        }
        match &outcome {
            Attempt::Fail(error) | Attempt::Retry(error) | Attempt::Skip(error) => {
                let mut progress = attempt.progress.lock().unwrap();
                progress.state = "failed".into();
                progress.error = Some(error.clone());
                drop(progress);
                self.emit_file_progress(&attempt);
            }
            _ => {}
        }
        let deferred = matches!(&outcome, Attempt::Defer(_));
        self.apply(ctx, item.resource_id, outcome).await;
        if deferred {
            // Defer keeps the queue row and the attempt identity. Let a later
            // tick resume ownership after the temporary condition clears.
            attempt.started.store(false, Ordering::SeqCst);
        }
    }

    /// The download itself. Never touches the queue; that is `apply`'s job.
    async fn attempt(
        &self,
        ctx: &MirrorCtx<'_>,
        resource_id: i64,
        attempt: &Arc<DownloadAttempt>,
    ) -> Attempt {
        let config = self.config();
        let root = self.root();

        // Read what we need, then release the lock for the whole network call.
        let loaded = {
            let conn = ctx.lock();
            db::get_resource_by_id(&conn, resource_id)
                .map(|r| (r, db::mirror_get(&conn, resource_id).ok().flatten()))
        };
        let Some((resource, previous)) = loaded else {
            return Attempt::Fail("The resource no longer exists.".to_string());
        };

        // Backoff: a resource that just failed transiently waits its turn.
        if let Some(prev) = previous.as_ref().filter(|p| p.status == ST_FAILED) {
            if !backoff_elapsed(prev.attempts, prev.last_checked.as_deref()) {
                return Attempt::Defer(None);
            }
        }

        let Ok(url) = url::Url::parse(resource.url.trim()) else {
            return Attempt::Skip("This resource has no downloadable link.".to_string());
        };
        if !urlnorm::is_internal(&url) {
            return Attempt::Skip("This resource lives outside Quanta.".to_string());
        }

        if config.min_free_bytes > 0 && self.free_space(&root) < config.min_free_bytes {
            return Attempt::Defer(Some(S_LOW_DISK));
        }

        let Some(client) = ctx.client.clone() else {
            return Attempt::Defer(Some(S_SIGN_IN));
        };

        let as_snapshot = matches!(
            preview_kind(&resource.resource_type, Some(&url)),
            PreviewKind::Text
        );

        if let Some(size) = resource.size_bytes {
            if config.max_bytes > 0 && size as u64 > config.max_bytes {
                return Attempt::Skip(format!(
                    "too_large: {} exceeds the download limit.",
                    human_bytes(size as u64)
                ));
            }
        }

        let course = resource
            .course_name
            .clone()
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| "Unfiled".to_string());
        // A text page has no file name of its own, so it becomes a Markdown
        // snapshot in a folder named for what it is. Everything else keeps its
        // place in the course's section tree.
        let (sections, mut wanted_name) = if as_snapshot {
            let folder = if resource.resource_type.eq_ignore_ascii_case("announcement") {
                "Announcements"
            } else {
                "Pages"
            };
            (vec![folder.to_string()], snapshot_filename(&resource))
        } else {
            (
                resource.section_path.clone(),
                // Provisional: Content-Disposition usually provides the real one.
                provisional_filename(&resource, &url),
            )
        };

        // A `.part` next to the final name, so a resume can be found again.
        let (mut rel, mut part) =
            match self.prepare_target(ctx, resource_id, &course, &sections, &wanted_name) {
                Ok(v) => v,
                Err(message) => return Attempt::Fail(message),
            };

        // A `.part` left by an interrupted attempt is resumed with a `Range`
        // request. `If-Range` is what makes that safe: if the file changed on
        // the server since we started, it sends the whole body instead of a tail
        // that would not join up.
        let resume_from = part.metadata().map(|m| m.len()).unwrap_or(0);
        let known_etag = previous
            .as_ref()
            .filter(|p| p.status == ST_FAILED || p.status == ST_DOWNLOADING)
            .and_then(|p| p.source_etag.clone());

        let request = if resume_from > 0 {
            DownloadRequest {
                resume_from,
                if_range: known_etag,
                ..DownloadRequest::default()
            }
        } else {
            // Revalidate rather than re-download when the server supports it.
            DownloadRequest {
                if_none_match: previous.as_ref().and_then(|p| p.source_etag.clone()),
                if_modified_since: previous.as_ref().and_then(|p| p.source_modified.clone()),
                ..DownloadRequest::default()
            }
        };

        let mut response = match client.download(&url, &request).await {
            Ok(r) => r,
            Err(QuantaError::AuthExpired) => return Attempt::Defer(Some(S_SIGN_IN)),
            // The half-file we hold is from a different version: drop it and
            // let the retry fetch the whole thing.
            Err(QuantaError::StaleResume) => {
                self.remove_part_if_current(resource_id, attempt, &part);
                return Attempt::Retry("restarting the download from the beginning".to_string());
            }
            Err(e) if e.is_transient() => return Attempt::Retry(format!("{e}")),
            Err(e) => return Attempt::Fail(format!("{e}")),
        };

        if response.not_modified {
            // The local copy is already current, and any partial file is now
            // meaningless.
            self.remove_part_if_current(resource_id, attempt, &part);
            if let Some(prev) = previous
                .as_ref()
                .filter(|p| p.status == ST_OK || p.status == ST_KEPT)
            {
                let kept = MirrorRow {
                    last_checked: Some(db::now_rfc3339()),
                    error: None,
                    ..prev.clone()
                };
                let conn = ctx.lock();
                let _ = db::mirror_upsert(&conn, &kept);
            }
            return Attempt::Done;
        }

        // The real name, now that the headers are in.
        if !as_snapshot {
            if let Some(from_header) = response
                .content_disposition
                .as_deref()
                .and_then(filename_from_disposition)
            {
                wanted_name = from_header;
                if let Ok(v) =
                    self.prepare_target(ctx, resource_id, &course, &sections, &wanted_name)
                {
                    (rel, part) = v;
                }
            }
        }
        if let Some(size) = response.content_length {
            if config.max_bytes > 0 && size as u64 > config.max_bytes {
                self.remove_part_if_current(resource_id, attempt, &part);
                return Attempt::Skip(format!(
                    "too_large: {} exceeds the download limit.",
                    human_bytes(size as u64)
                ));
            }
        }

        if let Some(parent) = part.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Attempt::Fail(format!("could not create the mirror folder: {e}"));
            }
            if !paths::is_within(&root, parent) {
                return Attempt::Fail("refusing to write outside the mirror folder.".to_string());
            }
        }

        // Recomputed now that the name is final: if the server renamed the file,
        // the partial download belongs to a different name and there is nothing
        // to resume. `If-Range` on the request covers the case where the two
        // `.part` files happen to be the same length.
        let resume_from = part.metadata().map(|m| m.len()).unwrap_or(0);
        let append = resume_from > 0 && response.resumed;
        if resume_from > 0 && !response.resumed {
            // The server ignored the Range header: start over from zero.
            self.remove_part_if_current(resource_id, attempt, &part);
        }

        if attempt.cancelled.load(Ordering::SeqCst) {
            self.remove_part_if_current(resource_id, attempt, &part);
            return Attempt::Cancelled;
        }

        {
            let mut p = attempt.progress.lock().unwrap();
            p.state = "downloading".into();
            p.bytes_done = resume_from;
            p.bytes_total = resource
                .size_bytes
                .and_then(|n| u64::try_from(n).ok())
                .or_else(|| {
                    response
                        .content_length
                        .and_then(|n| u64::try_from(n).ok())
                        .map(|n| n + resume_from)
                });
        }
        self.emit_file_progress(attempt);
        let mut sink = match Sink::open(
            &part,
            append,
            resume_from,
            Some(attempt.clone()),
            Some(self.download_events.clone()),
        ) {
            Ok(s) => s,
            Err(e) => return Attempt::Fail(format!("could not open the target file: {e}")),
        };

        match response
            .stream_to(&mut sink, config.max_bytes, STALL_TIMEOUT)
            .await
        {
            Ok(_) => {}
            Err(QuantaError::Client(message)) if message.contains("download cancelled") => {
                drop(sink);
                self.remove_part_if_current(resource_id, attempt, &part);
                return Attempt::Cancelled;
            }
            Err(QuantaError::AuthExpired) => return Attempt::Defer(Some(S_SIGN_IN)),
            Err(QuantaError::TooLarge) => {
                self.remove_part_if_current(resource_id, attempt, &part);
                return Attempt::Skip(
                    "too_large: the file exceeds the download limit.".to_string(),
                );
            }
            Err(e) if e.is_transient() => {
                // Keep the `.part`: the next attempt resumes from here.
                let _ = sink.file.flush();
                return Attempt::Retry(format!("{e}"));
            }
            Err(e) => return Attempt::Fail(format!("{e}")),
        }

        let (file, sha256, size_bytes) = match sink.finish() {
            Ok(v) => v,
            Err(e) => return Attempt::Fail(format!("could not finish writing the file: {e}")),
        };
        drop(file);
        #[cfg(test)]
        if let Some((arrived, release)) = self.before_publish.lock().unwrap().clone() {
            arrived.wait();
            release.wait();
        }
        if attempt.cancelled.load(Ordering::SeqCst) {
            self.remove_part_if_current(resource_id, attempt, &part);
            return Attempt::Cancelled;
        }

        // Serialize publication with cancel/retry commands through the SQLite
        // connection lock. Those commands hold the same lock before changing
        // the attempt map, so stale attempts cannot publish over their successor.
        let conn = ctx.lock();
        let is_current = self
            .attempts
            .lock()
            .unwrap()
            .get(&resource_id)
            .is_some_and(|active| Arc::ptr_eq(active, attempt));
        if !is_current || attempt.cancelled.load(Ordering::SeqCst) {
            self.remove_part_if_current(resource_id, attempt, &part);
            return Attempt::Cancelled;
        }

        // Identical bytes: keep the existing copy, drop the download.
        if let Some(prev) = previous
            .as_ref()
            .filter(|p| p.status == ST_OK || p.status == ST_KEPT)
        {
            if prev.sha256.as_deref() == Some(sha256.as_str()) {
                self.remove_part_if_current(resource_id, attempt, &part);
                let kept = MirrorRow {
                    last_checked: Some(db::now_rfc3339()),
                    error: None,
                    ..prev.clone()
                };
                let _ = db::mirror_upsert(&conn, &kept);
                {
                    let mut progress = attempt.progress.lock().unwrap();
                    progress.state = "saved".into();
                    progress.bytes_done = size_bytes.max(0) as u64;
                    progress.bytes_total = Some(size_bytes.max(0) as u64);
                    progress.error = None;
                }
                self.emit_file_progress(attempt);
                return Attempt::Done;
            }
            self.archive_previous(&conn, &root, &config, prev);
        }

        if let Err(e) = rename_with_retry(&part, &self.root().join(&rel)) {
            return Attempt::Fail(format!(
                "could not move the downloaded file into place: {e}"
            ));
        }

        let row = MirrorRow {
            resource_id,
            rel_path: rel.clone(),
            sha256: Some(sha256),
            size_bytes,
            mime: response.content_type.clone().or_else(|| {
                Some(
                    if as_snapshot {
                        "text/markdown"
                    } else {
                        "application/octet-stream"
                    }
                    .to_string(),
                )
            }),
            status: ST_OK.to_string(),
            error: None,
            attempts: previous.as_ref().map(|p| p.attempts).unwrap_or(0) + 1,
            source_etag: response.etag.clone(),
            source_modified: response.last_modified.clone(),
            downloaded_at: Some(db::now_rfc3339()),
            last_checked: Some(db::now_rfc3339()),
        };
        if let Err(e) = db::mirror_upsert(&conn, &row) {
            return Attempt::Fail(format!("could not index the local copy: {e}"));
        }
        {
            let mut p = attempt.progress.lock().unwrap();
            p.state = "saved".into();
            p.bytes_done = size_bytes.max(0) as u64;
            p.bytes_total = Some(size_bytes.max(0) as u64);
        }
        self.emit_file_progress(attempt);
        Attempt::Done
    }

    /// Record an attempt's outcome: the queue, the index row and the state.
    async fn apply(&self, ctx: &MirrorCtx<'_>, resource_id: i64, outcome: Attempt) {
        match outcome {
            Attempt::Done => {
                {
                    let conn = ctx.lock();
                    let _ = db::queue_remove(&conn, resource_id);
                }
                self.emit_file(resource_id, ST_OK, None);
            }
            Attempt::Defer(state) => {
                // Nothing is marked failed: an expired session or a full disk is
                // temporary, and the item stays queued. `None` means "no global
                // condition", i.e. we are simply idle.
                self.set_state(state.unwrap_or(S_IDLE));
                self.emit_progress(ctx);
            }
            Attempt::Retry(message) => {
                // The queue row stays put; the backoff is derived from attempts.
                {
                    let conn = ctx.lock();
                    self.bump_attempt(&conn, resource_id, ST_FAILED, Some(&message));
                }
                self.emit_file(resource_id, ST_FAILED, Some(&message));
                self.emit_progress(ctx);
            }
            Attempt::Fail(message) => {
                {
                    let conn = ctx.lock();
                    self.bump_attempt(&conn, resource_id, ST_FAILED, Some(&message));
                    let _ = db::queue_remove(&conn, resource_id);
                }
                self.emit_file(resource_id, ST_FAILED, Some(&message));
                self.emit_progress(ctx);
            }
            Attempt::Skip(message) => {
                {
                    let conn = ctx.lock();
                    self.bump_attempt(&conn, resource_id, ST_SKIPPED, Some(&message));
                    let _ = db::queue_remove(&conn, resource_id);
                }
                self.emit_file(resource_id, ST_SKIPPED, Some(&message));
                self.emit_progress(ctx);
            }
            Attempt::Cancelled => {}
        }
    }

    /// Create or update the index row for a failure, counting the attempt.
    fn bump_attempt(&self, conn: &Connection, resource_id: i64, status: &str, error: Option<&str>) {
        let now = db::now_rfc3339();
        let existing = db::mirror_get(conn, resource_id).ok().flatten();
        let row = MirrorRow {
            resource_id,
            rel_path: existing
                .as_ref()
                .map(|r| r.rel_path.clone())
                .unwrap_or_default(),
            sha256: existing.as_ref().and_then(|r| r.sha256.clone()),
            size_bytes: existing.as_ref().map(|r| r.size_bytes).unwrap_or(0),
            mime: existing.as_ref().and_then(|r| r.mime.clone()),
            status: status.to_string(),
            error: error.map(str::to_string),
            attempts: existing.as_ref().map(|r| r.attempts).unwrap_or(0) + 1,
            source_etag: existing.as_ref().and_then(|r| r.source_etag.clone()),
            source_modified: existing.as_ref().and_then(|r| r.source_modified.clone()),
            downloaded_at: existing.as_ref().and_then(|r| r.downloaded_at.clone()),
            last_checked: Some(now),
        };
        let _ = db::mirror_upsert(conn, &row);
    }

    /// Resolve the relative path and the `.part` path for a download, making
    /// sure an existing copy of a *different* resource is never overwritten.
    ///
    /// This resource's own row is excluded from the collision set, so re-checking
    /// a file does not rename it to `Name (2).pdf` every single time.
    fn prepare_target(
        &self,
        ctx: &MirrorCtx<'_>,
        resource_id: i64,
        course: &str,
        sections: &[String],
        filename: &str,
    ) -> Result<(String, PathBuf), String> {
        let root = self.root();
        let taken = {
            let conn = ctx.lock();
            let mut stmt = conn
                .prepare("SELECT rel_path FROM local_files WHERE resource_id != ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![resource_id], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            let mut set: HashSet<String> = HashSet::new();
            for rel in rows.flatten() {
                set.insert(rel.to_ascii_lowercase());
            }
            set
        };

        let wanted = build_rel_path(course, sections, filename);
        let rel = unique_rel_path(&wanted, &taken);
        let final_path = join_within(&root, &rel)
            .ok_or_else(|| "the file name resolves outside the mirror folder.".to_string())?;
        let file_name = final_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "download".to_string());
        let part = final_path.with_file_name(format!("{file_name}.part"));
        Ok((rel, part))
    }

    /// Move a superseded copy under `.history`, index it, and prune the oldest
    /// beyond the configured `keep`. A failure here is cosmetic: the new copy
    /// still lands, and the worst case is one extra file in `.history`.
    fn archive_previous(
        &self,
        conn: &Connection,
        root: &Path,
        config: &MirrorConfig,
        previous: &MirrorRow,
    ) {
        let Some(old_path) = join_within(root, &previous.rel_path) else {
            return;
        };
        if !old_path.is_file() {
            return;
        }
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let name = old_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "copy".to_string());
        let dir = root
            .join(HISTORY_DIR)
            .join(previous.resource_id.to_string());
        let archived = dir.join(format!("{stamp}_{name}"));
        if fs::create_dir_all(&dir).is_err() {
            return;
        }
        // `rename` first: it is atomic and cheap. A cross-device mirror (the root
        // moved to another drive) falls back to a copy.
        if fs::rename(&old_path, &archived).is_err() && fs::copy(&old_path, &archived).is_err() {
            return;
        }

        let row = MirrorVersion {
            resource_id: previous.resource_id,
            rel_path: previous.rel_path.clone(),
            sha256: previous.sha256.clone(),
            size_bytes: previous.size_bytes,
            replaced_at: db::now_rfc3339(),
        };
        if db::version_insert(conn, &row).is_err() {
            return;
        }
        for dropped in
            db::version_prune(conn, previous.resource_id, config.keep_versions).unwrap_or_default()
        {
            if let Some(path) = join_within(root, &dropped.rel_path) {
                let dir = root.join(HISTORY_DIR).join(dropped.resource_id.to_string());
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                // Remove every archived stamp for that name; keeping a few is
                // the point, keeping orphans is not.
                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let file = entry.file_name().to_string_lossy().into_owned();
                        if file.ends_with(&name) {
                            let _ = fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }

    fn free_space(&self, root: &Path) -> u64 {
        {
            let cached = self.free_space.lock().unwrap();
            if cached.1.elapsed() < FREE_SPACE_CACHE {
                return cached.0;
            }
        }
        let mut probe = root;
        while !probe.exists() {
            match probe.parent() {
                Some(parent) => probe = parent,
                None => break,
            }
        }
        let bytes = fs2::available_space(probe).unwrap_or(u64::MAX);
        *self.free_space.lock().unwrap() = (bytes, Instant::now());
        bytes
    }

    /// Wait for a resource to be local, downloading it at the front of the
    /// queue if needed. Used by 'Open' and by a bot's `/get`.
    ///
    /// Polls the index rather than waiting on a channel: the download happens on
    /// whichever task is driving the queue, and a 200 ms poll is far cheaper than
    /// the wiring a per-resource signal would need.
    pub async fn ensure_local(
        &self,
        ctx: &MirrorCtx<'_>,
        resource_id: i64,
        timeout: Duration,
    ) -> Result<LocalFile, String> {
        if let Some(file) = self.usable(ctx, resource_id) {
            return Ok(file);
        }

        {
            let conn = ctx.lock();
            let known = db::mirror_get(&conn, resource_id).ok().flatten();
            if let Some(known) = known.filter(|r| r.status == ST_FAILED || r.status == ST_SKIPPED) {
                // A retry requested by hand starts from a clean slate.
                let _ = db::mirror_upsert(
                    &conn,
                    &MirrorRow {
                        status: ST_QUEUED.to_string(),
                        error: None,
                        attempts: 0,
                        last_checked: None,
                        ..known
                    },
                );
            }
            db::queue_enqueue(&conn, resource_id, P_ON_DEMAND, &db::now_rfc3339())
                .map_err(|e| e.to_string())?;
        }
        self.set_state(S_IDLE);
        self.wake();

        let deadline = Instant::now() + timeout;
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Some(file) = self.usable(ctx, resource_id) {
                return Ok(file);
            }

            let row = {
                let conn = ctx.lock();
                db::mirror_get(&conn, resource_id).ok().flatten()
            };
            match row.as_ref().map(|r| r.status.as_str()) {
                Some(ST_FAILED) | Some(ST_SKIPPED) => {
                    return Err(row
                        .and_then(|r| r.error)
                        .unwrap_or_else(|| "The download failed.".to_string()))
                }
                _ => {}
            }
            if self.state() == S_SIGN_IN {
                return Err("Sign in to Quanta to download this file.".to_string());
            }
            if Instant::now() >= deadline {
                return Err("Timed out waiting for the download.".to_string());
            }
        }
    }

    /// The local copy when it is actually readable, `kept` copies included: an
    /// unavailable resource is exactly when a local copy is most useful.
    fn usable(&self, ctx: &MirrorCtx<'_>, resource_id: i64) -> Option<LocalFile> {
        let conn = ctx.lock();
        self.local_file(&conn, resource_id)
            .filter(|f| matches!(f.status.as_str(), ST_OK | ST_KEPT))
            .filter(|f| Path::new(&f.path).is_file())
    }

    /// One status row per indexed resource, for the UI's status map. Purely
    /// database state: no file system access, no download.
    pub fn statuses(&self, conn: &Connection) -> Vec<(i64, String, Option<String>)> {
        db::mirror_all(conn)
            .unwrap_or_default()
            .into_iter()
            .map(|r| (r.resource_id, r.status, r.error))
            .collect()
    }

    /// Re-hash every local copy and requeue the ones that are missing or
    /// corrupt. Returns how many were requeued.
    pub fn verify(&self, conn: &Connection) -> usize {
        let root = self.root();
        let mut requeued = 0;
        for row in db::mirror_all(conn).unwrap_or_default() {
            if !matches!(row.status.as_str(), ST_OK | ST_KEPT) {
                continue;
            }
            let path = join_within(&root, &row.rel_path);
            let bad = match path {
                None => true,
                Some(ref p) if !p.is_file() => true,
                Some(ref p) => match (row.sha256.as_deref(), fs::metadata(p)) {
                    (Some(expect), Ok(meta)) if meta.len() as i64 == row.size_bytes => {
                        hash_file(p).as_deref() != Some(expect)
                    }
                    _ => true,
                },
            };
            if bad {
                let now = db::now_rfc3339();
                let _ = db::mirror_set_status(conn, row.resource_id, ST_QUEUED, None, &now);
                let _ = db::queue_enqueue(conn, row.resource_id, P_ON_DEMAND, &db::now_rfc3339());
                requeued += 1;
            }
        }
        if requeued > 0 {
            self.set_state(S_IDLE);
            self.wake();
        }
        requeued
    }

    /// Remove every byte under the mirror root and forget the index. Called
    /// only from Settings > Data behind a ConfirmDialog.
    pub fn delete_all(&self, conn: &Connection) -> usize {
        let root = self.root();
        let removed = db::mirror_all(conn)
            .unwrap_or_default()
            .iter()
            .filter_map(|r| {
                join_within(&root, &r.rel_path).map(|p| {
                    let gone = fs::remove_file(&p).is_ok();
                    (r.resource_id, gone)
                })
            })
            .filter(|(_, gone)| *gone)
            .count();
        let _ = db::mirror_clear_all(conn);
        removed
    }

    /// Move all local files from the old root to the new root. Verifies each
    /// file's SHA-256, copies to the new location, then deletes the old copy.
    /// Returns the number of files successfully moved.
    pub fn move_to_new_root(&self, conn: &Connection) -> Result<usize, String> {
        let old_root = self.root();
        // The new root is already set on `self.root` by the caller before this
        // method is invoked.
        let new_root = self.root();
        if old_root == new_root {
            return Ok(0);
        }

        // Collect all rows that have a file on the old root.
        let mut stmt = conn
            .prepare(
                "SELECT resource_id, rel_path, sha256, size_bytes, mime, status, error, attempts, source_etag, source_modified, downloaded_at, last_checked FROM local_files WHERE status IN ('ok', 'kept')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(MirrorRow {
                    resource_id: r.get(0)?,
                    rel_path: r.get(1)?,
                    sha256: r.get(2)?,
                    size_bytes: r.get(3)?,
                    mime: r.get(4)?,
                    status: r.get(5)?,
                    error: r.get(6)?,
                    attempts: r.get(7)?,
                    source_etag: r.get(8)?,
                    source_modified: r.get(9)?,
                    downloaded_at: r.get(10)?,
                    last_checked: r.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?
            .flatten()
            .collect::<Vec<_>>();

        let mut moved = 0;
        for row in rows {
            let Some(old_path) = paths::join_within(&old_root, &row.rel_path) else {
                continue;
            };
            if !old_path.is_file() {
                continue;
            }
            // Verify the hash.
            let actual_hash =
                crate::core::files::hash_bytes(&fs::read(&old_path).map_err(|e| e.to_string())?);
            if row.sha256.as_deref() != Some(&actual_hash) {
                tracing::warn!(
                    resource_id = row.resource_id,
                    "hash mismatch during move, skipping"
                );
                continue;
            }

            let Some(new_path) = paths::join_within(&new_root, &row.rel_path) else {
                continue;
            };
            if let Some(parent) = new_path.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    tracing::warn!(error = %e, "failed to create parent dir during move");
                    continue;
                }
            }

            // Copy with retries for Windows sharing violations.
            let mut last_err: Option<String> = None;
            for _ in 0..5 {
                match fs::copy(&old_path, &new_path) {
                    Ok(_) => {
                        // Verify the copy.
                        let copy_hash = crate::core::files::hash_bytes(
                            &fs::read(&new_path).map_err(|e| e.to_string())?,
                        );
                        if copy_hash != actual_hash {
                            let _ = fs::remove_file(&new_path);
                            last_err = Some("hash mismatch after copy".to_string());
                            continue;
                        }
                        // Delete the old file.
                        let _ = fs::remove_file(&old_path);
                        moved += 1;
                        last_err = None;
                        break;
                    }
                    Err(e) => {
                        last_err = Some(e.to_string());
                        std::thread::sleep(std::time::Duration::from_millis(200));
                    }
                }
            }
            if let Some(err) = last_err {
                tracing::warn!(resource_id = row.resource_id, error = %err, "failed to move file");
            }
        }

        Ok(moved)
    }
}

/* ------------------------------------------------------------ file writing */

/// Stream-hash a file already on disk, for verification. `None` when it cannot
/// be read.
fn hash_file(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
    }
    Some(hex::encode(hasher.finalize()))
}

/// Writes the body to disk while hashing it, so the SHA-256 costs no extra pass.
struct Sink {
    file: fs::File,
    hasher: Sha256,
    attempt: Option<Arc<DownloadAttempt>>,
    events: Option<broadcast::Sender<MirrorDownloadProgress>>,
}

impl Sink {
    /// Open `<name>.part`, either continuing an existing partial download or
    /// starting fresh. When continuing, the bytes already on disk are folded
    /// into the hash so the final digest covers the whole file.
    fn open(
        path: &Path,
        append: bool,
        existing: u64,
        attempt: Option<Arc<DownloadAttempt>>,
        events: Option<broadcast::Sender<MirrorDownloadProgress>>,
    ) -> std::io::Result<Sink> {
        let mut hasher = Sha256::new();
        if append && existing > 0 {
            let mut prefix = fs::File::open(path)?;
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = prefix.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
            }
            let mut file = fs::OpenOptions::new().append(true).open(path)?;
            file.seek(SeekFrom::End(0))?;
            return Ok(Sink {
                file,
                hasher,
                attempt,
                events,
            });
        }
        Ok(Sink {
            file: fs::File::create(path)?,
            hasher,
            attempt,
            events,
        })
    }

    /// Flush, hand back the hash and the final size.
    fn finish(mut self) -> std::io::Result<(fs::File, String, i64)> {
        self.file.flush()?;
        self.file.sync_all()?;
        let size = self.file.metadata()?.len() as i64;
        let hash = hex::encode(self.hasher.finalize());
        Ok((self.file, hash, size))
    }
}

impl Write for Sink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self
            .attempt
            .as_ref()
            .is_some_and(|a| a.cancelled.load(Ordering::SeqCst))
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "download cancelled",
            ));
        }
        let n = self.file.write(buf)?;
        self.hasher.update(&buf[..n]);
        if let Some(attempt) = &self.attempt {
            let mut progress = attempt.progress.lock().unwrap();
            progress.bytes_done = progress.bytes_done.saturating_add(n as u64);
            let event = progress.clone();
            drop(progress);
            if let Some(events) = &self.events {
                let _ = events.send(event);
            }
        }
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

/// Windows refuses a rename while a scanner or indexer holds the file open, so
/// retry briefly rather than failing a download that actually succeeded.
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..RENAME_ATTEMPTS {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                if attempt + 1 < RENAME_ATTEMPTS {
                    std::thread::sleep(RENAME_DELAY);
                }
            }
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("rename failed")))
}

/* ------------------------------------------------------------- file naming */

/// Has enough time passed since the last attempt to try again? Exponential with
/// a deterministic jitter, derived from the attempt count so it is testable and
/// needs no random number generator.
fn backoff_elapsed(attempts: i64, last_checked: Option<&str>) -> bool {
    let Some(last) = last_checked.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) else {
        return true;
    };
    let Some(delay) = backoff_delay(attempts) else {
        return true;
    };
    let waited = chrono::Utc::now().signed_duration_since(last.with_timezone(&chrono::Utc));
    waited.num_milliseconds() >= delay.as_millis() as i64
}

/// 2s, 4s, 8s … capped at five minutes, with up to 25% jitter so a backfill of
/// failures does not retry in lockstep. `None` means "give up retrying".
fn backoff_delay(attempts: i64) -> Option<Duration> {
    if attempts <= 0 {
        return Some(Duration::ZERO);
    }
    if attempts > 8 {
        return None;
    }
    let base = 2u64.saturating_pow(attempts.min(8) as u32) * 1000;
    let base = base.min(300_000);
    // Deterministic jitter in [0, 25%).
    let jitter = (base / 4).wrapping_mul((attempts as u64 * 2654435761) % 1000) / 1000;
    Some(Duration::from_millis(base + jitter))
}

/// The filename the server named, from `Content-Disposition`.
///
/// Handles both the plain `filename="…"` form and RFC 5987's
/// `filename*=UTF-8''percent-encoded`, preferring the latter when both appear
/// (it is the one that survives a non-ASCII name). Any directory part is
/// stripped: a server must not be able to choose where in the mirror a file
/// lands.
pub fn filename_from_disposition(value: &str) -> Option<String> {
    let mut plain = None;
    let mut extended = None;
    for part in value.split(';').skip(1) {
        let Some((key, raw)) = part.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let raw = raw.trim();
        match key.as_str() {
            "filename*" => extended = Some(decode_rfc5987(raw)),
            "filename" => plain = Some(unquote(raw)),
            _ => {}
        }
    }
    let name = extended.or(plain)?;
    let name = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&name)
        .trim()
        .to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn unquote(raw: &str) -> String {
    let raw = raw.trim();
    let inner = raw
        .strip_prefix('"')
        .and_then(|r| r.strip_suffix('"'))
        .unwrap_or(raw);
    // A quoted string escapes a quote with a backslash.
    inner.replace("\\\"", "\"").replace("\\\\", "\\")
}

/// `UTF-8''My%20File.pdf` to `My File.pdf`.
fn decode_rfc5987(raw: &str) -> String {
    let value = match raw.splitn(3, '\'').nth(2) {
        Some(v) => v,
        None => raw,
    };
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

/// The name to use before the server has told us: the resource title with an
/// extension guessed from the known file type, falling back to the URL's name.
fn provisional_filename(resource: &crate::models::Resource, url: &url::Url) -> String {
    let title = resource.title.trim();
    let mut name = if title.is_empty() {
        url.path_segments()
            .and_then(|mut s| s.next_back())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "download".to_string())
    } else {
        title.to_string()
    };
    if has_extension(&name) {
        return name;
    }
    if let Some(ext) = extension_for_type(&resource.resource_type, url) {
        name.push('.');
        name.push_str(&ext);
    }
    name
}

/// `<yyyy-MM-dd> <title>.md`, dated from the resource when Quanta says when it
/// was posted.
fn snapshot_filename(resource: &crate::models::Resource) -> String {
    let date = resource
        .uploaded_at
        .as_deref()
        .or(resource.published_at.as_deref())
        .or(resource.modified_at.as_deref())
        .and_then(|s| s.get(..10).map(str::to_string))
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    let title = resource.title.trim();
    let title = if title.is_empty() { "Untitled" } else { title };
    format!("{date} {title}.md")
}

fn has_extension(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) => !stem.is_empty() && !ext.is_empty() && ext.len() <= 6,
        None => false,
    }
}

fn extension_of_name(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() || ext.len() > 6 {
        return None;
    }
    if SCRIPT_NAMES.iter().any(|s| s.eq_ignore_ascii_case(name)) {
        return None;
    }
    Some(ext.to_ascii_lowercase())
}

/// Moodle's front controllers. A file is fetched *through* one of these, so the
/// script's own extension is never the file's — `view.php` says nothing about a
/// PDF, and `pluginfile.php/…/Lecture 1.pdf` puts the real name last.
const SCRIPT_NAMES: &[&str] = &["view.php", "download.php", "index.php", "pluginfile.php"];

/// A reasonable extension for a resource that has none. The resource type is
/// checked first because it is the strongest signal.
fn extension_for_type(resource_type: &str, url: &url::Url) -> Option<String> {
    if let Some(ext) = match resource_type.trim().to_ascii_lowercase().as_str() {
        "pdf" => Some("pdf"),
        "image" => Some("png"),
        "audio" => Some("mp3"),
        "video" => Some("mp4"),
        "page" | "book" | "label" => Some("html"),
        _ => None,
    } {
        return Some(ext.to_string());
    }
    url.path_segments()
        .and_then(|mut s| s.next_back())
        .and_then(extension_of_name)
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [(&str, u64); 4] = [
        ("GB", 1024 * 1024 * 1024),
        ("MB", 1024 * 1024),
        ("KB", 1024),
        ("B", 1),
    ];
    for (unit, size) in UNITS {
        if bytes >= size {
            return format!("{:.1} {unit}", bytes as f64 / size as f64);
        }
    }
    "0 B".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_resource(conn: &Connection) -> i64 {
        let course = db::upsert_course(conn, "42", "Course", None, "https://x/42", "t0").unwrap();
        db::upsert_resource(
            conn,
            &db::ResourceWrite {
                external_id: "resource:42",
                course_id: Some(course),
                title: "Saved file",
                url: "https://x/file",
                source_page_url: None,
                resource_type: "resource",
                uploaded_at: None,
                published_at: None,
                modified_at: None,
                due_at: None,
                fingerprint: "fp",
                size_bytes: Some(6),
                section: None,
                section_path: None,
                is_external: false,
                availability: "available",
            },
            "t0",
        )
        .unwrap()
    }

    #[test]
    fn progress_events_report_observed_bytes_and_attempt_identity() {
        let dir = tempfile::tempdir().unwrap();
        let mirror = Mirror::new(dir.path().to_path_buf(), MirrorConfig::default());
        let attempt = mirror.begin_attempt(42);
        let mut events = mirror.subscribe_download_progress();
        let path = dir.path().join("download.part");
        let mut sink = Sink::open(
            &path,
            false,
            0,
            Some(attempt.clone()),
            Some(mirror.download_events.clone()),
        )
        .unwrap();
        sink.write_all(b"abc").unwrap();
        let update = events.try_recv().unwrap();
        assert_eq!(update.resource_id, 42);
        assert_eq!(
            update.attempt_id,
            attempt.progress.lock().unwrap().attempt_id
        );
        assert_eq!(update.bytes_done, 3);
        assert_eq!(update.bytes_total, None);
    }

    #[test]
    fn replacing_an_attempt_cannot_reuse_or_cancel_the_new_identity() {
        let dir = tempfile::tempdir().unwrap();
        let mirror = Mirror::new(dir.path().to_path_buf(), MirrorConfig::default());
        let old = mirror.begin_attempt(42);
        old.cancelled.store(true, Ordering::SeqCst);
        let current = mirror.begin_attempt(42);
        assert_ne!(
            old.progress.lock().unwrap().attempt_id,
            current.progress.lock().unwrap().attempt_id
        );
        assert!(!current.cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn repeated_cancel_preserves_a_valid_saved_copy_and_retry_gets_a_new_identity() {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let resource_id = seeded_resource(&conn);
        let mirror = Mirror::new(dir.path().to_path_buf(), MirrorConfig::default());
        let rel_path = "Course/Saved file.pdf";
        let saved_path = dir.path().join(rel_path);
        fs::create_dir_all(saved_path.parent().unwrap()).unwrap();
        fs::write(&saved_path, b"stored").unwrap();
        fs::write(saved_path.with_file_name("Saved file.pdf.part"), b"partial").unwrap();
        db::mirror_upsert(
            &conn,
            &MirrorRow {
                resource_id,
                rel_path: rel_path.into(),
                sha256: Some("hash".into()),
                size_bytes: 6,
                mime: Some("application/pdf".into()),
                status: ST_OK.into(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some("t0".into()),
                last_checked: Some("t0".into()),
            },
        )
        .unwrap();

        let first = mirror.begin_attempt(resource_id);
        let cancelled = mirror.cancel_download(&conn, resource_id);
        assert_eq!(cancelled.state, "saved");
        assert!(saved_path.is_file(), "cancel must preserve the valid copy");
        assert!(!saved_path.with_file_name("Saved file.pdf.part").exists());
        assert_eq!(mirror.cancel_download(&conn, resource_id).state, "saved");

        let retried = mirror.retry_download(&conn, resource_id);
        assert_eq!(retried.state, "saved", "retry trusts disk truth");
        assert_eq!(retried.attempt_id, format!("{resource_id}-saved"));
        assert_ne!(
            first.progress.lock().unwrap().attempt_id,
            retried.attempt_id
        );
        assert!(saved_path.is_file());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancellation_at_real_download_publication_preserves_previous_copy() {
        use std::net::TcpListener;
        use std::sync::Barrier;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request);
            use std::io::Write as _;
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nContent-Type: application/pdf\r\nConnection: close\r\n\r\nchanged").unwrap();
        });

        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("mirror.sqlite")).unwrap();
        db::migrate(&conn).unwrap();
        let resource_id = seeded_resource(&conn);
        conn.execute(
            "UPDATE resources SET url = ?1 WHERE id = ?2",
            params![
                format!("http://quanta.bits-pilani.ac.in:{}/file", address.port()),
                resource_id
            ],
        )
        .unwrap();
        let mirror = Mirror::new(
            dir.path().to_path_buf(),
            MirrorConfig {
                min_free_bytes: 0,
                ..MirrorConfig::default()
            },
        );
        let rel_path = "Course/Saved file.pdf";
        let saved_path = dir.path().join(rel_path);
        fs::create_dir_all(saved_path.parent().unwrap()).unwrap();
        fs::write(&saved_path, b"stored").unwrap();
        db::mirror_upsert(
            &conn,
            &MirrorRow {
                resource_id,
                rel_path: rel_path.into(),
                sha256: Some(hex::encode(Sha256::digest(b"stored"))),
                size_bytes: 6,
                mime: Some("application/pdf".into()),
                status: ST_OK.into(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some("t0".into()),
                last_checked: Some("t0".into()),
            },
        )
        .unwrap();
        let arrived = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        *mirror.before_publish.lock().unwrap() = Some((arrived.clone(), release.clone()));
        let client = Arc::new(QuantaClient::fixture_client(address));
        let conn_mutex = Arc::new(Mutex::new(conn));
        let item = db::QueueItem {
            resource_id,
            priority: 0,
            enqueued_at: "t0".into(),
        };
        let worker_mirror = mirror.clone();
        let worker_conn = conn_mutex.clone();
        let worker = tokio::spawn(async move {
            let ctx = MirrorCtx {
                conn: &worker_conn,
                client: Some(client),
            };
            worker_mirror.download_one(&ctx, &item, 0).await
        });

        // Reaching this barrier proves the real response body was streamed and
        // fsynced, immediately before the final cancel/publication lock.
        tokio::task::spawn_blocking({
            let arrived = arrived.clone();
            move || arrived.wait()
        })
        .await
        .unwrap();
        let cancelled = {
            let conn = conn_mutex.lock().unwrap();
            mirror.cancel_download(&conn, resource_id)
        };
        assert_eq!(cancelled.state, "saved");
        let resumed = {
            let conn = conn_mutex.lock().unwrap();
            mirror.retry_download(&conn, resource_id)
        };
        assert_eq!(resumed.state, "saved");
        tokio::task::spawn_blocking(move || release.wait())
            .await
            .unwrap();
        worker.await.unwrap();
        server.join().unwrap();

        assert_eq!(fs::read(&saved_path).unwrap(), b"stored");
        assert!(!saved_path.with_file_name("Saved file.pdf.part").exists());
        let conn = conn_mutex.lock().unwrap();
        let row = db::mirror_get(&conn, resource_id).unwrap().unwrap();
        assert_eq!(row.status, ST_OK);
        assert_eq!(row.rel_path, rel_path);
        assert_eq!(
            row.sha256.as_deref(),
            Some(hex::encode(Sha256::digest(b"stored")).as_str())
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 3)]
    async fn obsolete_publication_cleanup_cannot_delete_successors_partial() {
        use std::net::TcpListener;
        use std::sync::Barrier;
        use std::thread;

        const FIRST_CHUNK: usize = 64 * 1024;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (partial_sent_tx, partial_sent_rx) = std::sync::mpsc::channel();
        let (continue_tx, continue_rx) = std::sync::mpsc::channel();
        let server = thread::spawn(move || {
            use std::io::Write as _;
            let (mut old, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = old.read(&mut request);
            old.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nContent-Type: application/pdf\r\nConnection: close\r\n\r\noldbytes").unwrap();
            let (mut successor, _) = listener.accept().unwrap();
            let _ = successor.read(&mut request);
            successor.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 131072\r\nContent-Type: application/pdf\r\nConnection: close\r\n\r\n").unwrap();
            successor.write_all(&vec![b'n'; FIRST_CHUNK]).unwrap();
            successor.flush().unwrap();
            partial_sent_tx.send(()).unwrap();
            continue_rx.recv().unwrap();
            successor.write_all(&vec![b'b'; FIRST_CHUNK]).unwrap();
        });

        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("mirror.sqlite")).unwrap();
        db::migrate(&conn).unwrap();
        let resource_id = seeded_resource(&conn);
        conn.execute(
            "UPDATE resources SET url = ?1 WHERE id = ?2",
            params![
                format!("http://quanta.bits-pilani.ac.in:{}/file", address.port()),
                resource_id
            ],
        )
        .unwrap();
        conn.execute(
            "UPDATE resources SET resource_type = 'pdf' WHERE id = ?1",
            params![resource_id],
        )
        .unwrap();
        let mirror = Mirror::new(
            dir.path().to_path_buf(),
            MirrorConfig {
                min_free_bytes: 0,
                ..MirrorConfig::default()
            },
        );
        let client = Arc::new(QuantaClient::fixture_client(address));
        let conn_mutex = Arc::new(Mutex::new(conn));
        let arrived = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        *mirror.before_publish.lock().unwrap() = Some((arrived.clone(), release.clone()));
        let item = db::QueueItem {
            resource_id,
            priority: 0,
            enqueued_at: "t0".into(),
        };
        let old_mirror = mirror.clone();
        let old_conn = conn_mutex.clone();
        let old_client = client.clone();
        let old_item = item.clone();
        let old = tokio::spawn(async move {
            let ctx = MirrorCtx {
                conn: &old_conn,
                client: Some(old_client),
            };
            old_mirror.download_one(&ctx, &old_item, 0).await
        });
        tokio::task::spawn_blocking({
            let arrived = arrived.clone();
            move || arrived.wait()
        })
        .await
        .unwrap();

        let successor_attempt = {
            let conn = conn_mutex.lock().unwrap();
            assert_eq!(
                mirror.cancel_download(&conn, resource_id).state,
                "cancelled"
            );
            mirror.retry_download(&conn, resource_id)
        };
        assert_eq!(successor_attempt.state, "queued");
        let mut progress = mirror.subscribe_download_progress();
        let next_mirror = mirror.clone();
        let next_conn = conn_mutex.clone();
        let next_client = client.clone();
        let next = tokio::spawn(async move {
            let ctx = MirrorCtx {
                conn: &next_conn,
                client: Some(next_client),
            };
            next_mirror.download_one(&ctx, &item, 0).await
        });

        partial_sent_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("successor HTTP fixture must send its first body chunk");
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let update = progress.recv().await.unwrap();
                if update.attempt_id == successor_attempt.attempt_id
                    && update.bytes_done >= FIRST_CHUNK as u64
                {
                    break;
                }
            }
        })
        .await
        .unwrap();
        let part = dir.path().join("Course/Saved file.pdf.part");
        assert_eq!(fs::read(&part).unwrap(), vec![b'n'; FIRST_CHUNK]);

        tokio::task::spawn_blocking(move || release.wait())
            .await
            .unwrap();
        old.await.unwrap();
        *mirror.before_publish.lock().unwrap() = None;
        assert_eq!(
            fs::read(&part).unwrap(),
            vec![b'n'; FIRST_CHUNK],
            "obsolete cleanup must leave successor bytes intact"
        );
        continue_tx.send(()).unwrap();
        next.await.unwrap();
        server.join().unwrap();

        let expected = [vec![b'n'; FIRST_CHUNK], vec![b'b'; FIRST_CHUNK]].concat();
        assert_eq!(
            fs::read(dir.path().join("Course/Saved file.pdf")).unwrap(),
            expected
        );
        assert!(!part.exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn automatic_tick_and_concurrent_ensure_local_share_one_transfer() {
        use std::net::TcpListener;
        use std::sync::Barrier;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (first_request_tx, first_request_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let (extra_request_tx, mut extra_request_rx) = tokio::sync::oneshot::channel();
        let server = thread::spawn(move || {
            use std::io::Write as _;
            let (mut first, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = first.read(&mut request);
            first.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nContent-Type: application/pdf\r\nConnection: close\r\n\r\n").unwrap();
            first.flush().unwrap();
            first_request_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            first.write_all(b"shared!!").unwrap();
            first.flush().unwrap();
            drop(first);

            listener.set_nonblocking(true).unwrap();
            if let Ok((mut extra, _)) = listener.accept() {
                let _ = extra.read(&mut request);
                let _ = extra_request_tx.send(());
                let _ = extra.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nContent-Type: application/pdf\r\nConnection: close\r\n\r\nsecond!!");
            }
        });

        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("mirror.sqlite")).unwrap();
        db::migrate(&conn).unwrap();
        let resource_id = seeded_resource(&conn);
        conn.execute(
            "UPDATE resources SET url = ?1, resource_type = 'pdf' WHERE id = ?2",
            params![
                format!("http://quanta.bits-pilani.ac.in:{}/file", address.port()),
                resource_id
            ],
        )
        .unwrap();
        let mirror = Mirror::new(
            dir.path().to_path_buf(),
            MirrorConfig {
                min_free_bytes: 0,
                ..MirrorConfig::default()
            },
        );
        let conn = Arc::new(Mutex::new(conn));
        let client = Arc::new(QuantaClient::fixture_client(address));
        mirror.enqueue(&conn.lock().unwrap(), resource_id, P_BACKFILL);
        let entered = Arc::new(Barrier::new(2));
        let tick_mirror = mirror.clone();
        let tick_conn = conn.clone();
        let tick_client = client.clone();
        let tick = tokio::spawn(async move {
            let ctx = MirrorCtx {
                conn: &tick_conn,
                client: Some(tick_client),
            };
            tick_mirror.tick(&ctx).await
        });
        first_request_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();

        let competing_mirror = mirror.clone();
        let competing_conn = conn.clone();
        let competing_client = client.clone();
        let competing_tick = tokio::spawn(async move {
            let ctx = MirrorCtx {
                conn: &competing_conn,
                client: Some(competing_client),
            };
            competing_mirror.tick(&ctx).await
        });

        let start_callers = entered.clone();
        let callers_mirror = mirror.clone();
        let callers_conn = conn.clone();
        let callers = tokio::spawn(async move {
            start_callers.wait();
            let ctx = MirrorCtx {
                conn: &callers_conn,
                client: None,
            };
            let a = callers_mirror.ensure_local(&ctx, resource_id, Duration::from_secs(5));
            let b = callers_mirror.ensure_local(&ctx, resource_id, Duration::from_secs(5));
            tokio::join!(a, b)
        });
        tokio::task::spawn_blocking({
            let entered = entered.clone();
            move || entered.wait()
        })
        .await
        .unwrap();

        // Observe the active worker attempt while the real response is gated.
        let active_id = mirror
            .download_progress(&conn.lock().unwrap())
            .into_iter()
            .find(|p| p.resource_id == resource_id)
            .unwrap()
            .attempt_id;
        let joined_id = mirror
            .download_progress(&conn.lock().unwrap())
            .into_iter()
            .find(|p| p.resource_id == resource_id)
            .unwrap()
            .attempt_id;
        assert_eq!(
            joined_id, active_id,
            "duplicate demand must join the current attempt"
        );

        release_tx.send(()).unwrap();
        assert_eq!(tick.await.unwrap(), 1);
        let competing_result = competing_tick.await.unwrap();
        assert_eq!(competing_result, 1);
        let (a, b) = callers.await.unwrap();
        let a = a.unwrap();
        let b = b.unwrap();
        assert_eq!(a.path, b.path);
        assert_eq!(fs::read(&a.path).unwrap(), b"shared!!");
        assert_eq!(db::queue_len(&conn.lock().unwrap()), 0);
        assert_eq!(
            db::mirror_get(&conn.lock().unwrap(), resource_id)
                .unwrap()
                .unwrap()
                .status,
            ST_OK
        );
        assert!(
            extra_request_rx.try_recv().is_err(),
            "one resource must produce one HTTP transfer"
        );
        server.join().unwrap();
    }

    #[test]
    fn repeated_cancel_then_retry_replaces_only_the_cancelled_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let resource_id = seeded_resource(&conn);
        let mirror = Mirror::new(dir.path().to_path_buf(), MirrorConfig::default());

        let old = mirror.cancel_download(&conn, resource_id);
        assert_eq!(old.state, "cancelled");
        assert_eq!(
            mirror.cancel_download(&conn, resource_id).state,
            "cancelled"
        );

        let next = mirror.retry_download(&conn, resource_id);
        assert_eq!(next.state, "queued");
        assert_ne!(next.attempt_id, old.attempt_id);
        let current = mirror.download_progress(&conn);
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].attempt_id, next.attempt_id);
        assert_eq!(current[0].state, "queued");
    }

    #[test]
    fn content_disposition_prefers_the_rfc5987_form() {
        assert_eq!(
            filename_from_disposition("attachment; filename=\"Lecture 1.pdf\"").as_deref(),
            Some("Lecture 1.pdf")
        );
        assert_eq!(
            filename_from_disposition("attachment; filename*=UTF-8''My%20File%20%E2%80%93%202.pdf")
                .as_deref(),
            Some("My File – 2.pdf")
        );
        // Both present: the extended form wins, it survives non-ASCII.
        assert_eq!(
            filename_from_disposition(
                "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf"
            )
            .as_deref(),
            Some("Résumé.pdf")
        );
        assert_eq!(filename_from_disposition("inline"), None);
        assert_eq!(filename_from_disposition("attachment; filename=\"\""), None);
    }

    #[test]
    fn content_disposition_cannot_name_a_directory() {
        for header in [
            "attachment; filename=\"../../etc/passwd\"",
            "attachment; filename=\"..\\\\..\\\\windows\\\\system32\"",
            "attachment; filename*=UTF-8''..%2F..%2Fescape.pdf",
        ] {
            let name = filename_from_disposition(header).unwrap();
            assert!(!name.contains('/'), "{name}");
            assert!(!name.contains('\\'), "{name}");
        }
    }

    #[test]
    fn backoff_grows_caps_and_gives_up() {
        assert_eq!(
            backoff_delay(0),
            Some(Duration::ZERO),
            "no wait before the first try"
        );
        let first = backoff_delay(1).unwrap();
        let second = backoff_delay(2).unwrap();
        // The base doubles and jitter may add up to 25%, so each step is at
        // least 1.5x the previous and at most 2.5x it.
        assert!(second >= first.mul_f64(1.5), "{first:?} then {second:?}");
        assert!(second <= first.mul_f64(2.5), "{first:?} then {second:?}");
        // …and it stops growing at five minutes however far you count.
        let cap = backoff_delay(8).unwrap();
        assert!(cap <= Duration::from_secs(375), "cap plus jitter: {cap:?}");
        assert!(backoff_delay(12).is_none(), "stops retrying eventually");
    }

    #[test]
    fn backoff_window_is_measured_from_the_last_attempt() {
        assert!(backoff_elapsed(0, None), "never tried, try now");
        let just_now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        assert!(!backoff_elapsed(3, Some(&just_now)), "too soon");
        let long_ago = (chrono::Utc::now() - chrono::Duration::hours(1))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        assert!(backoff_elapsed(3, Some(&long_ago)), "the window has passed");
    }

    #[test]
    fn provisional_names_get_an_extension_when_they_lack_one() {
        let url = url::Url::parse("https://x/mod/resource/view.php?id=9").unwrap();
        let mut resource = crate::models::Resource {
            id: 1,
            external_resource_id: "r".into(),
            course_id: None,
            course_name: None,
            title: "Lecture 14".into(),
            url: url.to_string(),
            source_page_url: None,
            resource_type: "pdf".into(),
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            first_seen_at: "t".into(),
            last_seen_at: None,
            last_checked_at: None,
            content_fingerprint: None,
            availability_status: "available".into(),
            size_bytes: None,
            section: None,
            section_path: Vec::new(),
            is_external: false,
        };
        assert_eq!(provisional_filename(&resource, &url), "Lecture 14.pdf");

        // An extension already in the title is left alone.
        resource.title = "Lecture 14.pdf".into();
        assert_eq!(provisional_filename(&resource, &url), "Lecture 14.pdf");

        // A direct file URL: its extension is honoured, and lowercased.
        let pdf_url =
            url::Url::parse("https://x/pluginfile.php/1/mod_resource/content/Handout.PDF").unwrap();
        resource.title = "Handout".into();
        assert_eq!(provisional_filename(&resource, &pdf_url), "Handout.pdf");

        // A script URL's own extension is not the file's: `view.php` says
        // nothing about a PDF, so the resource type decides.
        assert_eq!(provisional_filename(&resource, &url), "Handout.pdf");

        // A type-less resource with a script URL keeps a plain name.
        resource.resource_type = "unknown".into();
        assert_eq!(provisional_filename(&resource, &url), "Handout");
    }

    #[test]
    fn snapshot_names_are_dated_and_markdown() {
        let mut resource = crate::models::Resource {
            id: 1,
            external_resource_id: "r".into(),
            course_id: None,
            course_name: None,
            title: "Quiz-2 answer sheet distribution".into(),
            url: "https://x/mod/forum/discuss.php?d=1".into(),
            source_page_url: None,
            resource_type: "announcement".into(),
            uploaded_at: Some("2026-03-04T09:00:00Z".into()),
            published_at: None,
            modified_at: None,
            due_at: None,
            first_seen_at: "t".into(),
            last_seen_at: None,
            last_checked_at: None,
            content_fingerprint: None,
            availability_status: "available".into(),
            size_bytes: None,
            section: None,
            section_path: Vec::new(),
            is_external: false,
        };
        assert_eq!(
            snapshot_filename(&resource),
            "2026-03-04 Quiz-2 answer sheet distribution.md"
        );

        // No date from Quanta: today's date, never a blank prefix.
        resource.uploaded_at = None;
        let name = snapshot_filename(&resource);
        assert!(
            name.ends_with("Quiz-2 answer sheet distribution.md"),
            "{name}"
        );
        assert_eq!(
            name.chars().count(),
            "2026-10-15 ".len() + "Quiz-2 answer sheet distribution.md".len()
        );
    }

    #[test]
    fn a_resumed_sink_hashes_the_prefix_and_the_tail_together() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.part");
        // First half, written and left behind as a partial download.
        fs::write(&path, b"hello ").unwrap();
        let existing = fs::metadata(&path).unwrap().len();
        // Resume: the tail is appended and the digest must cover both halves.
        let mut sink = Sink::open(&path, true, existing, None, None).unwrap();
        sink.write_all(b"world").unwrap();
        let (_f, hash, size) = sink.finish().unwrap();
        assert_eq!(size, 11);
        assert_eq!(hash, crate::core::files::hash_bytes(b"hello world"));
        assert_eq!(fs::read(&path).unwrap(), b"hello world");
    }

    #[test]
    fn a_fresh_sink_truncates_an_abandoned_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.part");
        fs::write(&path, b"stale garbage").unwrap();
        let mut sink = Sink::open(&path, false, 0, None, None).unwrap();
        sink.write_all(b"new").unwrap();
        let (_f, hash, size) = sink.finish().unwrap();
        assert_eq!(size, 3);
        assert_eq!(hash, crate::core::files::hash_bytes(b"new"));
    }

    #[test]
    fn rename_lands_the_file_and_leaves_no_part() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("a.pdf.part");
        let final_path = dir.path().join("a.pdf");
        fs::write(&part, b"body").unwrap();
        rename_with_retry(&part, &final_path).unwrap();
        assert!(final_path.is_file());
        assert!(!part.exists());
    }

    #[test]
    fn mirror_config_follows_settings() {
        let s = Settings {
            mirror_enabled: false,
            mirror_max_bytes: 0,
            mirror_min_free_bytes: 2 * 1024 * 1024 * 1024,
            mirror_keep_versions: 5,
            ..Settings::default()
        };
        let config = MirrorConfig::from_settings(&s);
        assert!(!config.enabled);
        assert_eq!(config.max_bytes, 0);
        assert_eq!(config.min_free_bytes, 2 * 1024 * 1024 * 1024);
        assert_eq!(config.keep_versions, 5);
    }

    #[test]
    fn the_default_root_is_under_documents() {
        let root =
            Mirror::default_root(Some(PathBuf::from("/home/u/Documents")), Path::new("/data"));
        assert_eq!(root, PathBuf::from("/home/u/Documents/Quanta Pulse/Files"));
        let fallback = Mirror::default_root(None, Path::new("/data"));
        assert_eq!(fallback, PathBuf::from("/data/Quanta Pulse/Files"));
    }

    #[test]
    fn human_bytes_reads_like_a_person_wrote_it() {
        assert_eq!(human_bytes(500), "500.0 B");
        assert_eq!(human_bytes(2048), "2.0 KB");
        assert_eq!(human_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(human_bytes(3 * 1024 * 1024 * 1024), "3.0 GB");
    }
}

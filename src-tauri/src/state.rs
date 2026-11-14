//! Shared application state.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::core::files::FileStore;
use crate::core::mirror::{Mirror, MirrorConfig, MirrorCtx};
use crate::db;
use crate::models::SyncStatus;
use crate::quanta::client::QuantaClient;
use crate::settings::Settings;

/// Coordination for the (single) synchronisation job.
#[derive(Default)]
pub struct SyncControl {
    /// True while a scan is in progress — prevents overlapping scans.
    pub running: AtomicBool,
    /// Cooperative cancellation flag for the active scan.
    pub cancel: Arc<AtomicBool>,
    /// Set on application exit so the scheduler loop stops promptly.
    pub shutdown: AtomicBool,
    /// Prevents overlapping checks of the existing authenticated session.
    pub auth_refreshing: AtomicBool,
    /// Blocks scans, previews and new authentication attempts during a full
    /// Quanta session reset.
    pub auth_resetting: AtomicBool,
    /// In-flight resource previews, which are not covered by the scan flag.
    pub active_previews: AtomicUsize,
    /// Prevents a credential sign-in from racing an explicit session reset.
    pub credential_login_active: AtomicBool,
    /// Prevents duplicate interactive Quanta SSO windows.
    pub sso_login_active: AtomicBool,
    pub phase: Mutex<String>,
    pub progress: Mutex<(usize, usize)>,
    pub last_error: Mutex<Option<String>>,
    /// "unauthenticated" | "authenticated" | "expired"
    pub auth_state: Mutex<String>,
    /// Set once the user has been told about the current expiry episode, so a
    /// scan that keeps hitting the login page does not re-notify every interval.
    pub auth_notified: AtomicBool,
}

impl SyncControl {
    pub fn set_phase(&self, phase: &str, done: usize, total: usize) {
        *self.phase.lock().unwrap() = phase.to_string();
        *self.progress.lock().unwrap() = (done, total);
    }
    pub fn auth_state(&self) -> String {
        self.auth_state.lock().unwrap().clone()
    }
    pub fn set_auth_state(&self, s: &str) {
        *self.auth_state.lock().unwrap() = s.to_string();
        if s == "authenticated" {
            self.auth_notified.store(false, Ordering::SeqCst);
        }
    }

    /// Claim the single session-expired notification for this episode. The first
    /// call after (re)authentication returns true; later calls return false until
    /// [`Self::set_auth_state`] sees "authenticated" again.
    pub fn note_auth_expired(&self) -> bool {
        !self.auth_notified.swap(true, Ordering::SeqCst)
    }

    /// Whether the scheduler can use the current client. An expired client is
    /// retained for explicit session checks, but must never trigger retries.
    pub fn can_schedule(&self, has_client: bool) -> bool {
        !self.auth_resetting.load(Ordering::SeqCst)
            && !self.is_running()
            && self.auth_state() == "authenticated"
            && has_client
    }
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn begin_preview(&self) -> Option<PreviewLease<'_>> {
        if self.auth_resetting.load(Ordering::SeqCst) {
            return None;
        }
        self.active_previews.fetch_add(1, Ordering::SeqCst);
        if self.auth_resetting.load(Ordering::SeqCst) {
            self.active_previews.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        Some(PreviewLease { sync: self })
    }
}

pub struct PreviewLease<'a> {
    sync: &'a SyncControl,
}

impl Drop for PreviewLease<'_> {
    fn drop(&mut self) {
        self.sync.active_previews.fetch_sub(1, Ordering::SeqCst);
    }
}

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
    /// Local cache of downloaded resource bytes, beside the database.
    pub files: FileStore,
    /// The permanent local mirror. Never evicts, never deletes.
    pub mirror: Arc<Mirror>,
    pub client: Mutex<Option<Arc<QuantaClient>>>,
    pub settings: Mutex<Settings>,
    pub sync: Arc<SyncControl>,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("cannot resolve Application Support directory: {e}"))?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create data directory: {e}"))?;
        let db_path = dir.join("quanta-pulse.sqlite");

        let conn = db::open(&db_path).map_err(|e| format!("cannot open database: {e}"))?;
        let settings = db::load_settings(&conn);

        // The mirror root: an explicit setting, or a predictable place under
        // the user's Documents folder, next to nothing important.
        let default_root = Mirror::default_root(app.path().document_dir().ok(), &dir);
        let mirror = Mirror::new(default_root.clone(), MirrorConfig::from_settings(&settings));
        if std::fs::create_dir_all(&default_root).is_err() {
            // A mirror root that cannot be created is reported at download time.
            tracing::warn!("mirror root is not writable: {}", default_root.display());
        }
        mirror.apply_settings(&settings);

        Ok(AppState {
            conn: Mutex::new(conn),
            db_path,
            files: FileStore::new(&dir),
            mirror,
            client: Mutex::new(None),
            settings: Mutex::new(settings),
            sync: Arc::new(SyncControl::default()),
        })
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    /// The handles the mirror needs for one operation. The connection reference
    /// is a borrow, never a guard: nothing here holds it across a `.await`.
    pub fn mirror_ctx(&self) -> MirrorCtx<'_> {
        MirrorCtx {
            conn: &self.conn,
            client: self.client(),
        }
    }

    /// Whether a scan, download or preview is in progress. The updater never
    /// installs into a busy app without an explicit user click.
    pub fn is_busy(&self) -> bool {
        if self.sync.is_running() {
            return true;
        }
        if self.sync.active_previews.load(Ordering::SeqCst) > 0 {
            return true;
        }
        let conn = self.conn();
        let stats = self.mirror.stats(&conn);
        if stats.queued > 0 || stats.downloading > 0 {
            return true;
        }
        false
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_settings(&self, mut settings: Settings) -> Result<(), String> {
        settings.sanitize();
        {
            let conn = self.conn();
            db::save_settings(&conn, &settings).map_err(|e| e.to_string())?;
        }
        self.mirror.apply_settings(&settings);
        *self.settings.lock().unwrap() = settings;
        Ok(())
    }

    pub fn client(&self) -> Option<Arc<QuantaClient>> {
        self.client.lock().unwrap().clone()
    }

    pub fn set_client(&self, client: Option<Arc<QuantaClient>>) {
        *self.client.lock().unwrap() = client;
    }

    /// Build a `SyncStatus` snapshot for the UI.
    pub fn sync_status(&self) -> SyncStatus {
        let conn = self.conn();
        let last = db::last_successful_scan(&conn);
        let last_success = last.as_ref().and_then(|s| s.completed_at.clone());
        // Canonical, not scan-relative: "new" must not vanish the moment the
        // next (unchanged) scan completes.
        let unread_new = db::unread_new_count(&conn);
        let next = db::get_kv(&conn, "next_scan_at");
        let (phase, (done, total)) = {
            (
                self.sync.phase.lock().unwrap().clone(),
                *self.sync.progress.lock().unwrap(),
            )
        };
        SyncStatus {
            running: self.sync.is_running(),
            phase,
            progress: if total == 0 {
                0.0
            } else {
                done as f32 / total as f32
            },
            last_success_at: last_success,
            next_scheduled_at: next,
            unread_new,
            last_error: self.sync.last_error.lock().unwrap().clone(),
            auth_state: self.sync.auth_state(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SyncControl;

    #[test]
    fn auth_expiry_notifies_once_per_episode() {
        let sync = SyncControl::default();
        assert!(sync.note_auth_expired());
        assert!(!sync.note_auth_expired());
        sync.set_auth_state("expired");
        assert!(!sync.note_auth_expired());
        sync.set_auth_state("authenticated");
        assert!(sync.note_auth_expired());
    }

    #[test]
    fn scheduled_scans_pause_until_verified_login() {
        let sync = SyncControl::default();
        assert!(!sync.can_schedule(false));
        sync.set_auth_state("authenticated");
        assert!(sync.can_schedule(true));
        sync.running.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(!sync.can_schedule(true));
        sync.running.store(false, std::sync::atomic::Ordering::SeqCst);
        assert!(!sync.can_schedule(false));
        sync.set_auth_state("expired");
        for _ in 0..100 {
            assert!(!sync.can_schedule(true));
        }
        sync.set_auth_state("authenticated");
        assert!(sync.can_schedule(true));
        sync.auth_resetting.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(!sync.can_schedule(true));
        sync.auth_resetting.store(false, std::sync::atomic::Ordering::SeqCst);
        sync.set_auth_state("unauthenticated");
        assert!(!sync.can_schedule(false));
    }

    #[test]
    fn concurrent_expiry_reports_claim_only_one_notification() {
        let sync = std::sync::Arc::new(SyncControl::default());
        let claims: Vec<_> = (0..16)
            .map(|_| {
                let sync = sync.clone();
                std::thread::spawn(move || sync.note_auth_expired())
            })
            .collect();
        let notifications = claims.into_iter()
            .map(|claim| claim.join().unwrap())
            .filter(|claimed| *claimed)
            .count();
        assert_eq!(notifications, 1);
    }
}

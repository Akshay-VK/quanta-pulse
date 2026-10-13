//! Shared application state.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

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

        Ok(AppState {
            conn: Mutex::new(conn),
            db_path,
            client: Mutex::new(None),
            settings: Mutex::new(settings),
            sync: Arc::new(SyncControl::default()),
        })
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
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

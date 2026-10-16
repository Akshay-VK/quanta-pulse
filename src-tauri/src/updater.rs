//! Background update scheduler.
//!
//! Checks GitHub Releases about 30 seconds after launch and then every six
//! hours. Offline and server errors are logged at debug level only; nothing is
//! ever downloaded or installed without an explicit user click in Settings.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::state::{AppState, SyncControl};

/// Whether a scan or in-flight preview is in progress, given the sync state
/// alone. Exposed so the gating can be exercised without a live Tauri app.
pub fn sync_busy(control: &SyncControl) -> bool {
    control.is_running() || control.active_previews.load(Ordering::SeqCst) > 0
}

/// Run the checks on the configured cadence.
pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Give the UI a moment to boot, then check.
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            run_check(&app).await;
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
            if let Some(state) = app.try_state::<AppState>() {
                if state.sync.shutdown.load(Ordering::SeqCst) {
                    return;
                }
            }
        }
    });
}

async fn run_check(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if !state.settings().update_auto_check {
        return;
    }
    if state.is_busy() {
        return;
    }

    let updater = match app.updater_builder().build() {
        Ok(u) => u,
        Err(e) => {
            tracing::debug!("could not build updater: {e}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            tracing::info!("update available: {}", update.version);
            let _ = app.emit(
                "updater:available",
                serde_json::json!({
                    "version": update.version,
                    "notes": update.body,
                }),
            );
        }
        Ok(None) => {}
        Err(e) => tracing::debug!("update check failed (ignored): {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::SyncControl;

    #[test]
    fn scheduler_skips_out_while_a_scan_is_running() {
        let control = SyncControl::default();
        assert!(!sync_busy(&control));
        control.running.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(sync_busy(&control));
    }

    #[test]
    fn scheduler_skips_out_while_a_preview_is_in_flight() {
        let control = SyncControl::default();
        control
            .active_previews
            .store(1, std::sync::atomic::Ordering::SeqCst);
        assert!(sync_busy(&control));
    }

    #[test]
    fn scheduler_does_not_skip_when_idle() {
        let control = SyncControl::default();
        assert!(!sync_busy(&control));
    }
}
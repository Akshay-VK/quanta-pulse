//! Persistent hourly scheduler.
//!
//! Runs inside the Tauri process (not the webview), so monitoring continues
//! while the dashboard window is closed. Because macOS may suspend the machine
//! while asleep, the loop compares wall-clock time against the stored deadline
//! every 30 seconds: after a wake the scan runs promptly even though monotonic
//! timers do not advance during sleep.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::db;
use crate::state::AppState;
use crate::sync::engine;

/// Granularity of the wait loop. Small enough for prompt catch-up after sleep.
const TICK: Duration = Duration::from_secs(30);

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        run_loop(app).await;
    });
}

async fn run_loop(app: AppHandle) {
    let mut consecutive_errors: u32 = 0;
    let mut first_run = true;

    loop {
        if shutdown(&app) {
            break;
        }

        if app
            .state::<AppState>()
            .sync
            .auth_resetting
            .load(Ordering::SeqCst)
        {
            if sleep_secs(&app, TICK.as_secs()).await {
                break;
            }
            continue;
        }

        if client_ready(&app) && due(&app) {
            let reason = if first_run { "startup" } else { "scheduled" };
            first_run = false;
            let outcome = engine::run_scan(app.clone(), reason).await;

            if outcome.auth_expired {
                // Do not hammer an expired session; wait for re-authentication.
                consecutive_errors = 0;
                tracing::info!("scheduler paused: authentication required");
                if sleep_secs(&app, 300).await {
                    break;
                }
                continue;
            }

            if outcome.cancelled {
                continue;
            }

            if outcome.discovered == 0 && !outcome.errors.is_empty() {
                consecutive_errors = consecutive_errors.saturating_add(1);
                let backoff = backoff_secs(consecutive_errors);
                tracing::warn!(seconds = backoff, "scan failed; retrying with backoff");
                if sleep_secs(&app, backoff).await {
                    break;
                }
                continue;
            }
            consecutive_errors = 0;
        }

        if wait_until_due(&app).await {
            break;
        }
    }
    tracing::info!("scheduler stopped");
}

fn shutdown(app: &AppHandle) -> bool {
    app.state::<AppState>().sync.shutdown.load(Ordering::SeqCst)
}

fn client_ready(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    !state.sync.auth_resetting.load(Ordering::SeqCst) && state.client().is_some()
}

/// True when the stored `next_scan_at` is absent or in the past.
fn due(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let conn = state.conn();
    match db::get_kv(&conn, "next_scan_at") {
        Some(next) => match chrono::DateTime::parse_from_rfc3339(&next) {
            Ok(dt) => chrono::Utc::now() >= dt.with_timezone(&chrono::Utc),
            Err(_) => true,
        },
        None => true,
    }
}

/// Sleep in short chunks until the next scan is due. Returns true on shutdown.
async fn wait_until_due(app: &AppHandle) -> bool {
    loop {
        if shutdown(app) {
            return true;
        }
        if due(app) {
            return false;
        }
        if sleep_secs(app, TICK.as_secs()).await {
            return true;
        }
    }
}

/// Chunked sleep that aborts promptly on shutdown. Returns true on shutdown.
async fn sleep_secs(app: &AppHandle, total: u64) -> bool {
    let mut remaining = total;
    while remaining > 0 {
        if shutdown(app) {
            return true;
        }
        let step = remaining.min(TICK.as_secs());
        tokio::time::sleep(Duration::from_secs(step)).await;
        remaining -= step;
    }
    false
}

/// Exponential backoff capped at 30 minutes.
fn backoff_secs(attempt: u32) -> u64 {
    let exp = 2u64.saturating_pow(attempt.min(5));
    (30 * exp).min(1800)
}

#[cfg(test)]
mod tests {
    use super::backoff_secs;

    #[test]
    fn backoff_grows_and_is_capped() {
        assert_eq!(backoff_secs(1), 60);
        assert_eq!(backoff_secs(2), 120);
        assert_eq!(backoff_secs(3), 240);
        assert!(backoff_secs(20) <= 1800);
    }
}

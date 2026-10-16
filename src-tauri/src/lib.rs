//! Quanta Pulse — a minimal, local-first tracker for the BITS Pilani Quanta LMS.
//!
//! All persistent state lives in a SQLite database inside the macOS Application
//! Support directory. Session cookies remain in process memory and are never
//! persisted to the database or macOS Keychain.

pub mod auth;
pub mod commands;
pub mod core;
pub mod db;
pub mod logging;
pub mod mirror_worker;
pub mod models;
pub mod notify;
pub mod quanta;
pub mod settings;
pub mod state;
pub mod sync;
pub mod telegram_worker;
pub mod tray;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::auth_status,
            commands::refresh_session,
            commands::restart_quanta_session,
            commands::start_sso_login,
            commands::logout,
            commands::list_courses,
            commands::list_resources,
            commands::list_dashboard_resources,
            commands::list_events,
            commands::list_dashboard_events,
            commands::list_history_events,
            commands::clear_dashboard_activity,
            commands::clear_history_activity,
            commands::events_range,
            commands::list_scans,
            commands::list_history_scans,
            commands::sync_now,
            commands::cancel_sync,
            commands::sync_status,
            commands::get_settings,
            commands::set_settings,
            commands::mark_read,
            commands::mark_all_read,
            commands::unread_count,
            commands::test_notification,
            commands::daily_digest,
            commands::rebuild_baseline,
            commands::db_info,
            commands::cache_stats,
            commands::clear_file_cache,
            commands::open_external,
            commands::open_notification_settings,
            commands::mirror_status,
            commands::mirror_local_files,
            commands::mirror_local_file,
            commands::mirror_start_backfill,
            commands::mirror_pause,
            commands::mirror_resume,
            commands::mirror_retry_failed,
            commands::mirror_verify_files,
            commands::mirror_delete_all,
            commands::pick_mirror_root,
            commands::mirror_move_files,
            commands::ensure_local,
            commands::open_local_file,
            commands::reveal_local_file,
            commands::open_app_folder,
            commands::telegram_status,
            commands::telegram_test,
            commands::set_monitoring,
            commands::preview_resource,
            commands::show_main_window,
            commands::ui_ready,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            logging::init(&handle);
            let state = state::AppState::initialize(&handle)
                .map_err(|e| format!("failed to initialise application state: {e}"))?;

            // Restore a previously stored Quanta session before the scheduler starts.
            auth::restore_session(&state);
            app.manage(state);

            tray::setup(app)?;
            spawn_ui_readiness_probe(handle.clone());
            sync::scheduler::start(handle.clone());

            // Backfill at start-up so a fresh install fills the mirror without
            // waiting for the first scan, then let the worker own the queue.
            let state = app.state::<state::AppState>();
            let enqueued = {
                let conn = state.conn();
                state.mirror.enqueue_all(&conn)
            };
            if enqueued > 0 {
                tracing::info!(enqueued, "mirror backfill queued");
            }
            mirror_worker::start(handle.clone());
            telegram_worker::start(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let background = window
                        .app_handle()
                        .try_state::<state::AppState>()
                        .map(|s| s.settings().run_in_background)
                        .unwrap_or(false);
                    if background {
                        // Closing the window keeps monitoring alive in the background.
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Quanta Pulse")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Stop scheduled activity cleanly before the process exits.
                if let Some(state) = app.try_state::<state::AppState>() {
                    state
                        .sync
                        .shutdown
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                }
            }
        });
}

/// Ask the webview to report what it actually rendered **once the dashboard DOM
/// has mounted**. The result is logged via the `ui_ready` command, so a rendered
/// (or broken) UI can be confirmed from the log alone — useful when the display
/// is locked, headless or off-screen and the window cannot be captured.
///
/// Fire-and-forget: it runs on a background task, never blocks startup, and the
/// injected script reports at most once (and contains no user content).
fn spawn_ui_readiness_probe(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        let Some(window) = handle.get_webview_window("main") else {
            tracing::warn!("ui readiness probe: main window not found");
            return;
        };
        // Poll inside the page until `#root` has children (React mounted), then
        // report exactly once. If it never mounts, report once after ~10s so a
        // failed render is still visible in the log.
        let script = r#"(function () {
            var attempts = 0;
            var maxAttempts = 20;
            function report(mounted, root, text) {
                var summary = 'mounted=' + mounted
                    + ' attempts=' + attempts
                    + ' rootChildren=' + (root ? root.children.length : -1)
                    + ' chars=' + text.length
                    + ' brand=' + (text.indexOf('Quanta Pulse') >= 0)
                    + ' title=' + JSON.stringify(document.title);
                window.__TAURI_INTERNALS__.invoke('ui_ready', { summary: summary })
                    .catch(function () {});
            }
            function check() {
                attempts++;
                try {
                    var root = document.getElementById('root');
                    var mounted = !!root && root.children.length > 0;
                    var text = document.body ? (document.body.innerText || '') : '';
                    if (mounted || attempts >= maxAttempts) {
                        report(mounted, root, text);
                        return;
                    }
                } catch (e) { /* keep polling */ }
                setTimeout(check, 500);
            }
            check();
        })();"#;
        if let Err(e) = window.eval(script) {
            tracing::warn!("ui readiness probe: eval failed: {e}");
        }
    });
}

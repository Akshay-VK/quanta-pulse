//! macOS menu bar presence.
//!
//! Quanta Pulse keeps a monochrome template icon in the menu bar so monitoring
//! is visible and controllable without opening the dashboard window.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager};

use crate::db;
use crate::state::AppState;

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    let menu = build_menu(&handle)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .icon_as_template(true)
        .on_menu_event(|app, event| handle_menu(app, event.id.0.as_str()));

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Rebuild the menu with current status (called after every scan).
pub fn refresh(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = build_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<AppState>();
    let (last, new_count, monitoring) = {
        // The connection guard must be released before calling `sync_status()`:
        // that method locks the same non-reentrant `Mutex<Connection>`, so holding
        // it here deadlocks the main thread and freezes the whole app on launch.
        let last = {
            let conn = state.conn();
            db::last_successful_scan(&conn)
                .and_then(|s| s.completed_at)
                .map(friendly_time)
                .unwrap_or_else(|| "never".to_string())
        };
        let new_count = state.sync_status().unread_new;
        let monitoring = if state.client().is_some() {
            if state.sync.is_running() {
                "scanning…"
            } else {
                "active"
            }
        } else {
            "signed out"
        };
        (last, new_count, monitoring)
    };

    let open = MenuItem::with_id(app, "open", "Open Quanta Pulse", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sync now", true, None::<&str>)?;
    let last_item = MenuItem::with_id(
        app,
        "last",
        format!("Last synced: {last}"),
        false,
        None::<&str>,
    )?;
    let new_item = MenuItem::with_id(
        app,
        "new",
        format!("New items: {new_count}"),
        false,
        None::<&str>,
    )?;
    let status_item = MenuItem::with_id(
        app,
        "monitoring",
        format!("Monitoring: {monitoring}"),
        false,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings\u{2026}", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Quanta Pulse", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &open,
            &sync,
            &PredefinedMenuItem::separator(app)?,
            &last_item,
            &new_item,
            &status_item,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_main(app, None),
        "settings" => show_main(app, Some("settings")),
        "sync" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::sync::engine::run_scan(app.clone(), "manual").await;
                refresh(&app);
            });
        }
        "quit" => {
            {
                let state = app.state::<AppState>();
                state
                    .sync
                    .shutdown
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
            app.exit(0);
        }
        _ => {}
    }
}

fn show_main(app: &AppHandle, navigate: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if let Some(target) = navigate {
        let _ = app.emit("ui:navigate", target);
    }
}

fn friendly_time(rfc: String) -> String {
    match chrono::DateTime::parse_from_rfc3339(&rfc) {
        Ok(dt) => {
            let local = dt.with_timezone(&chrono::Local);
            let delta = chrono::Utc::now().signed_duration_since(dt.with_timezone(&chrono::Utc));
            if delta.num_minutes() < 1 {
                "just now".to_string()
            } else if delta.num_minutes() < 60 {
                format!("{}m ago", delta.num_minutes())
            } else if delta.num_hours() < 24 {
                format!("{}h ago", delta.num_hours())
            } else {
                local.format("%d %b %H:%M").to_string()
            }
        }
        Err(_) => rfc,
    }
}

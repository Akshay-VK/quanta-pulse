//! Native macOS notifications.
//!
//! Delivery requires (a) the application to be running, and (b) notification
//! permission granted in System Settings. Quanta Pulse never claims guaranteed
//! delivery when either is missing.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db;
use crate::models::ChangeEvent;
use crate::settings::Settings;
use crate::state::AppState;

fn label_for(kind: &str) -> &'static str {
    match kind {
        "new" => "New upload",
        "announcement" => "Announcement",
        "updated" => "Updated material",
        "deadline" => "Deadline",
        "unavailable" => "Unavailable",
        "restored" => "Available again",
        _ => "Quanta Pulse",
    }
}

fn category_enabled(s: &Settings, kind: &str) -> bool {
    match kind {
        "new" => s.notify_new,
        "announcement" => s.notify_announcements,
        "updated" => s.notify_updated,
        "deadline" => s.notify_deadlines,
        "unavailable" | "restored" => s.notify_availability,
        _ => false,
    }
}

/// Send notifications for all unnotified events, respecting category and quiet
/// hour settings. Returns the number of events marked as notified.
pub fn dispatch(app: &AppHandle) -> usize {
    let state = app.state::<AppState>();
    let settings = state.settings();
    if !settings.notifications_enabled {
        return 0;
    }

    let now_local = chrono::Local::now().format("%H:%M").to_string();
    if settings.in_quiet_hours(&now_local) {
        // Leave events unnotified; they will be delivered after quiet hours.
        return 0;
    }

    let events = {
        let conn = state.conn();
        db::unnotified_events(&conn, 50).unwrap_or_default()
    };
    if events.is_empty() {
        return 0;
    }

    let mut handled: Vec<i64> = Vec::new();
    for event in &events {
        if !category_enabled(&settings, &event.change_type) {
            // Disabled category: clear it so it is not retried forever.
            handled.push(event.id);
            continue;
        }
        if send(app, event) {
            handled.push(event.id);
        }
    }

    if !handled.is_empty() {
        let conn = state.conn();
        let _ = db::mark_notified(&conn, &handled, &db::now_rfc3339());
    }
    handled.len()
}

fn send(app: &AppHandle, event: &ChangeEvent) -> bool {
    let title = match &event.course_name {
        Some(course) => format!("{} · {}", label_for(&event.change_type), course),
        None => label_for(&event.change_type).to_string(),
    };
    let body = event
        .description
        .clone()
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| event.title.clone());

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .is_ok()
}

pub fn notify_auth_expired(app: &AppHandle) {
    let settings = app.state::<AppState>().settings();
    if !settings.notifications_enabled || !settings.notify_auth {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title("Quanta session expired")
        .body("Sign in again to keep monitoring your courses.")
        .show();
}

pub fn test_notification(app: &AppHandle) {
    let _ = app
        .notification()
        .builder()
        .title("Quanta Pulse")
        .body("Notifications are working. You will be alerted about new Quanta material.")
        .show();
}

//! Native notifications, and the change events Telegram forwards.
//!
//! Delivery requires (a) the application to be running, and (b) notification
//! permission granted in System Settings. Quanta Pulse never claims guaranteed
//! delivery when either is missing.
//!
//! The six category switches below are the only filters in the app: Telegram
//! forwarding reuses them through [`category_enabled`] rather than keeping a
//! second, hidden set.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db;
use crate::models::ChangeEvent;
use crate::settings::Settings;
use crate::state::AppState;

pub(crate) fn label_for(kind: &str) -> &'static str {
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

/// The six Settings categories, plus the authentication reminder, which lives
/// on its own screen path but is still one of the six switches.
pub(crate) fn category_enabled(s: &Settings, kind: &str) -> bool {
    match kind {
        "new" => s.notify_new,
        "announcement" => s.notify_announcements,
        "updated" => s.notify_updated,
        "deadline" => s.notify_deadlines,
        "unavailable" | "restored" => s.notify_availability,
        "auth" => s.notify_auth,
        _ => false,
    }
}

/// The title and body a change event shows as. Shared so the native banner and
/// the Telegram message never drift apart.
pub(crate) fn event_text(event: &ChangeEvent) -> (String, String) {
    let title = match &event.course_name {
        Some(course) => format!("{} · {}", label_for(&event.change_type), course),
        None => label_for(&event.change_type).to_string(),
    };
    let body = event
        .description
        .clone()
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| event.title.clone());
    (title, body)
}

/// Send notifications for all unnotified events, respecting category and quiet
/// hour settings. Returns the number of events marked as notified.
pub fn dispatch(app: &AppHandle) -> usize {
    let state = app.state::<AppState>();
    let settings = state.settings();

    let now_local = chrono::Local::now().format("%H:%M").to_string();
    // Quiet hours hold both transports back; the master notifications switch
    // governs the native banner only, so Telegram can be used on its own.
    let quiet = settings.in_quiet_hours(&now_local);
    let native = settings.notifications_enabled && !quiet;
    let telegram =
        settings.telegram_enabled && !quiet && crate::core::telegram::is_configured(&settings);
    if !native && !telegram {
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
    let mut forwarded: Vec<ChangeEvent> = Vec::new();
    for event in &events {
        if !category_enabled(&settings, &event.change_type) {
            // Disabled category: clear it so it is not retried forever.
            handled.push(event.id);
            continue;
        }
        let sent = native && send(app, event);
        if telegram {
            forwarded.push(event.clone());
        }
        if sent || telegram {
            handled.push(event.id);
        }
    }

    if !forwarded.is_empty() {
        crate::telegram_worker::forward(app, forwarded);
    }
    if !handled.is_empty() {
        let conn = state.conn();
        let _ = db::mark_notified(&conn, &handled, &db::now_rfc3339());
    }
    handled.len()
}

fn send(app: &AppHandle, event: &ChangeEvent) -> bool {
    let (title, body) = event_text(event);
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .is_ok()
}

pub fn notify_auth_expired(app: &AppHandle) {
    let settings = app.state::<AppState>().settings();
    if !settings.notify_auth {
        return;
    }
    if settings.notifications_enabled {
        let _ = app
            .notification()
            .builder()
            .title("Quanta session expired")
            .body("Sign in again to keep monitoring your courses.")
            .show();
    }
    if settings.telegram_enabled
        && !settings.in_quiet_hours(&chrono::Local::now().format("%H:%M").to_string())
    {
        crate::telegram_worker::forward_text(
            app,
            "Quanta session expired\nSign in again to keep monitoring your courses.",
        );
    }
}

pub fn test_notification(app: &AppHandle) {
    let _ = app
        .notification()
        .builder()
        .title("Quanta Pulse")
        .body("Notifications are working. You will be alerted about new Quanta material.")
        .show();
}

//! Native notifications, and the change events Telegram forwards.
//!
//! Delivery requires (a) the application to be running, and (b) notification
//! permission granted in System Settings. Quanta Pulse never claims guaranteed
//! delivery when either is missing.
//!
//! The change-event category switches below also filter Telegram forwarding
//! through [`category_enabled`]. Scan-failure alerts have their own native-only
//! preference and never enter the Telegram event path.

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

const SCAN_FAILURE_TITLE: &str = "Quanta scan incomplete";
const SCAN_FAILURE_BODY: &str =
    "Some courses could not be checked. Open Quanta Pulse to review scan details.";

/// Attempt one generic native alert for a finalized incomplete scan. The claim closure must
/// atomically claim a persisted eligible scan. It runs before the sink and owns no lock while the
/// sink runs, so a failed OS delivery remains at-most-once across restarts.
fn attempt_scan_failure_notification<C, S>(
    settings: &Settings,
    local_hhmm: &str,
    scan_id: i64,
    claim: C,
    sink: S,
) -> bool
where
    C: FnOnce(i64) -> bool,
    S: FnOnce(&str, &str) -> Result<(), ()>,
{
    if !settings.notifications_enabled
        || !settings.notify_scan_failures
        || settings.in_quiet_hours(local_hhmm)
        || !claim(scan_id)
    {
        return false;
    }
    let _ = sink(SCAN_FAILURE_TITLE, SCAN_FAILURE_BODY);
    true
}

/// Send a scan failure alert after its terminal row has been persisted.
pub fn notify_scan_failure(app: &AppHandle, scan_id: i64) {
    let state = app.state::<AppState>();
    let settings = state.settings();
    let local_hhmm = chrono::Local::now().format("%H:%M").to_string();
    let claimed = attempt_scan_failure_notification(
        &settings,
        &local_hhmm,
        scan_id,
        |id| {
            let conn = state.conn();
            db::claim_scan_failure_notification(&conn, id, &db::now_rfc3339()).unwrap_or(false)
        },
        |title, body| {
            app.notification()
                .builder()
                .title(title)
                .body(body)
                .show()
                .map(|_| ())
                .map_err(|_| ())
        },
    );
    let _ = claimed;
}

pub fn test_notification(app: &AppHandle) {
    let _ = app
        .notification()
        .builder()
        .title("Quanta Pulse")
        .body("Notifications are working. You will be alerted about new Quanta material.")
        .show();
}

#[cfg(test)]
mod scan_failure_tests {
    use super::*;
    use rusqlite::Connection;
    use std::cell::RefCell;

    fn scan(conn: &Connection, status: &str, failed: i64, baseline: bool) -> i64 {
        let id = db::start_scan(conn, "2026-11-16T10:00:00Z").unwrap();
        db::finish_scan(
            conn,
            id,
            status,
            0,
            0,
            0,
            0,
            1,
            failed,
            None,
            baseline,
            "2026-11-16T10:01:00Z",
        )
        .unwrap();
        id
    }

    fn try_scan(
        conn: &Connection,
        settings: &Settings,
        hhmm: &str,
        id: i64,
        sink: impl FnOnce(&str, &str) -> Result<(), ()>,
    ) -> bool {
        attempt_scan_failure_notification(
            settings,
            hhmm,
            id,
            |scan_id| {
                db::claim_scan_failure_notification(conn, scan_id, "2026-11-16T10:02:00Z")
                    .unwrap_or(false)
            },
            sink,
        )
    }

    #[test]
    fn gates_prevent_claim_when_global_preference_or_quiet_hours_block() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let id = scan(&conn, "partial", 0, false);
        let calls = RefCell::new(0);
        let mut settings = Settings {
            notifications_enabled: false,
            ..Settings::default()
        };
        assert!(!try_scan(&conn, &settings, "12:00", id, |_, _| {
            *calls.borrow_mut() += 1;
            Ok(())
        }));
        settings.notifications_enabled = true;
        settings.notify_scan_failures = false;
        assert!(!try_scan(&conn, &settings, "12:00", id, |_, _| {
            *calls.borrow_mut() += 1;
            Ok(())
        }));
        settings.notify_scan_failures = true;
        settings.quiet_hours_start = Some("11:00".into());
        settings.quiet_hours_end = Some("13:00".into());
        assert!(!try_scan(&conn, &settings, "12:00", id, |_, _| {
            *calls.borrow_mut() += 1;
            Ok(())
        }));
        assert_eq!(*calls.borrow(), 0);
        assert!(db::claim_scan_failure_notification(&conn, id, "now").unwrap());
    }

    #[test]
    fn partial_zero_failed_courses_and_failed_course_outcomes_notify_once_per_scan_id() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let partial = scan(&conn, "partial", 0, false);
        let failed_course = scan(&conn, "ok", 1, false);
        let calls = RefCell::new(Vec::new());
        let settings = Settings::default();
        let attempts = [partial, partial, failed_course].map(|id| {
            try_scan(&conn, &settings, "12:00", id, |title, body| {
                calls
                    .borrow_mut()
                    .push((title.to_string(), body.to_string()));
                Ok(())
            })
        });
        assert_eq!(attempts, [true, false, true]);
        assert_eq!(calls.borrow().len(), 2);
        let (title, body) = &calls.borrow()[0];
        assert_eq!(title, "Quanta scan incomplete");
        assert_eq!(
            body,
            "Some courses could not be checked. Open Quanta Pulse to review scan details."
        );
        for unsafe_text in ["https://", "id", "password", "token"] {
            assert!(!title.contains(unsafe_text));
            assert!(!body.contains(unsafe_text));
        }
    }

    #[test]
    fn cancelled_auth_success_and_successful_baseline_do_not_notify_but_partial_baseline_does() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let cancelled = scan(&conn, "cancelled", 1, false);
        let auth = scan(&conn, "auth_expired", 1, false);
        let success = scan(&conn, "ok", 0, false);
        let baseline = scan(&conn, "ok", 0, true);
        let partial_baseline = scan(&conn, "partial", 0, true);
        let settings = Settings::default();
        for id in [cancelled, auth, success, baseline] {
            assert!(!try_scan(&conn, &settings, "12:00", id, |_, _| panic!(
                "ineligible scan reached sink"
            )));
        }
        assert!(try_scan(
            &conn,
            &settings,
            "12:00",
            partial_baseline,
            |_, _| Ok(())
        ));
    }

    #[test]
    fn sink_error_stays_claimed_and_claim_survives_database_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scan-alerts.db");
        let id;
        {
            let conn = db::open(&path).unwrap();
            id = scan(&conn, "failed", 0, false);
            assert!(try_scan(
                &conn,
                &Settings::default(),
                "12:00",
                id,
                |_, _| Err(())
            ));
        }
        {
            let conn = db::open(&path).unwrap();
            assert!(!try_scan(
                &conn,
                &Settings::default(),
                "12:00",
                id,
                |_, _| panic!("duplicate reached sink")
            ));
            let distinct = scan(&conn, "failed", 0, false);
            assert!(try_scan(
                &conn,
                &Settings::default(),
                "12:00",
                distinct,
                |_, _| Ok(())
            ));
        }
    }
}

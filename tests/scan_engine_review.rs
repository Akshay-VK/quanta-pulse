//! Scan admission and reset cancellation against the production SQLite adapter.
use super::*;
use crate::core::files::FileStore;
use crate::core::mirror::{Mirror, MirrorConfig};
use crate::models::ScanCourseStatus;
use crate::quanta::discover::{Observation, ObservationBoundary};
use crate::settings::Settings;

fn fixture(data: &tempfile::TempDir) -> AppState {
    let settings = Settings::default();
    let db_path = data.path().join("scan-review.sqlite");
    AppState {
        conn: db::open(&db_path).unwrap().into(),
        db_path,
        files: FileStore::new(data.path()),
        mirror: Mirror::new(
            data.path().join("mirror"),
            MirrorConfig::from_settings(&settings),
        ),
        client: Default::default(),
        settings: settings.into(),
        sync: Default::default(),
    }
}

#[test]
fn rust_review_scan_start_rejection_prevents_collection() {
    let dir = tempfile::tempdir().unwrap();
    let state = fixture(&dir);
    state
        .conn()
        .execute_batch(
            "CREATE TRIGGER ignore_start BEFORE INSERT ON scan_runs
         BEGIN SELECT RAISE(IGNORE); END;",
        )
        .unwrap();

    let mut outcome = ScanOutcome::default();
    assert!(start_scan(&state, &mut outcome).is_none());
    assert!(!outcome.committed);
    assert!(outcome.errors[0].contains("scan start failed"));
    assert!(db::list_scans(&state.conn(), 10).unwrap().is_empty());
}

#[test]
fn rust_review_corrupt_baseline_state_stops_before_collection_and_records_failure() {
    for (key, sql_value) in [
        ("baseline_established", "X'00'"),
        ("baseline_established", "'invalid timestamp'"),
        ("baseline_reset_generation", "'invalid generation'"),
        ("baseline_global_reset_generation", "'-1'"),
        ("rebaseline_courses", "'invalid JSON'"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let state = fixture(&dir);
        state
            .conn()
            .execute_batch(&format!(
                "INSERT INTO settings(key, value) VALUES ('{key}', {sql_value});"
            ))
            .unwrap();

        let mut outcome = ScanOutcome::default();
        assert!(start_scan(&state, &mut outcome).is_none(), "{key}");
        assert!(!outcome.committed);
        assert!(outcome.errors[0].contains(key), "{outcome:?}");
        let runs = db::list_scans(&state.conn(), 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "failed");
        assert!(runs[0].completed_at.is_some());
        assert!(runs[0].error_summary.as_deref().unwrap().contains(key));
    }
}

#[test]
fn rust_review_reset_cancellation_finalizes_history_and_observed_diagnostics() {
    let (send, receive) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let dir = tempfile::tempdir().unwrap();
        let state = fixture(&dir);
        let mut outcome = ScanOutcome::default();
        let (scan_id, _) = start_scan(&state, &mut outcome).unwrap();
        let collector = Collector::default();
        collector.observer()(Observation {
            course_external_id: "10".into(),
            course_name: "Fixture Course".into(),
            at: db::now_rfc3339(),
            boundary: ObservationBoundary::CourseStarted,
        });
        record_reset_cancellation(&state, &collector, scan_id, &mut outcome);

        assert!(outcome.cancelled);
        assert!(!outcome.committed);
        assert!(outcome.errors.is_empty(), "{outcome:?}");
        let runs = db::list_scans(&state.conn(), 10).unwrap();
        assert_eq!(runs[0].status, "cancelled");
        let details = db::scan_details(&state.conn(), scan_id).unwrap().unwrap();
        assert_eq!(details.courses[0].status, ScanCourseStatus::Cancelled);
        assert!(db::get_kv(&state.conn(), "baseline_established").is_none());
        send.send(()).unwrap();
    });
    receive
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("reset cancellation should persist diagnostics and release the connection");
    worker.join().unwrap();
}

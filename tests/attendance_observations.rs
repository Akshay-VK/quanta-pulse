// Attendance through A0's verified loopback transport and real temporary SQLite.
#[tokio::test]
async fn attendance_keeps_own_activity_group_and_range_snapshots_with_literal_values() {
    use crate::{academic, attendance};
    use academic::{AttendanceSessionState, Coverage};

    let report = include_str!("fixtures/academic/attendance/self-report.html");
    let weak = report
        .replace("data-range=\"month\"", "data-range=\"custom\"")
        .replace("2026-11-01", "2026-11-02")
        .replace("data-pages=\"1\"", "data-pages=\"2\"")
        .replace(" data-session-id=\"911\"", "");
    let lecture = report
        .replace("data-module=\"29\"", "data-module=\"30\"")
        .replace("data-instance=\"61\"", "data-instance=\"62\"")
        .replace("data-group=\"7\"", "data-group=\"course\"")
        .replace("<p data-field=\"group\">Group Cedar</p>", "")
        .replace("Field methods lab", "Field methods lecture");
    let reply = |status, html: &str| {
        (
            status,
            "Content-Type: text/html\r\n".into(),
            html.as_bytes().to_vec(),
        )
    };
    let server = ReportServer::start(vec![
        verified_reply(),
        reply(200, &report.replace("4242", "5252")),
        reply(200, &weak),
        reply(200, report),
        reply(200, &lecture),
        (
            302,
            "Location: /mod/attendance/attendance.php?sessid=926\r\n".into(),
            vec![],
        ),
        reply(403, "Restricted"),
        reply(503, ""),
    ]);
    let data = tempfile::tempdir().unwrap();
    let app = state(&data);
    verify_and_install_session(&app, server.candidate(), None)
        .await
        .unwrap();
    let generation = academic::context(&app).generation;
    let course = attendance_course(&app);
    let collect = |module| attendance::collect(&app, &generation, course, module);
    let page = || academic::attendance(&app, &generation, course).unwrap();

    assert!(!collect(29).await.unwrap().changed);
    assert_eq!(page().coverage.unwrap().coverage, Coverage::Unsupported);
    assert!(page().records.is_empty());
    assert!(!collect(29).await.unwrap().changed);
    let partial = page();
    let coverage = partial.coverage.unwrap();
    assert_eq!(coverage.coverage, Coverage::Partial);
    assert!(!coverage.baseline_established);
    assert!(coverage.last_successful_at.is_none());
    let snapshot = partial.records[0].details.as_ref().unwrap();
    assert_eq!((snapshot.page, snapshot.total_pages), (1, 2));
    assert!(!snapshot.complete);
    assert!(snapshot.sessions.iter().all(|row| row.session_id.is_none()));

    assert!(!collect(29).await.unwrap().changed);
    assert!(!collect(30).await.unwrap().changed);
    let current = page();
    assert!(current.coverage.unwrap().baseline_established);
    assert_eq!(current.records.len(), 3);
    let monthly = current
        .records
        .iter()
        .find(|record| {
            record.course_module_id == Some(29) && record.details.as_ref().unwrap().complete
        })
        .unwrap();
    assert_eq!(monthly.maximum_display.as_deref(), Some("0.00"));
    assert_eq!(
        monthly.summary_display.as_deref(),
        Some("Undefined by source")
    );
    let snapshot = monthly.details.as_ref().unwrap();
    assert_eq!(snapshot.title, "Field methods lab");
    assert_eq!(snapshot.group_id, Some(7));
    assert_eq!(snapshot.through.as_deref(), Some("2026-11-30"));
    assert_eq!(snapshot.sessions[0].session_id, Some(911));
    assert_eq!(
        snapshot.sessions[0].status_display.as_deref(),
        Some("Field credit")
    );
    assert_eq!(snapshot.sessions[0].points_display.as_deref(), Some("0.00"));
    assert_eq!(
        snapshot.sessions[0].maximum_display.as_deref(),
        Some("2.50")
    );
    assert_eq!(
        snapshot
            .sessions
            .iter()
            .map(|row| row.state)
            .collect::<Vec<_>>(),
        [
            AttendanceSessionState::Recorded,
            AttendanceSessionState::Absent,
            AttendanceSessionState::Unrecorded,
            AttendanceSessionState::Future,
            AttendanceSessionState::EnrollmentBoundary,
        ]
    );
    let wire = serde_json::to_value(monthly).unwrap();
    assert_eq!(
        wire["details"]["sessions"][4]["state"],
        "enrollmentBoundary"
    );
    assert_eq!(wire["maximumDisplay"], "0.00");

    assert!(!collect(29).await.unwrap().changed);
    assert_eq!(page().coverage.unwrap().coverage, Coverage::Unsupported);
    assert_eq!(page().records.len(), 3);
    assert!(!collect(29).await.unwrap().changed);
    assert_eq!(page().coverage.unwrap().coverage, Coverage::Denied);
    assert_eq!(page().records.len(), 1);
    assert_eq!(page().records[0].course_module_id, Some(30));
    assert!(!collect(29).await.unwrap().changed);
    assert_eq!(page().coverage.unwrap().coverage, Coverage::Offline);
    assert_eq!(page().records.len(), 1);
    assert!(academic::grades(&app, &generation, course)
        .unwrap()
        .coverage
        .is_none());
    assert!(db::list_history_events(&app.conn(), 100)
        .unwrap()
        .is_empty());

    server.server.join().unwrap();
    let targets = server
        .requests
        .try_iter()
        .skip(1)
        .map(|request| {
            request
                .split_whitespace()
                .take(2)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>();
    assert_eq!(
        targets,
        [29, 29, 29, 30, 29, 29, 29]
            .map(|module| format!("GET /mod/attendance/view.php?id={module}"))
    );
}

fn attendance_course(app: &AppState) -> i64 {
    db::upsert_course(
        &app.conn(),
        "101",
        "Synthetic field methods",
        None,
        &format!("{QUANTA_ORIGIN}/course/view.php?id=101"),
        &db::now_rfc3339(),
    )
    .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attendance_delayed_previous_owner_cannot_commit_or_publish_after_logout() {
    use crate::{academic, attendance};

    let fixture = include_str!("fixtures/academic/attendance/self-report.html");
    let data = tempfile::tempdir().unwrap();
    let app = Arc::new(state(&data));
    let course = attendance_course(&app);
    let initial = ReportServer::start(vec![
        verified_reply(),
        (
            200,
            "Content-Type: text/html\r\n".into(),
            fixture.as_bytes().to_vec(),
        ),
    ]);
    verify_and_install_session(&app, initial.candidate(), None)
        .await
        .unwrap();
    let first = academic::context(&app).generation;
    let committed = attendance::collect(&app, &first, course, 29).await.unwrap();
    initial.server.join().unwrap();

    let (delayed, release) = delayed_student_report_with_body(fixture);
    verify_and_install_session(&app, delayed.candidate(), None)
        .await
        .unwrap();
    let generation = academic::context(&app).generation;
    delayed
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    let pending = {
        let app = app.clone();
        let generation = generation.clone();
        tokio::spawn(async move { attendance::collect(&app, &generation, course, 29).await })
    };
    let request = delayed
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    assert!(request.starts_with("GET /mod/attendance/view.php?id=29 "));
    logout(&app).unwrap();

    let b = ReportServer::start(vec![(
        200,
        "Content-Type: text/html\r\n".into(),
        VERIFIED_PAGE.replace("4242", "5252").into_bytes(),
    )]);
    verify_and_install_session(&app, b.candidate(), None)
        .await
        .unwrap();
    b.server.join().unwrap();
    release.send(()).unwrap();
    delayed.server.join().unwrap();
    assert!(pending.await.unwrap().is_err());
    assert!(academic::attendance(&app, &generation, course).is_err());
    assert!(
        academic::publish_if_current(&app, &committed, || panic!("Stale publication")).is_err()
    );
    let current = academic::context(&app);
    let b_page = academic::attendance(&app, &current.generation, course).unwrap();
    assert!(b_page.records.is_empty() && b_page.coverage.is_none());

    drop(app);
    let app = state(&data);
    let a = ReportServer::start(vec![verified_reply()]);
    verify_and_install_session(&app, a.candidate(), None)
        .await
        .unwrap();
    a.server.join().unwrap();
    let generation = academic::context(&app).generation;
    let a_page = academic::attendance(&app, &generation, course).unwrap();
    assert!(a_page.coverage.unwrap().baseline_established);
    assert_eq!(a_page.records.len(), 1);
    assert_eq!(a_page.records[0].maximum_display.as_deref(), Some("0.00"));
}

#[tokio::test]
async fn attendance_legacy_upgrade_and_failed_snapshot_write_preserve_baseline_atomically() {
    use crate::{academic, attendance};
    use academic::{AcademicBatch, AttendanceObservation, Coverage};

    let report = include_str!("fixtures/academic/attendance/self-report.html");
    let duplicate_id = report.replace("data-session-id=\"912\"", "data-session-id=\"911\"");
    let truncated = report.replace("data-page-rows=\"5\"", "data-page-rows=\"6\"");
    let different_group = truncated
        .replace("data-group=\"7\"", "data-group=\"8\"")
        .replace("Group Cedar", "Group Maple");
    let reply = |html: &str| {
        (
            200,
            "Content-Type: text/html\r\n".into(),
            html.as_bytes().to_vec(),
        )
    };
    let server = ReportServer::start(vec![
        verified_reply(),
        reply(&duplicate_id),
        reply(&truncated),
        reply(&different_group),
        reply(&different_group),
    ]);
    let data = tempfile::tempdir().unwrap();
    let app = state(&data);
    verify_and_install_session(&app, server.candidate(), None)
        .await
        .unwrap();
    let generation = academic::context(&app).generation;
    let course = attendance_course(&app);
    let mut source = academic::AssignmentObservation::synthetic("legacy-scope", "unused").source;
    source.source_url = format!("{QUANTA_ORIGIN}/mod/attendance/view.php?id=30");
    let legacy = AttendanceObservation {
        source,
        activity_instance_id: 62,
        course_module_id: Some(30),
        session_id: None,
        scope_display: "Legacy scope".into(),
        status_display: None,
        points_display: None,
        maximum_display: Some("0".into()),
        summary_display: None,
        details: None,
    };
    let legacy_commit = || {
        academic::commit(
            &app,
            &generation,
            course,
            Coverage::Complete,
            AcademicBatch::Attendance(vec![legacy.clone()]),
        )
    };
    assert!(!legacy_commit().unwrap().changed);
    {
        let conn = app.conn();
        conn.execute_batch("ALTER TABLE academic_attendance DROP COLUMN details;")
            .unwrap();
        db::set_kv(&conn, db::SCHEMA_REVISION_KEY, "11").unwrap();
        db::set_kv(&conn, db::LAST_APP_VERSION_KEY, env!("CARGO_PKG_VERSION")).unwrap();
        db::upgrade(&conn, &app.db_path, env!("CARGO_PKG_VERSION")).unwrap();
        db::upgrade(&conn, &app.db_path, env!("CARGO_PKG_VERSION")).unwrap();
    }
    assert!(!legacy_commit().unwrap().changed);
    let page = || academic::attendance(&app, &generation, course).unwrap();
    assert_eq!(page().records, vec![legacy]);
    assert!(
        !attendance::collect(&app, &generation, course, 29)
            .await
            .unwrap()
            .changed
    );
    let complete = page();
    let scoped = complete
        .records
        .iter()
        .find_map(|row| row.details.as_ref())
        .unwrap();
    assert!(scoped.complete && scoped.sessions.iter().all(|row| row.session_id.is_none()));
    assert!(
        !attendance::collect(&app, &generation, course, 29)
            .await
            .unwrap()
            .changed
    );
    let before = page();
    let coverage = before.coverage.as_ref().unwrap();
    assert_eq!(coverage.coverage, Coverage::Partial);
    assert!(coverage.baseline_established);
    assert_eq!(before.records, complete.records);
    app.conn()
        .execute_batch(
            "CREATE TRIGGER reject_attendance_coverage BEFORE UPDATE ON academic_coverage
         WHEN new.domain='attendance' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;",
        )
        .unwrap();
    assert!(attendance::collect(&app, &generation, course, 29)
        .await
        .is_err());
    let after = page();
    assert_eq!(after.records, before.records);
    assert_eq!(
        serde_json::to_value(after.coverage).unwrap(),
        serde_json::to_value(before.coverage).unwrap()
    );
    app.conn()
        .execute_batch("DROP TRIGGER reject_attendance_coverage;")
        .unwrap();
    assert!(
        !attendance::collect(&app, &generation, course, 29)
            .await
            .unwrap()
            .changed
    );
    let groups = page()
        .records
        .into_iter()
        .filter_map(|row| row.details)
        .map(|details| (details.group_id, details.complete))
        .collect::<Vec<_>>();
    assert_eq!(groups, [(Some(7), true), (Some(8), false)]);
    server.server.join().unwrap();
}

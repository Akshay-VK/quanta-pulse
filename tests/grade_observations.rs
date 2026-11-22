// Production collection through a verified loopback session and temporary SQLite.
#[tokio::test]
async fn own_grade_reports_keep_literal_values_and_reconcile_visibility_across_sessions() {
    use crate::{academic, grades};
    use academic::{Coverage, GradeKind, GradeValueStatus, Visibility};

    let reply = |status, html: &str| {
        (
            status,
            "Content-Type: text/html\r\n".into(),
            html.as_bytes().to_vec(),
        )
    };
    let report = include_str!("fixtures/academic/grades/self-report.html");
    let restricted = report
        .replace(
            "headers=\"cat_12_4242 row_11_4242 grade4242\"",
            "headers=\"cat_12_4242 row_11_4242 grade4242\" data-grade-state=\"unreleased\"",
        )
        .replace("class=\"datesubmitted\">Submitted on November 15", ">8.50")
        .lines()
        .filter(|line| !line.contains("row_13_4242"))
        .collect::<Vec<_>>()
        .join("\n");
    let partial = restricted
        .replace(
            "data-grade-state=\"unreleased\"",
            "data-grade-state=\"hidden\"",
        )
        .replace("row_12_4242", "row_unstable_4242");
    let server = ReportServer::start(vec![
        verified_reply(),
        reply(200, &report.replace("4242", "5252")),
        reply(200, report),
        reply(503, ""),
        reply(200, &restricted),
        reply(200, &partial),
        reply(403, "Denied"),
    ]);
    let data = tempfile::tempdir().unwrap();
    let app = state(&data);
    verify_and_install_session(&app, server.candidate(), None)
        .await
        .unwrap();
    let generation = academic::context(&app).generation;
    let course = db::upsert_course(
        &app.conn(),
        "101",
        "Systems",
        None,
        &format!("{QUANTA_ORIGIN}/course/view.php?id=101"),
        &db::now_rfc3339(),
    )
    .unwrap();
    let page = || academic::grades(&app, &generation, course).unwrap();
    let collect = || grades::collect(&app, &generation, course);

    assert!(!collect().await.unwrap().changed);
    let unsupported = page().coverage.unwrap();
    assert_eq!(unsupported.coverage, Coverage::Unsupported);
    assert!(!unsupported.baseline_established);
    assert!(!collect().await.unwrap().changed);
    let observed = page();
    assert!(observed.coverage.unwrap().baseline_established);
    let row = |id| {
        observed
            .records
            .iter()
            .find(|r| r.grade_item_id == Some(id))
            .unwrap()
    };
    assert_eq!(row(11).display_value.as_deref(), Some("0.00"));
    assert_eq!(row(11).numeric_value, Some(0.0));
    assert_eq!(row(11).parent_source_id.as_deref(), Some("category:12"));
    assert_eq!(row(11).range_display.as_deref(), Some("0–10"));
    assert_eq!(row(11).weight_display.as_deref(), Some("20.00 %"));
    assert_eq!(
        row(11)
            .details
            .as_ref()
            .unwrap()
            .percentage_display
            .as_deref(),
        Some("0.00 %")
    );
    assert_eq!(
        row(11).feedback.as_deref(),
        Some("Private synthetic feedback example.")
    );
    assert_eq!(row(12).display_value.as_deref(), Some("Meets expectations"));
    assert_eq!(row(13).display_value.as_deref(), Some("A−"));
    assert_eq!(
        row(14).details.as_ref().unwrap().value_status,
        GradeValueStatus::Ungraded
    );
    assert_eq!(row(15).source.visibility, Visibility::Hidden);
    assert!(row(15).display_value.is_none());
    assert_eq!(
        row(16).details.as_ref().unwrap().value_status,
        GradeValueStatus::Unknown
    );
    assert_eq!(row(18).item_kind, GradeKind::CategoryTotal);
    assert_eq!(
        row(18).details.as_ref().unwrap().value_status,
        GradeValueStatus::Blank
    );
    assert_eq!(row(900).display_value.as_deref(), Some("71.25"));
    assert!(observed
        .records
        .iter()
        .any(|r| r.source.source_id == "category:12"
            && r.parent_source_id.as_deref() == Some("category:1")
            && r.grade_item_id.is_none()));
    assert!(!collect().await.unwrap().changed);
    let stale = page();
    assert!(stale.coverage.unwrap().stale);
    assert_eq!(stale.records, observed.records);

    assert!(collect().await.unwrap().changed);
    let current = page();
    let row = |id| {
        current
            .records
            .iter()
            .find(|r| r.grade_item_id == Some(id))
            .unwrap()
    };
    assert_eq!(row(15).display_value.as_deref(), Some("8.50"));
    assert_eq!(row(11).source.visibility, Visibility::Unreleased);
    assert!(
        row(11).display_value.is_none() && row(11).feedback.is_none() && row(11).details.is_none()
    );
    assert!(row(13).omitted);
    assert_eq!(row(13).display_value.as_deref(), Some("A−"));
    assert!(!collect().await.unwrap().changed);
    let partial_page = page();
    assert_eq!(partial_page.coverage.unwrap().coverage, Coverage::Partial);
    assert_eq!(
        partial_page
            .records
            .iter()
            .find(|r| r.grade_item_id == Some(11))
            .unwrap()
            .source
            .visibility,
        Visibility::Hidden
    );
    assert!(!collect().await.unwrap().changed);
    assert!(page().records.is_empty());
    assert_eq!(app.sync.auth_state(), "authenticated");
    {
        let conn = app.conn();
        assert!(db::list_history_events(&conn, 100).unwrap().is_empty());
        assert!(db::unnotified_events(&conn, 100).unwrap().is_empty());
        assert!(
            crate::core::search::search(&conn, &app.mirror, "Manual checkpoint", 10).is_empty()
        );
        assert!(
            !serde_json::to_string(&crate::search::desktop_inventory(&conn).unwrap())
                .unwrap()
                .contains("Manual checkpoint")
        );
        let retained: i64 = conn.query_row("SELECT COUNT(*) FROM academic_grades WHERE display_value IS NOT NULL OR feedback IS NOT NULL OR details IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(retained, 0);
    }
    server.server.join().unwrap();
    let requests = server.requests.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 7);
    assert!(requests[1..]
        .iter()
        .all(|r| r.starts_with("GET /grade/report/user/index.php?id=101 ")));

    drop(app);
    let restarted = state(&data);
    assert!(academic::grades(&restarted, &generation, course).is_err());
    let b = VERIFIED_PAGE.replace("4242", "5252");
    let report_b = report.replace("4242", "5252");
    let other = ReportServer::start(vec![reply(200, &b), reply(200, &report_b)]);
    verify_and_install_session(&restarted, other.candidate(), None)
        .await
        .unwrap();
    let new_generation = academic::context(&restarted).generation;
    let empty = academic::grades(&restarted, &new_generation, course).unwrap();
    assert!(empty.coverage.is_none() && empty.records.is_empty());
    assert!(grades::collect(&restarted, &generation, course)
        .await
        .is_err());
    assert!(
        !grades::collect(&restarted, &new_generation, course)
            .await
            .unwrap()
            .changed
    );
    other.server.join().unwrap();

    let same = ReportServer::start(vec![verified_reply(), reply(503, ""), reply(200, report)]);
    verify_and_install_session(&restarted, same.candidate(), None)
        .await
        .unwrap();
    let same_generation = academic::context(&restarted).generation;
    let page = || academic::grades(&restarted, &same_generation, course).unwrap();
    assert!(page().coverage.unwrap().baseline_established);
    assert!(
        !grades::collect(&restarted, &same_generation, course)
            .await
            .unwrap()
            .changed
    );
    assert!(page().records.is_empty());
    assert!(
        grades::collect(&restarted, &same_generation, course)
            .await
            .unwrap()
            .changed
    );
    assert!(page()
        .records
        .iter()
        .any(|r| r.display_value.as_deref() == Some("71.25")));
    same.server.join().unwrap();
}

#[tokio::test]
async fn grade_details_upgrade_keeps_revision_ten_rows_and_existing_baseline() {
    use crate::academic::{self, AcademicBatch, Coverage};
    let fixture = ReportServer::start(vec![verified_reply()]);
    let data = tempfile::tempdir().unwrap();
    let app = state(&data);
    verify_and_install_session(&app, fixture.candidate(), None)
        .await
        .unwrap();
    fixture.server.join().unwrap();
    let generation = academic::context(&app).generation;
    let rows = vec![synthetic_grade("legacy-grade")];
    let commit = || {
        academic::commit(
            &app,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(rows.clone()),
        )
    };
    assert!(!commit().unwrap().changed);
    {
        let conn = app.conn();
        conn.execute_batch("ALTER TABLE academic_grades DROP COLUMN omitted; ALTER TABLE academic_grades DROP COLUMN details;").unwrap();
        db::set_kv(&conn, db::SCHEMA_REVISION_KEY, "10").unwrap();
        db::set_kv(&conn, db::LAST_APP_VERSION_KEY, env!("CARGO_PKG_VERSION")).unwrap();
        db::upgrade(&conn, &app.db_path, env!("CARGO_PKG_VERSION")).unwrap();
        db::upgrade(&conn, &app.db_path, env!("CARGO_PKG_VERSION")).unwrap();
    }
    let backup = std::fs::read_dir(data.path().join("backups"))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(backup.len(), 1);
    let old = rusqlite::Connection::open(backup[0].path()).unwrap();
    assert_eq!(
        db::get_kv(&old, db::SCHEMA_REVISION_KEY).as_deref(),
        Some("10")
    );
    let page = academic::grades(&app, &generation, 101).unwrap();
    assert_eq!(page.records, rows);
    assert!(page.coverage.unwrap().baseline_established);
    assert!(!commit().unwrap().changed);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn busy_grade_collection_does_not_publish_offline_or_commit_after_logout() {
    use crate::{academic, grades};
    let data = tempfile::tempdir().unwrap();
    let app = Arc::new(state(&data));
    let course = db::upsert_course(
        &app.conn(),
        "101",
        "Systems",
        None,
        &format!("{QUANTA_ORIGIN}/course/view.php?id=101"),
        &db::now_rfc3339(),
    )
    .unwrap();
    let (server, release) = delayed_student_report();
    verify_and_install_session(&app, server.candidate(), None)
        .await
        .unwrap();
    server
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    let generation = academic::context(&app).generation;
    let pending = {
        let app = app.clone();
        let generation = generation.clone();
        tokio::spawn(async move { grades::collect(&app, &generation, course).await })
    };
    let request = server
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    assert!(request.starts_with("GET /grade/report/user/index.php?id=101 "));
    let busy = grades::collect(&app, &generation, course).await;
    let page = academic::grades(&app, &generation, course).unwrap();
    logout(&app).unwrap();
    release.send(()).unwrap();
    assert!(pending.await.unwrap().is_err());
    server.server.join().unwrap();
    assert!(busy.is_err());
    assert!(page.coverage.is_none());
    assert!(academic::grades(&app, &generation, course).is_err());
}

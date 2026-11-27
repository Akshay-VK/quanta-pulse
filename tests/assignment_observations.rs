// Local collection, bounded self-report transport and private SQLite reconciliation.
#[tokio::test]
async fn assignment_observations_keep_source_dates_status_and_release_distinct() {
    use crate::academic::{
        self, AcademicBatch, AcademicDate, Coverage, DueProvenance, SubmissionMode,
        SubmissionStatus,
    };
    use crate::assignments;
    let fixture = |body: &str| {
        (
            200,
            "Content-Type: text/html\r\n".into(),
            body.as_bytes().to_vec(),
        )
    };
    let server = ReportServer::start(vec![
        verified_reply(),
        fixture(include_str!(
            "fixtures/academic/assignments/team-extension.html"
        )),
        fixture(include_str!(
            "fixtures/academic/assignments/missing-optionals.html"
        )),
        fixture(include_str!(
            "fixtures/academic/assignments/individual-reopened.html"
        )),
        (
            403,
            "Content-Type: text/html\r\n".into(),
            b"Denied".to_vec(),
        ),
    ]);
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    verify_and_install_session(&state, server.candidate(), None)
        .await
        .unwrap();
    let generation = academic::context(&state).generation;
    let (course, resource) = {
        let now = db::now_rfc3339();
        let conn = state.conn();
        let course = db::upsert_course(
            &conn,
            "101",
            "Systems",
            None,
            "https://quanta.bits-pilani.ac.in/course/view.php?id=101",
            &now,
        )
        .unwrap();
        let resource = db::upsert_resource(
            &conn,
            &db::ResourceWrite {
                external_id: "fixture-assign-13",
                course_id: Some(course),
                title: "Scheduler design",
                url: "https://quanta.bits-pilani.ac.in/mod/assign/view.php?id=13",
                source_page_url: None,
                resource_type: "assignment",
                uploaded_at: None,
                published_at: None,
                modified_at: None,
                due_at: Some("2026-11-23"),
                fingerprint: "fixture",
                size_bytes: None,
                section: None,
                section_path: None,
                is_external: false,
                availability: "available",
            },
            &now,
        )
        .unwrap();
        (course, db::get_resource_by_id(&conn, resource).unwrap())
    };
    let collected = assignments::read_observation(&state, &generation, &resource)
        .await
        .unwrap();
    assert!(
        !academic::commit(
            &state,
            &generation,
            course,
            Coverage::Complete,
            AcademicBatch::Assignments(vec![collected])
        )
        .unwrap()
        .changed
    );
    let page = academic::assignments(&state, &generation, course).unwrap();
    let row = &page.records[0];
    let facts = row.details.as_ref().unwrap();
    assert_eq!(row.resource_id, Some(resource.id));
    assert_eq!(row.course_module_id, Some(13));
    assert_eq!(
        row.due,
        AcademicDate::Instant("2026-11-26T12:30:00Z".into())
    );
    assert_eq!(
        facts.effective_due,
        AcademicDate::Instant("2026-11-24T12:30:00Z".into())
    );
    assert_eq!(
        facts.base_due,
        AcademicDate::Instant("2026-11-23T12:30:00Z".into())
    );
    assert_eq!(
        facts.opening,
        AcademicDate::Instant("2026-11-20T03:30:00Z".into())
    );
    assert_eq!(facts.due_provenance, DueProvenance::Extension);
    assert_eq!(facts.cut_off, AcademicDate::Unknown);
    assert_eq!(facts.mode, SubmissionMode::Team);
    assert_eq!(facts.pending_team_confirmations, Some(1));
    assert_eq!(row.submission_status, SubmissionStatus::Submitted);
    assert_eq!(row.attempt_number, Some(1));
    assert_eq!(facts.attachments.len(), 1);
    assert_eq!(facts.attachments[0].title, "Assignment brief");
    assert_eq!(
        facts.attachments[0].url,
        format!("{QUANTA_ORIGIN}/pluginfile.php/123/mod_assign/intro/brief.pdf")
    );
    assert!(facts
        .description
        .as_deref()
        .unwrap()
        .contains("Compare two scheduler designs."));
    assert!(facts.released_feedback.is_none());
    assert!(!serde_json::to_string(row)
        .unwrap()
        .contains("Private fixture name"));

    let next = assignments::read_observation(&state, &generation, &resource)
        .await
        .unwrap();
    assert!(
        academic::commit(
            &state,
            &generation,
            course,
            Coverage::Complete,
            AcademicBatch::Assignments(vec![next])
        )
        .unwrap()
        .changed
    );
    let page = academic::assignments(&state, &generation, course).unwrap();
    let row = &page.records[0];
    let facts = row.details.as_ref().unwrap();
    assert!(matches!(row.due, AcademicDate::Ambiguous(_)));
    assert_eq!(facts.opening, AcademicDate::Unset);
    assert_eq!(row.submission_status, SubmissionStatus::Unknown);
    assert_eq!(row.attempt_number, None);
    assert_eq!(facts.pending_team_confirmations, None);
    assert_eq!(
        facts.released_feedback.as_deref(),
        Some("Released comment.")
    );

    let individual = assignments::read_observation(&state, &generation, &resource)
        .await
        .unwrap();
    assert_eq!(individual.due, AcademicDate::DateOnly("2026-11-24".into()));
    assert_eq!(individual.submission_status, SubmissionStatus::Reopened);
    assert_eq!(individual.attempt_number, Some(2));
    let facts = individual.details.unwrap();
    assert_eq!(facts.due_provenance, DueProvenance::Effective);
    assert_eq!(facts.base_due, AcademicDate::DateOnly("2026-11-28".into()));
    assert_eq!(facts.cut_off, AcademicDate::DateOnly("2026-11-29".into()));
    assert_eq!(
        facts.grading_due,
        AcademicDate::DateOnly("2026-11-30".into())
    );
    assert_eq!(facts.opening, AcademicDate::Unsupported);
    assert_eq!(facts.mode, SubmissionMode::Individual);
    assert_eq!(facts.time_limit_seconds, Some(0));

    let denied = assignments::read_observation(&state, &generation, &resource)
        .await
        .unwrap_err();
    assert_eq!(denied, crate::quanta::client::StudentReportError::Denied);
    academic::commit(
        &state,
        &generation,
        course,
        Coverage::Denied,
        AcademicBatch::Assignments(vec![]),
    )
    .unwrap();
    assert!(academic::assignments(&state, &generation, course)
        .unwrap()
        .records
        .is_empty());
    assert_eq!(state.sync.auth_state(), "authenticated");
    let due = crate::attention::due_resources(&state.conn(), &Default::default()).unwrap();
    assert_eq!(due.items[0].resource.due_at.as_deref(), Some("2026-11-23"));
    assert_eq!(
        state
            .conn()
            .query_row("SELECT COUNT(*) FROM change_events", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );

    server.server.join().unwrap();
    let requests: Vec<_> = server.requests.try_iter().collect();
    assert_eq!(requests.len(), 5);
    assert!(requests[1..]
        .iter()
        .all(|request| request.starts_with("GET /mod/assign/view.php?id=13 ")));
}

#[tokio::test]
async fn assignment_reminders_use_current_finality_and_deduplicate_attempt_and_deadline() {
    use crate::academic::{self, AcademicBatch, AcademicDate, Coverage, SubmissionStatus};
    use crate::quanta::{discover::Discovery, DiscoveredCourse, DiscoveredResource};
    use crate::sync::reconcile::{commit_scan, AssignmentReminderScope};
    use chrono::{Duration as Delta, SecondsFormat, Utc};
    use std::collections::HashSet;
    let body = include_str!("fixtures/academic/assignments/team-extension.html")
        .replace("<ul><li>Private fixture name</li></ul>", "0");
    let server = ReportServer::start(vec![
        verified_reply(),
        (200, "Content-Type: text/html\r\n".into(), body.into_bytes()),
    ]);
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    verify_and_install_session(&state, server.candidate(), None)
        .await
        .unwrap();
    let context = academic::context(&state);
    let owner = context.owner.as_ref().unwrap();
    let clock = Utc::now();
    let timestamp =
        |hours| (clock + Delta::hours(hours)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let now = timestamp(0);
    let mut discovery = Discovery {
        courses: vec![DiscoveredCourse {
            external_id: "101".into(),
            name: "Systems".into(),
            short_name: None,
            url: format!("{QUANTA_ORIGIN}/course/view.php?id=101"),
        }],
        resources: vec![DiscoveredResource {
            external_id: "fixture-13".into(),
            course_external_id: "101".into(),
            title: "Scheduler design".into(),
            url: format!("{QUANTA_ORIGIN}/mod/assign/view.php?id=13"),
            resource_type: "assignment".into(),
            due_at: Some(timestamp(2)),
            available: true,
            ..Default::default()
        }],
        successful_courses: HashSet::from(["101".into()]),
        courses_scanned: 1,
        ..Default::default()
    };
    let scan = |discovery: &Discovery, baseline, auth: Option<&str>| {
        let scan_time = db::now_rfc3339();
        let authority = state.sync.academic.lock().unwrap();
        let scope = auth
            .and_then(|generation| authority.reminder_owner(generation))
            .map(|owner| AssignmentReminderScope {
                owner,
                max_age: Delta::minutes(60),
            });
        let conn = state.conn();
        let scan_id = db::start_scan(&conn, &scan_time).unwrap();
        assert!(
            commit_scan(
                &conn,
                scan_id,
                discovery,
                baseline,
                0,
                0,
                &HashSet::new(),
                24,
                &scan_time,
                scope
            )
            .committed
        );
    };
    scan(&discovery, true, None);
    let resource = db::get_resource(&state.conn(), "fixture-13").unwrap();
    let course = resource.course_id.unwrap();
    let mut row = crate::assignments::read_observation(&state, &context.generation, &resource)
        .await
        .unwrap();
    row.source.observed_at = now.clone();
    row.due = AcademicDate::Instant(timestamp(3));
    let reminders = || {
        state
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM change_events WHERE title LIKE 'Deadline approaching:%'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
    };
    let commit = |row: &academic::AssignmentObservation| {
        academic::commit(
            &state,
            &context.generation,
            course,
            Coverage::Complete,
            AcademicBatch::Assignments(vec![row.clone()]),
        )
        .unwrap()
    };
    commit(&row);
    scan(&discovery, false, Some(context.generation.as_str()));
    assert_eq!(reminders(), 0);
    row.details.as_mut().unwrap().pending_team_confirmations = Some(1);
    commit(&row);
    scan(&discovery, false, Some(context.generation.as_str()));
    scan(&discovery, false, Some(context.generation.as_str()));
    assert_eq!(reminders(), 1);
    row.details.as_mut().unwrap().pending_team_confirmations = Some(0);
    row.submission_status = SubmissionStatus::Reopened;
    row.attempt_number = Some(2);
    commit(&row);
    scan(&discovery, false, Some(context.generation.as_str()));
    assert_eq!(reminders(), 2);
    row.due = AcademicDate::Instant(timestamp(4));
    commit(&row);
    scan(&discovery, false, Some(context.generation.as_str()));
    assert_eq!(reminders(), 3);

    row.submission_status = SubmissionStatus::Submitted;
    row.source.observed_at = timestamp(-2);
    row.attempt_number = None;
    commit(&row);
    scan(&discovery, false, Some(context.generation.as_str()));
    assert_eq!(
        reminders(),
        4,
        "stale finality leaves the material reminder active"
    );
    row.source.observed_at = now.clone();
    row.attempt_number = Some(2);
    commit(&row);
    discovery.resources[0].due_at = Some(timestamp(5));
    scan(&discovery, false, Some("previous generation"));
    assert_eq!(
        reminders(),
        5,
        "an earlier generation cannot suppress this reminder"
    );

    state
        .conn()
        .execute(
            "UPDATE academic_assignments SET details = 'invalid' WHERE owner_id = ?1",
            [owner.moodle_user_id],
        )
        .unwrap();
    discovery.resources[0].due_at = Some(timestamp(6));
    scan(&discovery, false, Some(context.generation.as_str()));
    assert_eq!(
        reminders(),
        6,
        "private read failure cannot block material reconciliation"
    );
    server.server.join().unwrap();
}

#[tokio::test]
async fn assignment_revision_nine_observation_remains_readable_after_upgrade() {
    use crate::academic::{self, AcademicBatch, AssignmentObservation, Coverage};
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let server = ReportServer::start(vec![verified_reply()]);
    verify_and_install_session(&state, server.candidate(), None)
        .await
        .unwrap();
    server.server.join().unwrap();

    let generation = academic::context(&state).generation;
    let row = AssignmentObservation::synthetic("assign:13", "Existing assignment");
    academic::commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![row.clone()]),
    )
    .unwrap();
    {
        let conn = state.conn();
        conn.execute_batch("ALTER TABLE academic_assignments DROP COLUMN details;")
            .unwrap();
        db::set_kv(&conn, db::SCHEMA_REVISION_KEY, "9").unwrap();
        db::set_kv(&conn, db::LAST_APP_VERSION_KEY, env!("CARGO_PKG_VERSION")).unwrap();
        db::upgrade(&conn, &state.db_path, env!("CARGO_PKG_VERSION")).unwrap();
        db::upgrade(&conn, &state.db_path, env!("CARGO_PKG_VERSION")).unwrap();
        assert_eq!(
            std::fs::read_dir(data.path().join("backups"))
                .unwrap()
                .count(),
            1
        );
    }
    let page = academic::assignments(&state, &generation, 101).unwrap();
    assert!(page.coverage.unwrap().baseline_established);
    assert_eq!(page.records, vec![row.clone()]);
    assert!(
        !academic::commit(
            &state,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Assignments(vec![row])
        )
        .unwrap()
        .changed
    );
}

use crate::quanta::client::QUANTA_ORIGIN;
// Local academic behavior through verified auth, AppState and real file SQLite.
#[tokio::test]
async fn academic_owner_logout_late_commit_and_same_owner_reconnect() {
    use crate::academic::{self, AcademicBatch, AssignmentObservation, Coverage};
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    assert!(academic::context(&state).owner.is_none());
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let a = academic::context(&state);
    assert_eq!(a.owner.as_ref().unwrap().moodle_user_id, 4242);
    let observation = AssignmentObservation::synthetic("assignment-1", "Private draft");
    let committed = academic::commit(
        &state,
        &a.generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![observation.clone()]),
    )
    .unwrap();
    assert!(!committed.changed, "first successful baseline is quiet");
    assert_eq!(
        academic::assignments(&state, &a.generation, 101)
            .unwrap()
            .records,
        vec![observation.clone()]
    );
    logout(&state).unwrap();
    assert!(academic::context(&state).owner.is_none());
    assert!(academic::assignments(&state, &a.generation, 101).is_err());
    assert!(academic::commit(
        &state,
        &a.generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![])
    )
    .is_err());
    let fixture = Fixture::start(200, 1);
    let attempt = claim(&state, "same-owner-reconnect");
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("sso", "quanta-account"),
        Some(&attempt.id),
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let reconnected = academic::context(&state);
    assert_ne!(a.generation, reconnected.generation);
    assert_eq!(
        academic::assignments(&state, &reconnected.generation, 101)
            .unwrap()
            .records,
        vec![observation]
    );
    assert!(
        academic::commit(
            &state,
            &reconnected.generation,
            101,
            Coverage::Complete,
            AcademicBatch::Assignments(vec![])
        )
        .unwrap()
        .changed
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logout_rejects_delayed_password_verification_and_private_publication() {
    use crate::academic::{self, AcademicBatch, AssignmentObservation, Coverage};
    let data = tempfile::tempdir().unwrap();
    let state = Arc::new(state(&data));
    let a = Fixture::start(200, 1);
    a.release.send(()).unwrap();
    verify_and_install_session(&state, a.candidate("password", "a@example.invalid"), None)
        .await
        .unwrap();
    a.server.join().unwrap();
    let before = academic::context(&state);
    let committed = academic::commit(
        &state,
        &before.generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![AssignmentObservation::synthetic("a", "A private")]),
    )
    .unwrap();
    let delayed = Fixture::start(200, 1);
    let candidate = delayed.candidate("password", "old@example.invalid");
    let work = {
        let state = state.clone();
        tokio::spawn(async move { verify_and_install_session(&state, candidate, None).await })
    };
    delayed
        .requests
        .recv_timeout(Duration::from_secs(10))
        .unwrap();
    logout(&state).unwrap();
    let b = Fixture::with_page(200, 1, VERIFIED_PAGE.replace("4242", "5252"));
    b.release.send(()).unwrap();
    verify_and_install_session(&state, b.candidate("password", "b@example.invalid"), None)
        .await
        .unwrap();
    b.server.join().unwrap();
    delayed.release.send(()).unwrap();
    assert!(work.await.unwrap().is_err());
    delayed.server.join().unwrap();
    let current = academic::context(&state);
    assert_eq!(current.owner.unwrap().moodle_user_id, 5252);
    assert!(academic::assignments(&state, &current.generation, 101)
        .unwrap()
        .records
        .is_empty());
    assert!(academic::commit(
        &state,
        &before.generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![])
    )
    .is_err());
    let published = std::sync::atomic::AtomicBool::new(false);
    assert!(academic::publish_if_current(&state, &committed, || {
        published.store(true, Ordering::SeqCst);
    })
    .is_err());
    assert!(!published.load(Ordering::SeqCst));
}

#[tokio::test]
async fn domain_failures_do_not_consume_baselines_or_enter_material_pipelines() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let material = seed_public_material(&state);
    let context = context(&state);
    let generation = &context.generation;
    let assignment = AssignmentObservation::synthetic("a", "Private draft");
    commit(
        &state,
        generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![assignment.clone()]),
    )
    .unwrap();
    for status in [
        Coverage::Partial,
        Coverage::Denied,
        Coverage::Unsupported,
        Coverage::Offline,
        Coverage::Cancelled,
        Coverage::Failed,
    ] {
        commit(
            &state,
            generation,
            101,
            status,
            AcademicBatch::Grades(vec![]),
        )
        .unwrap();
        let page = grades(&state, generation, 101).unwrap();
        assert!(!page.coverage.unwrap().baseline_established);
        assert_eq!(
            assignments(&state, generation, 101).unwrap().records,
            vec![assignment.clone()]
        );
    }
    let grade = GradeObservation {
        source: AcademicSource {
            source_id: "manual-zero".into(),
            source_url: format!("{QUANTA_ORIGIN}/grade/report/user/index.php?id=101"),
            observed_at: "2026-11-21T00:00:00Z".into(),
            visibility: Visibility::Visible,
        },
        title: "Private manual".into(),
        grade_item_id: Some(800),
        parent_source_id: Some("course-total".into()),
        item_kind: GradeKind::Item,
        display_value: Some("0 / 10".into()),
        numeric_value: Some(0.0),
        range_display: Some("0–10".into()),
        weight_display: None,
        feedback: Some("Private released feedback".into()),
        details: None,
        omitted: false,
    };
    assert!(
        !commit(
            &state,
            generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![grade.clone()])
        )
        .unwrap()
        .changed
    );
    assert_eq!(
        grades(&state, generation, 101).unwrap().records,
        vec![grade.clone()]
    );
    commit(
        &state,
        generation,
        101,
        Coverage::Offline,
        AcademicBatch::Grades(vec![]),
    )
    .unwrap();
    let stale = grades(&state, generation, 101).unwrap();
    assert!(stale.coverage.unwrap().stale);
    assert_eq!(stale.records, vec![grade.clone()]);
    commit(
        &state,
        generation,
        101,
        Coverage::Denied,
        AcademicBatch::Grades(vec![]),
    )
    .unwrap();
    assert!(grades(&state, generation, 101).unwrap().records.is_empty());
    assert!(
        commit(
            &state,
            generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![grade])
        )
        .unwrap()
        .changed
    );
    let conn = state.conn();
    assert_eq!(
        db::list_resources(&conn, &db::ResourceFilter::default()).unwrap()[0].id,
        material
    );
    assert!(db::list_history_events(&conn, 100).unwrap().is_empty());
    assert!(db::unnotified_events(&conn, 100).unwrap().is_empty());
    assert_eq!(db::queue_len(&conn), 0);
    assert!(crate::core::search::search(&conn, &state.mirror, "Private", 10).is_empty());
}

struct ReportServer {
    address: SocketAddr,
    requests: mpsc::Receiver<String>,
    server: std::thread::JoinHandle<()>,
}
impl ReportServer {
    fn start(replies: Vec<(u16, String, Vec<u8>)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (send, requests) = mpsc::channel();
        let server = std::thread::spawn(move || {
            for (status, headers, body) in replies {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    assert_eq!(socket.read(&mut byte).unwrap(), 1);
                    request.push(byte[0]);
                }
                send.send(String::from_utf8(request).unwrap()).unwrap();
                write!(socket,"HTTP/1.1 {status} Fixture\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
                // A bounded reader can close before the rest of a rejected body.
                let _ = socket.write_all(&body);
            }
        });
        Self {
            address,
            requests,
            server,
        }
    }
    fn candidate(&self) -> QuantaClient {
        QuantaClient::fixture_session_client(
            self.address,
            SessionInfo {
                email: "fixture@example.invalid".into(),
                method: "password".into(),
                user_id: None,
                fullname: None,
                session_cookie: "synthetic-original".into(),
                sesskey: None,
                acquired_at: String::new(),
            },
        )
    }
}
fn verified_reply() -> (u16, String, Vec<u8>) {
    (
        200,
        "Content-Type: text/html\r\n".into(),
        VERIFIED_PAGE.as_bytes().to_vec(),
    )
}

#[tokio::test]
async fn optional_student_report_denial_preserves_material_auth_but_login_expiry_parks_it() {
    use crate::academic;
    use crate::quanta::client::{StudentReport, StudentReportError};
    for (status, headers, body, expected, auth) in [
        (
            403,
            "Content-Type: text/html\r\n",
            "<html>Optional grades denied</html>",
            StudentReportError::Denied,
            "authenticated",
        ),
        (
            401,
            "Content-Type: text/html\r\n",
            "<html>Login required</html>",
            StudentReportError::AuthExpired,
            "expired",
        ),
        (
            302,
            "Location: /login/index.php\r\n",
            "",
            StudentReportError::AuthExpired,
            "expired",
        ),
        (
            200,
            "Content-Type: text/html\r\n",
            r#"<form id="login" action="/login/index.php"><input name="username"><input name="password" type="password"></form>"#,
            StudentReportError::AuthExpired,
            "expired",
        ),
    ] {
        let server = ReportServer::start(vec![
            verified_reply(),
            (status, headers.into(), body.as_bytes().to_vec()),
        ]);
        let data = tempfile::tempdir().unwrap();
        let state = state(&data);
        verify_and_install_session(&state, server.candidate(), None)
            .await
            .unwrap();
        let generation = academic::context(&state).generation;
        assert_eq!(
            academic::read_student_report(
                &state,
                &generation,
                StudentReport::Grades { course_id: 101 }
            )
            .await
            .unwrap_err(),
            expected
        );
        assert_eq!(state.sync.auth_state(), auth);
        server.server.join().unwrap();
        let requests: Vec<_> = server.requests.try_iter().collect();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with("GET /grade/report/user/index.php?id=101 "));
        assert!(!requests[1].contains("userid="));
    }
}

#[tokio::test]
async fn omitted_grade_and_permission_failure_do_not_resurrect_or_erase_truth() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let generation = context(&state).generation;
    let grade = GradeObservation {
        source: AcademicSource {
            source_url: format!("{QUANTA_ORIGIN}/grade/report/user/index.php?id=101"),
            ..AssignmentObservation::synthetic("manual", "unused").source
        },
        title: "Manual".into(),
        grade_item_id: Some(800),
        parent_source_id: None,
        item_kind: GradeKind::Item,
        display_value: Some("A".into()),
        numeric_value: None,
        range_display: None,
        weight_display: None,
        feedback: Some("Released".into()),
        details: None,
        omitted: false,
    };
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![grade.clone()]),
    )
    .unwrap();
    assert!(
        !commit(
            &state,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![])
        )
        .unwrap()
        .changed
    );
    assert_eq!(
        grades(&state, &generation, 101).unwrap().records,
        vec![GradeObservation { omitted: true, ..grade.clone() }]
    );
    commit(
        &state,
        &generation,
        101,
        Coverage::Denied,
        AcademicBatch::Grades(vec![]),
    )
    .unwrap();
    commit(
        &state,
        &generation,
        101,
        Coverage::Offline,
        AcademicBatch::Grades(vec![]),
    )
    .unwrap();
    assert!(
        grades(&state, &generation, 101).unwrap().records.is_empty(),
        "failure cannot restore permission after confirmed denial"
    );
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![]),
    )
    .unwrap();
    assert!(
        grades(&state, &generation, 101)
            .unwrap()
            .records
            .iter()
            .all(|r| r.display_value.is_none() && r.feedback.is_none()),
        "empty report cannot restore formerly restricted values"
    );
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![grade]),
    )
    .unwrap();
    assert_eq!(
        grades(&state, &generation, 101).unwrap().records[0]
            .display_value
            .as_deref(),
        Some("A")
    );
}

#[tokio::test]
async fn student_report_transport_rejects_unsafe_redirects_binaries_and_decoded_overflow() {
    use crate::academic;
    use crate::quanta::client::{StudentReport, StudentReportError};
    for location in [
        "https://outside.invalid/report",
        "/grade/report/grader/index.php?id=101",
        "/grade/report/user/index.php?id=101&userid=0",
        "/mod/assign/view.php?id=13&action=editsubmission",
        "/mod/attendance/attendance.php?sessid=7",
        "/lib/ajax/service.php?method=tool_mobile_get_content",
    ] {
        let server = ReportServer::start(vec![
            verified_reply(),
            (302, format!("Location: {location}\r\n"), vec![]),
        ]);
        let data = tempfile::tempdir().unwrap();
        let state = state(&data);
        verify_and_install_session(&state, server.candidate(), None)
            .await
            .unwrap();
        assert_eq!(
            academic::read_student_report(
                &state,
                &academic::context(&state).generation,
                StudentReport::Grades { course_id: 101 }
            )
            .await
            .unwrap_err(),
            StudentReportError::UnsafeRoute
        );
        server.server.join().unwrap();
        assert_eq!(server.requests.try_iter().count(), 2);
        assert_eq!(state.sync.auth_state(), "authenticated");
    }
    for (status, headers, body, error) in [
        (
            200,
            "Content-Type: application/pdf\r\n",
            b"%PDF synthetic".to_vec(),
            StudentReportError::Unsupported,
        ),
        (
            500,
            "Content-Type: text/html\r\n",
            b"server unavailable".to_vec(),
            StudentReportError::Unavailable,
        ),
        (
            404,
            "Content-Type: text/html\r\n",
            b"unsupported".to_vec(),
            StudentReportError::Unsupported,
        ),
        (
            200,
            "Content-Type: text/html\r\nContent-Encoding: gzip\r\n",
            include_bytes!("fixtures/academic/oversized.html.gz").to_vec(),
            StudentReportError::TooLarge,
        ),
    ] {
        let server = ReportServer::start(vec![verified_reply(), (status, headers.into(), body)]);
        let data = tempfile::tempdir().unwrap();
        let state = state(&data);
        verify_and_install_session(&state, server.candidate(), None)
            .await
            .unwrap();
        assert_eq!(
            academic::read_student_report(
                &state,
                &academic::context(&state).generation,
                StudentReport::Grades { course_id: 101 }
            )
            .await
            .unwrap_err(),
            error
        );
        server.server.join().unwrap();
        assert_eq!(server.requests.try_iter().count(), 2);
    }
}

#[tokio::test]
async fn own_report_transport_does_not_crawl_action_links_and_redirects_have_a_fixed_budget() {
    use crate::academic;
    use crate::quanta::client::{StudentReport, StudentReportError};
    let html = r#"<html><a href="/mod/attendance/attendance.php?sessid=7">Mark</a><a href="/mod/assign/view.php?id=13&action=submit">Submit</a><a href="/grade/report/grader/index.php?id=101">Staff</a></html>"#;
    for (report, route) in [
        (
            StudentReport::Assignment {
                course_module_id: 13,
            },
            "/mod/assign/view.php?id=13",
        ),
        (
            StudentReport::Attendance {
                course_module_id: 29,
            },
            "/mod/attendance/view.php?id=29",
        ),
    ] {
        let server = ReportServer::start(vec![
            verified_reply(),
            (
                200,
                "Content-Type: text/html\r\n".into(),
                html.as_bytes().to_vec(),
            ),
        ]);
        let data = tempfile::tempdir().unwrap();
        let state = state(&data);
        verify_and_install_session(&state, server.candidate(), None)
            .await
            .unwrap();
        let fetched =
            academic::read_student_report(&state, &academic::context(&state).generation, report)
                .await
                .unwrap();
        assert_eq!(fetched.body, html);
        server.server.join().unwrap();
        let requests: Vec<_> = server.requests.try_iter().collect();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with(&format!("GET {route} ")));
        assert!(!requests[1].contains("studentid="));
    }
    let mut replies = vec![verified_reply()];
    for _ in 0..4 {
        replies.push((
            302,
            "Location: /grade/report/user/index.php?id=101\r\n".into(),
            vec![],
        ));
    }
    let server = ReportServer::start(replies);
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    verify_and_install_session(&state, server.candidate(), None)
        .await
        .unwrap();
    assert_eq!(
        academic::read_student_report(
            &state,
            &academic::context(&state).generation,
            StudentReport::Grades { course_id: 101 }
        )
        .await
        .unwrap_err(),
        StudentReportError::UnsafeRoute
    );
    server.server.join().unwrap();
    assert_eq!(server.requests.try_iter().count(), 5);
}

#[tokio::test]
async fn attendance_scopes_dates_hidden_grades_and_restart_keep_typed_private_partitions() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let generation = context(&state).generation;
    let mut source = AssignmentObservation::synthetic("lab-report", "unused").source;
    source.source_url = format!("{QUANTA_ORIGIN}/mod/attendance/view.php?id=59");
    let lab = AttendanceObservation {
        source,
        course_module_id: Some(59),
        activity_instance_id: 29,
        session_id: None,
        scope_display: "Lab: November 2026, page 1/2".into(),
        status_display: Some("Excused custom".into()),
        points_display: Some("2".into()),
        maximum_display: Some("3".into()),
        summary_display: Some("Source points 2/3; partial month".into()),
        details: None,
    };
    assert!(
        !commit(
            &state,
            &generation,
            101,
            Coverage::Partial,
            AcademicBatch::Attendance(vec![lab.clone()])
        )
        .unwrap()
        .changed
    );
    assert!(attendance(&state, &generation, 101)
        .unwrap()
        .records
        .is_empty());
    assert!(
        !commit(
            &state,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Attendance(vec![lab.clone()])
        )
        .unwrap()
        .changed
    );
    let first = attendance(&state, &generation, 101).unwrap();
    assert_eq!(first.records, vec![lab.clone()]);
    assert!(first.coverage.unwrap().last_successful_at.is_some());
    // Scope IDs come from supported source facts; a separate activity never overwrites the lab.
    let mut lecture = lab.clone();
    lecture.source.source_id = "lecture-report".into();
    lecture.activity_instance_id = 30;
    lecture.scope_display = "Lecture: term summary".into();
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Attendance(vec![lecture]),
    )
    .unwrap();
    assert_eq!(
        attendance(&state, &generation, 101).unwrap().records.len(),
        2
    );
    let mut assignment = AssignmentObservation::synthetic("date-only", "Due date");
    assignment.due = AcademicDate::DateOnly("2026-12-01".into());
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![assignment.clone()]),
    )
    .unwrap();
    assert_eq!(
        assignments(&state, &generation, 101).unwrap().records[0].due,
        AcademicDate::DateOnly("2026-12-01".into())
    );
    let mut ambiguous = assignment.clone();
    ambiguous.due = AcademicDate::Ambiguous("01/12/26 5 PM".into());
    commit(
        &state,
        &generation,
        102,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![ambiguous]),
    )
    .unwrap();
    let hidden = GradeObservation {
        source: AcademicSource {
            source_url: format!("{QUANTA_ORIGIN}/grade/report/user/index.php?id=101"),
            visibility: Visibility::Hidden,
            ..assignment.source.clone()
        },
        title: "Restricted item".into(),
        grade_item_id: Some(800),
        parent_source_id: None,
        item_kind: GradeKind::Item,
        display_value: Some("SECRET".into()),
        numeric_value: Some(42.0),
        range_display: None,
        weight_display: None,
        feedback: Some("SECRET feedback".into()),
        details: None,
        omitted: false,
    };
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![hidden]),
    )
    .unwrap();
    let hidden = grades(&state, &generation, 101).unwrap();
    assert_eq!(hidden.records[0].source.visibility, Visibility::Hidden);
    assert!(hidden.records[0].display_value.is_none());
    assert!(hidden.records[0].feedback.is_none());
    let old = state;
    drop(old);
    let restarted = super_state_for_restart(&data);
    assert!(context(&restarted).owner.is_none());
    assert!(assignments(&restarted, &generation, 101).is_err());
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &restarted,
        fixture.candidate("password", "renamed@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let current = context(&restarted);
    assert_ne!(current.generation, generation);
    assert_eq!(
        assignments(&restarted, &current.generation, 101)
            .unwrap()
            .records,
        vec![assignment]
    );
    assert_eq!(
        attendance(&restarted, &current.generation, 101)
            .unwrap()
            .records
            .len(),
        2
    );
    assert!(
        !commit(
            &restarted,
            &current.generation,
            101,
            Coverage::Complete,
            AcademicBatch::Attendance(vec![lab])
        )
        .unwrap()
        .changed
    );
}

fn super_state_for_restart(data: &tempfile::TempDir) -> AppState {
    state(data)
}

fn synthetic_grade(id: &str) -> crate::academic::GradeObservation {
    use crate::academic::*;
    GradeObservation {
        source: AcademicSource {
            source_url: format!("{QUANTA_ORIGIN}/grade/report/user/index.php?id=101"),
            ..AssignmentObservation::synthetic(id, "unused").source
        },
        title: "Synthetic manual grade".into(),
        grade_item_id: Some(800),
        parent_source_id: None,
        item_kind: GradeKind::Item,
        display_value: Some("0".into()),
        numeric_value: Some(0.0),
        range_display: Some("0–10".into()),
        weight_display: None,
        feedback: Some("Synthetic private feedback".into()),
        details: None,
        omitted: false,
    }
}

#[tokio::test]
async fn academic_write_and_commit_failure_roll_back_values_and_first_success_baseline() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let generation = context(&state).generation;
    state.conn().execute_batch("CREATE TRIGGER reject_coverage BEFORE INSERT ON academic_coverage BEGIN SELECT RAISE(ABORT,'private values must not be included in returned errors'); END;").unwrap();
    assert_eq!(
        commit(
            &state,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![synthetic_grade("g")])
        )
        .unwrap_err(),
        "Academic storage unavailable"
    );
    let page = grades(&state, &generation, 101).unwrap();
    assert!(page.coverage.is_none());
    assert!(page.records.is_empty());
    state.conn().execute_batch("DROP TRIGGER reject_coverage; CREATE TABLE commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_child(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER reject_commit AFTER INSERT ON academic_grades BEGIN INSERT INTO commit_child VALUES (999); END;").unwrap();
    assert!(commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![synthetic_grade("g")])
    )
    .is_err());
    let page = grades(&state, &generation, 101).unwrap();
    assert!(page.coverage.is_none());
    assert!(page.records.is_empty());
    state
        .conn()
        .execute_batch("DROP TRIGGER reject_commit;")
        .unwrap();
    assert!(
        !commit(
            &state,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![synthetic_grade("g")])
        )
        .unwrap()
        .changed
    );
    let before = grades(&state, &generation, 101).unwrap();
    state.conn().execute_batch("CREATE TRIGGER reject_value BEFORE INSERT ON academic_grades BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;").unwrap();
    let mut changed = synthetic_grade("g");
    changed.display_value = Some("10".into());
    changed.numeric_value = Some(10.0);
    assert!(commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![changed])
    )
    .is_err());
    assert_eq!(
        grades(&state, &generation, 101).unwrap().records,
        before.records
    );
    assert_eq!(
        grades(&state, &generation, 101)
            .unwrap()
            .coverage
            .unwrap()
            .last_successful_at,
        before.coverage.unwrap().last_successful_at
    );
    state
        .conn()
        .execute_batch("DROP TRIGGER reject_value; DROP TABLE academic_grades;")
        .unwrap();
    assert!(grades(&state, &generation, 101).is_err());
    assert!(assignments(&state, &generation, 101)
        .unwrap()
        .records
        .is_empty());
}

#[tokio::test]
async fn populated_owner_backup_restore_keeps_partitions_without_authentication_or_auto_adoption() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let generation = context(&state).generation;
    let grade = synthetic_grade("g");
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![grade.clone()]),
    )
    .unwrap();
    db::upgrade(&state.conn(), &state.db_path, "0.4.1").unwrap();
    let backup = std::fs::read_dir(data.path().join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let restored_dir = tempfile::tempdir().unwrap();
    std::fs::copy(backup, restored_dir.path().join("session-proof.sqlite")).unwrap();
    let restored = super_state_for_restart(&restored_dir);
    assert!(context(&restored).owner.is_none());
    assert!(grades(&restored, &generation, 101).is_err());
    let b = Fixture::with_page(200, 1, VERIFIED_PAGE.replace("4242", "5252"));
    b.release.send(()).unwrap();
    verify_and_install_session(
        &restored,
        b.candidate("password", "b@example.invalid"),
        None,
    )
    .await
    .unwrap();
    b.server.join().unwrap();
    let b = context(&restored);
    assert!(grades(&restored, &b.generation, 101)
        .unwrap()
        .records
        .is_empty());
    logout(&restored).unwrap();
    let a = Fixture::start(200, 1);
    a.release.send(()).unwrap();
    verify_and_install_session(
        &restored,
        a.candidate("password", "renamed@example.invalid"),
        None,
    )
    .await
    .unwrap();
    a.server.join().unwrap();
    let a = context(&restored);
    assert_eq!(
        grades(&restored, &a.generation, 101).unwrap().records,
        vec![grade.clone()]
    );
    assert!(
        !commit(
            &restored,
            &a.generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![grade])
        )
        .unwrap()
        .changed
    );
    assert!(!a.collectors_enabled);
}

#[tokio::test]
async fn absent_unverified_identity_and_failed_account_change_never_unlock_old_partition() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let a = Fixture::start(200, 1);
    a.release.send(()).unwrap();
    verify_and_install_session(&state, a.candidate("password", "a@example.invalid"), None)
        .await
        .unwrap();
    a.server.join().unwrap();
    let generation = context(&state).generation;
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![synthetic_grade("g")]),
    )
    .unwrap();
    let attempt = begin_account_change(&state);
    assert!(context(&state).owner.is_none());
    assert!(grades(&state, &generation, 101).is_err());
    let failed = Fixture::start(401, 1);
    failed.release.send(()).unwrap();
    assert!(verify_candidate_session(
        &state,
        failed.candidate("password", "b@example.invalid"),
        SessionAdmission::Generation(&attempt),
    )
    .await
    .is_err());
    failed.server.join().unwrap();
    assert!(context(&state).owner.is_none());
    let absent = Fixture::with_page(
        200,
        1,
        "<html>Authenticated, but no verified Moodle identity</html>".into(),
    );
    absent.release.send(()).unwrap();
    // The candidate deliberately contains stale user_id=7. It must not confer ownership.
    verify_and_install_session(
        &state,
        absent.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    absent.server.join().unwrap();
    let absent = context(&state);
    assert!(absent.owner.is_none());
    assert!(commit(
        &state,
        &absent.generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![synthetic_grade("g")])
    )
    .is_err());
}

fn delayed_student_report() -> (ReportServer, mpsc::Sender<()>) {
    delayed_student_report_with_body("<html>Synthetic delayed A grade</html>")
}

fn delayed_student_report_with_body(body: &'static str) -> (ReportServer, mpsc::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (send, requests) = mpsc::channel();
    let (release, gate) = mpsc::channel();
    let server = std::thread::spawn(move || {
        for index in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                assert_eq!(socket.read(&mut byte).unwrap(), 1);
                request.push(byte[0]);
            }
            send.send(String::from_utf8(request).unwrap()).unwrap();
            if index == 1 {
                gate.recv_timeout(Duration::from_secs(15)).unwrap();
            }
            let body = if index == 0 { VERIFIED_PAGE } else { body };
            let _=write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        }
    });
    (
        ReportServer {
            address,
            requests,
            server,
        },
        release,
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delayed_academic_http_cancels_and_drains_on_logout_or_reset_before_b_can_read_or_publish()
{
    use crate::academic::*;
    use crate::quanta::client::{StudentReport, StudentReportError};
    for reset in [false, true] {
        let data = tempfile::tempdir().unwrap();
        let state = Arc::new(state(&data));
        let (server, release) = delayed_student_report();
        verify_and_install_session(&state, server.candidate(), None)
            .await
            .unwrap();
        server
            .requests
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        let old = context(&state);
        let generation = old.generation.clone();
        let committed = commit(
            &state,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![synthetic_grade("g")]),
        )
        .unwrap();
        let work = {
            let state = state.clone();
            let generation = generation.clone();
            tokio::spawn(async move {
                read_student_report(
                    &state,
                    &generation,
                    StudentReport::Grades { course_id: 101 },
                )
                .await
            })
        };
        let request = server
            .requests
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        assert!(request.starts_with("GET /grade/report/user/index.php?id=101 "));
        if reset {
            state.sync.auth_resetting.store(true, Ordering::SeqCst);
            begin_account_change(&state); // production admission before reset drain
            assert!(matches!(
                read_student_report(
                    &state,
                    &generation,
                    StudentReport::Grades { course_id: 101 }
                )
                .await,
                Err(StudentReportError::SessionChanged)
            ));
        } else {
            logout(&state).unwrap();
        }
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), work)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            StudentReportError::SessionChanged
        );
        assert!(wait_for_quanta_work_to_stop(&state).await);
        state.sync.auth_resetting.store(false, Ordering::SeqCst);
        let b = Fixture::with_page(200, 1, VERIFIED_PAGE.replace("4242", "5252"));
        b.release.send(()).unwrap();
        verify_and_install_session(&state, b.candidate("password", "b@example.invalid"), None)
            .await
            .unwrap();
        b.server.join().unwrap();
        release.send(()).unwrap();
        server.server.join().unwrap();
        let b = context(&state);
        assert!(grades(&state, &b.generation, 101)
            .unwrap()
            .records
            .is_empty());
        assert!(commit(
            &state,
            &generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![synthetic_grade("late")])
        )
        .is_err());
        assert!(
            publish_if_current(&state, &committed, || panic!("stale event was published")).is_err()
        );
    }
}

#[tokio::test]
async fn academic_dates_normalize_only_qualified_instants_and_reject_invalid_observations() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let generation = context(&state).generation;
    let mut assignment = AssignmentObservation::synthetic("instant", "Qualified due");
    assignment.due = AcademicDate::Instant("2026-12-01T17:00:00+05:30".into());
    assignment.due_display = Some("1 December, 5 PM IST".into());
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![assignment.clone()]),
    )
    .unwrap();
    let read = assignments(&state, &generation, 101).unwrap();
    assert_eq!(
        read.records[0].due,
        AcademicDate::Instant("2026-12-01T11:30:00Z".into())
    );
    assert_eq!(
        read.records[0].due_display.as_deref(),
        Some("1 December, 5 PM IST")
    );
    assignment.due = AcademicDate::Instant("01/12/26 17:00".into());
    assert!(commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![assignment.clone()])
    )
    .is_err());
    assignment.due = AcademicDate::DateOnly("2026-02-30".into());
    assert!(commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![assignment.clone()])
    )
    .is_err());
    assignment.source.source_url =
        format!("{QUANTA_ORIGIN}/mod/assign/view.php?id=13&action=submit");
    assert!(commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Assignments(vec![assignment])
    )
    .is_err());
    let mut grade = synthetic_grade("nan");
    grade.numeric_value = Some(f64::NAN);
    assert!(commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![grade])
    )
    .is_err());
    let json = serde_json::to_value(read).unwrap();
    assert_eq!(json["context"]["contractVersion"], 1);
    assert_eq!(json["context"]["owner"]["moodleUserId"], 4242);
    assert_eq!(json["records"][0]["courseModuleId"], 13);
    assert_eq!(json["coverage"]["permission"], "permitted");
    assert!(json["coverage"]["lastSuccessfulAt"].is_string());
    assert!(json["coverage"]["reason"].is_null());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn student_report_admission_bounds_concurrency_without_extra_requests() {
    use crate::academic::*;
    use crate::quanta::client::StudentReport;
    let data = tempfile::tempdir().unwrap();
    let state = Arc::new(state(&data));
    let (server, release) = delayed_student_report();
    verify_and_install_session(&state, server.candidate(), None)
        .await
        .unwrap();
    server
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    let generation = context(&state).generation;
    let pending = {
        let state = state.clone();
        let generation = generation.clone();
        tokio::spawn(async move {
            read_student_report(
                &state,
                &generation,
                StudentReport::Grades { course_id: 101 },
            )
            .await
        })
    };
    server
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    let second = tokio::time::timeout(
        Duration::from_millis(250),
        read_student_report(
            &state,
            &generation,
            StudentReport::Grades { course_id: 101 },
        ),
    )
    .await;
    release.send(()).unwrap();
    assert!(pending.await.unwrap().is_ok());
    server.server.join().unwrap();
    assert!(second
        .expect("concurrent request must be rejected promptly")
        .is_err());
    assert_eq!(server.requests.try_iter().count(), 0);
}

#[tokio::test]
async fn report_total_timeout_is_bounded_and_returns_no_success_or_baseline() {
    use crate::academic::*;
    use crate::quanta::client::{StudentReport, StudentReportError};
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let (server, release) = delayed_student_report();
    verify_and_install_session(&state, server.candidate(), None)
        .await
        .unwrap();
    let generation = context(&state).generation;
    let result = tokio::time::timeout(
        Duration::from_secs(12),
        read_student_report(
            &state,
            &generation,
            StudentReport::Grades { course_id: 101 },
        ),
    )
    .await
    .unwrap();
    release.send(()).unwrap();
    server.server.join().unwrap();
    assert_eq!(result.unwrap_err(), StudentReportError::Unavailable);
    assert!(grades(&state, &generation, 101).unwrap().coverage.is_none());
}

#[tokio::test]
async fn failed_backup_preserves_real_owner_values_and_baseline() {
    use crate::academic::*;
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 1);
    fixture.release.send(()).unwrap();
    verify_and_install_session(
        &state,
        fixture.candidate("password", "a@example.invalid"),
        None,
    )
    .await
    .unwrap();
    fixture.server.join().unwrap();
    let generation = context(&state).generation;
    let grade = synthetic_grade("private");
    commit(
        &state,
        &generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![grade.clone()]),
    )
    .unwrap();
    std::fs::write(data.path().join("backups"), "not a directory").unwrap();
    assert!(db::upgrade(&state.conn(), &state.db_path, "0.4.1")
        .unwrap_err()
        .contains("backup"));
    assert_eq!(
        grades(&state, &generation, 101).unwrap().records,
        vec![grade]
    );
    assert!(
        grades(&state, &generation, 101)
            .unwrap()
            .coverage
            .unwrap()
            .baseline_established
    );
    assert_eq!(
        db::get_kv(&state.conn(), db::LAST_APP_VERSION_KEY).as_deref(),
        Some("0.4.0")
    );
}

#[tokio::test]
async fn verification_redirect_official_origin_cannot_confer_academic_ownership() {
    use crate::academic::*;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        for index in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                assert_eq!(socket.read(&mut byte).unwrap(), 1);
                request.push(byte[0]);
            }
            if index == 0 {
                write!(socket,"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{}/my/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",address.port()).unwrap();
            } else {
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{VERIFIED_PAGE}",VERIFIED_PAGE.len()).unwrap();
            }
        }
    });
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    verify_and_install_session(&state, QuantaClient::fixture_client(address), None)
        .await
        .unwrap();
    server.join().unwrap();
    let context = context(&state);
    assert!(context.owner.is_none());
    assert!(commit(
        &state,
        &context.generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![synthetic_grade("g")])
    )
    .is_err());
}

fn seed_public_material(state: &AppState) -> i64 {
    let conn = state.conn();
    let course = db::upsert_course(
        &conn,
        "public-course",
        "Public course",
        None,
        "https://quanta.bits-pilani.ac.in/course/view.php?id=101",
        "2026-11-21T00:00:00Z",
    )
    .unwrap();
    db::upsert_resource(
        &conn,
        &db::ResourceWrite {
            external_id: "mod:public-file",
            course_id: Some(course),
            title: "Public material",
            url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=77",
            source_page_url: None,
            resource_type: "file",
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            fingerprint: "public-fingerprint",
            size_bytes: None,
            section: None,
            section_path: None,
            is_external: false,
            availability: "available",
        },
        "2026-11-21T00:00:00Z",
    )
    .unwrap()
}

#[tokio::test]
async fn existing_session_reverification_rotates_generation_and_preserves_shared_cookie_transport()
{
    use crate::academic::*;
    let server=ReportServer::start(vec![verified_reply(),(200,"Content-Type: text/html\r\nSet-Cookie: MoodleSession=synthetic-reconnected; Path=/; HttpOnly\r\n".into(),VERIFIED_PAGE.as_bytes().to_vec()),(200,"Content-Type: text/html\r\n".into(),b"<html>next request</html>".to_vec())]);
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    verify_and_install_session(&state, server.candidate(), None)
        .await
        .unwrap();
    let before = context(&state);
    let grade = synthetic_grade("reconnect");
    commit(
        &state,
        &before.generation,
        101,
        Coverage::Complete,
        AcademicBatch::Grades(vec![grade.clone()]),
    )
    .unwrap();
    state.sync.set_auth_state("expired");
    assert!(
        grades(&state, &before.generation, 101)
            .unwrap()
            .coverage
            .unwrap()
            .stale
    );
    let candidate = state.client().unwrap().verification_candidate();
    verify_candidate_session(
        &state,
        candidate,
        SessionAdmission::Generation(&before.generation),
    )
    .await
    .unwrap();
    let after = context(&state);
    assert_ne!(before.generation, after.generation);
    assert_eq!(before.owner, after.owner);
    assert_eq!(
        grades(&state, &after.generation, 101).unwrap().records,
        vec![grade.clone()]
    );
    assert!(
        !commit(
            &state,
            &after.generation,
            101,
            Coverage::Complete,
            AcademicBatch::Grades(vec![grade])
        )
        .unwrap()
        .changed
    );
    let client = state.client().unwrap();
    assert_eq!(client.session.session_cookie, "synthetic-reconnected");
    client
        .fetch(&client.origin().join("/next").unwrap())
        .await
        .unwrap();
    server.server.join().unwrap();
    let requests: Vec<_> = server.requests.try_iter().collect();
    assert_cookie(&requests[2], "MoodleSession=synthetic-reconnected");
}

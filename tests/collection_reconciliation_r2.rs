//! Behavior proof at the production HTTP collection -> SQLite commit seam.
use crate::{
    db,
    quanta::{
        client::QuantaClient,
        discover::{self, CrawlLimits},
    },
    sync::reconcile as engine,
};
use std::{
    collections::HashSet,
    io::{Read, Write},
    net::TcpListener,
    sync::{atomic::AtomicBool, Arc, Mutex},
    thread,
};

fn path(url: &str) -> String {
    let url = url::Url::parse(url).unwrap();
    format!(
        "{}{}",
        url.path(),
        url.query().map(|q| format!("?{q}")).unwrap_or_default()
    )
}

fn collect(routes: Vec<(&'static str, u16, &'static str)>) -> (discover::Discovery, Vec<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    // Nonblocking loop terminates when production returns; a regression cannot
    // hang the suite by making fewer requests than the fixture anticipated.
    listener.set_nonblocking(true).unwrap();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = requests.clone();
    let (stop, stopped) = std::sync::mpsc::channel();
    let server = thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut buf = [0; 8192];
                let n = stream.read(&mut buf).unwrap();
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request
                    .lines()
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .nth(1)
                    .unwrap();
                recorded.lock().unwrap().push(path.to_string());
                let (_, status, body) = routes
                    .iter()
                    .find(|(route, _, _)| *route == path)
                    .unwrap_or_else(|| panic!("unexpected request {path}"));
                let kind = if body.starts_with("%PDF") {
                    "application/pdf"
                } else {
                    "text/html"
                };
                write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if stopped
                    .recv_timeout(std::time::Duration::from_millis(2))
                    .is_ok()
                {
                    break;
                }
            }
            Err(e) => panic!("fixture accept: {e}"),
        }
    });
    let discovery = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(discover::discover_all(
            Arc::new(QuantaClient::fixture_client(addr)),
            CrawlLimits {
                concurrency: 1,
                ..CrawlLimits::default()
            },
            Arc::new(AtomicBool::new(false)),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
        ));
    let _ = stop.send(());
    server.join().unwrap();
    let requests = requests.lock().unwrap().clone();
    (discovery, requests)
}

const DASH: &str = r#"<a href="/course/view.php?id=10">Course Ten</a>"#;
const MATERIALS: &str = r#"<li class="section main"><h3 class="sectionname">Week 1</h3>
<div class="activity"><a href="/mod/resource/view.php?id=42">Slides</a></div>
<div class="activity"><a href="/mod/folder/view.php?id=43">Readings</a></div>
<div class="activity"><a href="/mod/forum/view.php?id=44">Announcements</a></div></li>"#;

fn commit(
    conn: &rusqlite::Connection,
    found: &discover::Discovery,
    baseline: bool,
) -> engine::ReconcileResult {
    engine::commit_scan(
        conn,
        found,
        baseline,
        0,
        0,
        &HashSet::new(),
        24,
        "2026-11-21T12:00:00Z",
        None,
    )
}

#[test]
fn positive_material_enrichment_folder_replacement_and_announcements_persist_stable_context() {
    let (found, mut requests) = collect(vec![
        ("/my/", 200, DASH),
        ("/course/view.php?id=10", 200, MATERIALS),
        (
            "/mod/resource/view.php?id=42",
            200,
            r#"<div class="file"><a href="/pluginfile.php/42/slides.pdf">slides.pdf</a><span class="filesize">2 MB</span></div>"#,
        ),
        (
            "/mod/folder/view.php?id=43",
            200,
            r#"<a href="/pluginfile.php/43/a.pdf">a.pdf</a><a href="/pluginfile.php/43/b.pdf">b.pdf</a>"#,
        ),
        (
            "/mod/forum/view.php?id=44",
            200,
            r#"<table><tr class="discussion"><td><a href="/mod/forum/discuss.php?d=55">Exam schedule</a></td><td><time datetime="2026-11-20T09:00:00Z">Today</time></td></tr></table>"#,
        ),
    ]);
    requests.sort();
    assert_eq!(
        requests,
        vec![
            "/course/view.php?id=10",
            "/mod/folder/view.php?id=43",
            "/mod/forum/view.php?id=44",
            "/mod/resource/view.php?id=42",
            "/my/"
        ]
    );
    assert!(found.errors.is_empty(), "{:?}", found.errors);
    assert_eq!(found.successful_courses, HashSet::from(["10".into()]));
    assert_eq!(found.resources.len(), 4);
    let slides = found
        .resources
        .iter()
        .find(|r| r.external_id == "mod:resource:42")
        .unwrap();
    assert_eq!(slides.title, "Slides");
    assert_eq!(path(&slides.url), "/pluginfile.php/42/slides.pdf");
    assert_eq!(slides.resource_type, "pdf");
    assert_eq!(slides.size_bytes, Some(2 * 1024 * 1024));
    assert_eq!(
        slides.source_page_url.as_deref().map(path).as_deref(),
        Some("/course/view.php?id=10")
    );
    assert_eq!(slides.section_path, ["Week 1"]);
    for name in ["a.pdf", "b.pdf"] {
        let child = found.resources.iter().find(|r| r.title == name).unwrap();
        assert_eq!(child.section_path, ["Week 1", "Readings"]);
        assert_eq!(
            child.source_page_url.as_deref().map(path).as_deref(),
            Some("/mod/folder/view.php?id=43")
        );
    }
    assert!(!found
        .resources
        .iter()
        .any(|r| ["mod:folder:43", "mod:forum:44"].contains(&r.external_id.as_str())));
    let announcement = found
        .resources
        .iter()
        .find(|r| r.title == "Exam schedule")
        .unwrap();
    assert_eq!(announcement.resource_type, "announcement");
    assert_eq!(
        announcement.published_at.as_deref(),
        Some("2026-11-20T09:00:00+00:00")
    );
    assert_eq!(
        announcement.source_page_url.as_deref().map(path).as_deref(),
        Some("/mod/forum/view.php?id=44")
    );
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("proof.db")).unwrap();
    let baseline = commit(&conn, &found, true);
    assert!(baseline.committed, "{:?}", baseline.errors);
    assert_eq!(
        (baseline.new, baseline.updated, baseline.unavailable),
        (0, 0, 0)
    );
    let id = db::get_resource(&conn, "mod:resource:42").unwrap().id;
    assert!(commit(&conn, &found, false).committed);
    assert_eq!(db::get_resource(&conn, "mod:resource:42").unwrap().id, id);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM change_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn empty_complete_course_establishes_quiet_baseline_but_nested_failure_does_not() {
    let (partial, requests) = collect(vec![
        ("/my/", 200, DASH),
        (
            "/course/view.php?id=10",
            200,
            r#"<main id="region-main"><a href="/mod/page/view.php?id=70">Notes</a></main>"#,
        ),
        ("/mod/page/view.php?id=70", 500, "unavailable"),
    ]);
    assert_eq!(requests.len(), 3);
    assert!(!partial.errors.is_empty());
    assert!(partial.successful_courses.is_empty());
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("proof.db")).unwrap();
    assert!(commit(&conn, &partial, true).committed);
    assert!(db::get_kv(&conn, "baseline_established").is_none());
    let (empty, requests) = collect(vec![
        ("/my/", 200, DASH),
        ("/course/view.php?id=10", 200, "<main>No materials</main>"),
    ]);
    assert_eq!(requests, ["/my/", "/course/view.php?id=10"]);
    assert!(empty.errors.is_empty());
    assert_eq!(empty.successful_courses, HashSet::from(["10".into()]));
    let result = commit(&conn, &empty, true);
    assert!(result.committed);
    assert_eq!((result.new, result.updated, result.unavailable), (0, 0, 0));
    assert!(db::get_kv(&conn, "baseline_established").is_some());
}

#[test]
fn only_two_complete_absent_scans_advance_missing_and_preserve_inventory() {
    let (initial, _) = collect(vec![
        ("/my/", 200, DASH),
        (
            "/course/view.php?id=10",
            200,
            r#"<div class="activity"><a href="/mod/resource/view.php?id=42">Slides</a></div>"#,
        ),
        ("/mod/resource/view.php?id=42", 200, "details"),
    ]);
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("proof.db")).unwrap();
    assert!(commit(&conn, &initial, true).committed);
    let id = db::get_resource(&conn, "mod:resource:42").unwrap().id;
    let (empty, _) = collect(vec![
        ("/my/", 200, DASH),
        ("/course/view.php?id=10", 200, "empty"),
    ]);
    let state = || {
        conn.query_row(
            "SELECT miss_streak, availability_status FROM resources WHERE id=?1",
            [id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
        )
        .unwrap()
    };
    assert!(commit(&conn, &empty, false).committed);
    assert_eq!(state(), (1, "available".into()));
    let (partial, _) = collect(vec![
        ("/my/", 200, DASH),
        ("/course/view.php?id=10", 500, "offline"),
    ]);
    assert!(commit(&conn, &partial, false).committed);
    assert_eq!(state(), (1, "available".into()));
    let mut cancelled = empty;
    cancelled.cancelled = true;
    assert!(commit(&conn, &cancelled, false).committed);
    assert_eq!(state(), (1, "available".into()));
    cancelled.cancelled = false;
    assert!(commit(&conn, &cancelled, false).committed);
    assert_eq!(state(), (2, "unavailable".into()));
    assert_eq!(db::get_resource(&conn, "mod:resource:42").unwrap().id, id);
}

#[test]
fn nested_book_pagination_and_section_routes_deduplicate_and_keep_actual_source() {
    let (found, requests) = collect(vec![
        ("/my/", 200, DASH),
        (
            "/course/view.php?id=10",
            200,
            r#"<main id="region-main"><li class="section main"><h3 class="sectionname">Week 1</h3><a href="/mod/page/view.php?id=70">Notes</a><a href="/mod/page/view.php?id=70">Notes</a></li><a href="/course/view.php?id=10&amp;section=1">Week</a></main>"#,
        ),
        (
            "/mod/page/view.php?id=70",
            200,
            r#"<main id="region-main"><a href="/mod/book/view.php?id=71">Book</a></main>"#,
        ),
        (
            "/mod/book/view.php?id=71",
            200,
            r#"<main id="region-main"><a href="/mod/page/view.php?id=70">Cycle</a><a href="/pluginfile.php/71/notes.pdf">notes.pdf</a></main>"#,
        ),
        (
            "/course/view.php?id=10&section=1",
            200,
            r#"<li class="section main"><h3 class="sectionname">Week 1</h3><div class="activity"><a href="/mod/resource/view.php?id=42">Slides</a></div></li><nav class="pagination"><a href="/course/view.php?id=10&amp;page=1">Next</a></nav>"#,
        ),
        (
            "/course/view.php?id=10&page=1",
            200,
            r#"<li class="section main"><h3 class="sectionname">Week 1</h3><div class="activity"><a href="/mod/resource/view.php?id=42">Slides</a></div></li>"#,
        ),
        ("/mod/resource/view.php?id=42", 200, "No child files"),
        ("/pluginfile.php/71/notes.pdf", 200, "%PDF-1.7 fixture"),
    ]);
    assert!(found.errors.is_empty(), "{:?}", found.errors);
    let unique: HashSet<_> = requests.iter().collect();
    assert_eq!(
        unique.len(),
        requests.len(),
        "duplicate/cyclic requests: {requests:?}"
    );
    assert_eq!(requests.len(), 8, "{requests:?}");
    assert_eq!(found.resources.len(), 2);
    let slides = found
        .resources
        .iter()
        .find(|r| r.external_id == "mod:resource:42")
        .unwrap();
    assert_eq!(slides.section_path, ["Week 1"]);
    assert_eq!(
        slides.source_page_url.as_deref().map(path).as_deref(),
        Some("/course/view.php?id=10&section=1")
    );
    let notes = found
        .resources
        .iter()
        .find(|r| r.title == "notes.pdf")
        .unwrap();
    assert_eq!(notes.section_path, ["Week 1", "Notes", "Book"]);
    assert_eq!(
        notes.source_page_url.as_deref().map(path).as_deref(),
        Some("/mod/book/view.php?id=71")
    );
    assert_eq!(notes.resource_type, "pdf");
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("proof.db")).unwrap();
    assert!(commit(&conn, &found, true).committed);
    assert_eq!(
        db::get_resource(&conn, &notes.external_id)
            .unwrap()
            .section_path,
        ["Week 1", "Notes", "Book"]
    );
}

#[test]
fn empty_and_failed_detail_containers_survive_without_consuming_course_reset() {
    for status in [200, 500] {
        let (found, requests) = collect(vec![
            ("/my/", 200, DASH),
            ("/course/view.php?id=10", 200, MATERIALS),
            ("/mod/resource/view.php?id=42", status, "no files"),
            ("/mod/folder/view.php?id=43", status, "no files"),
            ("/mod/forum/view.php?id=44", status, "no discussions"),
        ]);
        assert_eq!(requests.len(), 5);
        assert_eq!(found.resources.len(), 3);
        assert!(found
            .resources
            .iter()
            .any(|r| r.external_id == "mod:folder:43"));
        assert!(found
            .resources
            .iter()
            .any(|r| r.external_id == "mod:forum:44"));
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open(&dir.path().join("proof.db")).unwrap();
        let cid = db::upsert_course(
            &conn,
            "10",
            "Course Ten",
            None,
            "https://quanta.bits-pilani.ac.in/course/view.php?id=10",
            "2026-11-21T00:00:00Z",
        )
        .unwrap();
        db::set_kv(&conn, "rebaseline_courses", &format!("[{cid}]")).unwrap();
        let result = engine::commit_scan(
            &conn,
            &found,
            false,
            0,
            0,
            &HashSet::from([cid]),
            24,
            "2026-11-21T12:00:00Z",
            None,
        );
        assert!(result.committed, "{:?}", result.errors);
        assert_eq!((result.new, result.updated), (0, 0));
        assert_eq!(
            db::get_kv(&conn, "rebaseline_courses").is_some(),
            status == 500
        );
    }
}

#[test]
fn miss_or_baseline_write_failure_rolls_back_observations_and_markers() {
    let (initial, _) = collect(vec![
        ("/my/", 200, DASH),
        (
            "/course/view.php?id=10",
            200,
            r#"<div class="activity"><a href="/mod/resource/view.php?id=42">Slides</a></div>"#,
        ),
        ("/mod/resource/view.php?id=42", 200, "details"),
    ]);
    let (empty, _) = collect(vec![
        ("/my/", 200, DASH),
        ("/course/view.php?id=10", 200, "empty"),
    ]);
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("proof.db")).unwrap();
    assert!(commit(&conn, &initial, true).committed);
    conn.execute_batch("CREATE TRIGGER reject_miss BEFORE UPDATE OF miss_streak ON resources BEGIN SELECT RAISE(ABORT,'miss failed'); END;").unwrap();
    let result = commit(&conn, &empty, false);
    assert!(!result.committed);
    assert_eq!((result.new, result.updated, result.unavailable), (0, 0, 0));
    assert_eq!(
        conn.query_row("SELECT miss_streak FROM resources", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    conn.execute_batch("DROP TRIGGER reject_miss; DELETE FROM resources; DELETE FROM settings WHERE key='baseline_established'; CREATE TRIGGER reject_baseline BEFORE INSERT ON settings WHEN NEW.key='baseline_established' BEGIN SELECT RAISE(ABORT,'baseline failed'); END;").unwrap();
    let result = commit(&conn, &initial, true);
    assert!(!result.committed);
    assert!(db::get_resource(&conn, "mod:resource:42").is_none());
    assert!(db::get_kv(&conn, "baseline_established").is_none());
}

#[test]
fn unreadable_previous_observation_is_a_persistence_failure_not_a_new_resource() {
    let (found, _) = collect(vec![
        ("/my/", 200, DASH),
        (
            "/course/view.php?id=10",
            200,
            r#"<div class="activity"><a href="/mod/resource/view.php?id=42">Slides</a></div>"#,
        ),
        ("/mod/resource/view.php?id=42", 200, "details"),
    ]);
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("proof.db")).unwrap();
    assert!(commit(&conn, &found, true).committed);
    // SQLite permits legacy/corrupt column types. An authoritative read error
    // must not be silently interpreted as a previously unseen resource.
    conn.execute("UPDATE resources SET content_fingerprint=x'01'", [])
        .unwrap();
    let result = commit(&conn, &found, false);
    assert!(
        !result.committed,
        "unreadable prior state cannot authorize a diff"
    );
    assert!(!result.errors.is_empty());
    assert_eq!(result.new, 0);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM change_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn rejected_deadline_reminder_does_not_report_committed_success() {
    let (found, requests) = collect(vec![
        ("/my/", 200, DASH),
        (
            "/course/view.php?id=10",
            200,
            r#"<div class="activity"><a href="/mod/assign/view.php?id=88">Essay</a><div class="activity-dates"><div>Due: <time datetime="2099-01-01T12:00:00Z">1 Jan</time></div></div></div>"#,
        ),
    ]);
    assert_eq!(requests.len(), 2);
    assert_eq!(
        found.resources[0].due_at.as_deref(),
        Some("2099-01-01T12:00:00+00:00")
    );
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("proof.db")).unwrap();
    assert!(commit(&conn, &found, true).committed);
    conn.execute_batch("CREATE TRIGGER reject_reminder BEFORE INSERT ON change_events WHEN NEW.deduplication_key LIKE 'deadline-reminder:%' BEGIN SELECT RAISE(ABORT,'reminder failed'); END;").unwrap();
    // Wide deterministic window exercises reminder persistence without wall
    // clock dependence on a short-lived fixture deadline.
    let result = engine::commit_scan(
        &conn,
        &found,
        false,
        0,
        0,
        &HashSet::new(),
        1_000_000,
        "2026-11-21T12:00:00Z",
        None,
    );
    assert!(
        !result.committed,
        "reminder write failure cannot authorize effects"
    );
    assert!(!result.errors.is_empty());
    assert_eq!(result.updated, 0);
}

use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;

use crate::db;
use crate::quanta::client::QuantaClient;
use crate::quanta::discover::{self, CrawlLimits};
use crate::sync::reconcile as engine;

fn server<F>(requests: usize, handler: F) -> (std::net::SocketAddr, thread::JoinHandle<()>)
where
    F: Fn(&str) -> (u16, String) + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handler = Arc::new(handler);
    let handle = thread::spawn(move || {
        for _ in 0..requests {
            let Ok((mut stream, _)) = listener.accept() else { break; };
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let path = request
                .lines()
                .next()
                .unwrap_or("")
                .split_whitespace()
                .nth(1)
                .unwrap_or("/")
                .to_string();
            let (status, body) = handler(&path);
            let status_text = if status == 200 { "OK" } else { "Error" };
            let _ = write!(
                stream,
                "HTTP/1.1 {} {}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status, status_text, body.len(), body
            );
            let _ = stream.flush();
        }
    });
    (addr, handle)
}

fn course_page() -> String {
    r#"<li class="section main"><h3 class="sectionname">Week 1</h3><div class="activity"><a href="/mod/resource/view.php?id=42">Slides</a></div></li>"#.to_string()
}

fn discovery_from(addr: std::net::SocketAddr) -> discover::Discovery {
    let client = Arc::new(QuantaClient::fixture_client(addr));
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(discover::discover_all(
            client,
            CrawlLimits {
                concurrency: 1,
                ..CrawlLimits::default()
            },
            Arc::new(AtomicBool::new(false)),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
        ))
}

#[test]
fn failed_resource_statement_rolls_back() {
    let (addr, handle) = server(3, |path| {
        if path == "/my/" {
            (200, r#"<a href="/course/view.php?id=10">Course Ten</a>"#.to_string())
        } else if path.starts_with("/course/view.php") {
            (200, course_page())
        } else {
            (200, "<html><body>details</body></html>".to_string())
        }
    });
    let discovery = discovery_from(addr);
    handle.join().unwrap();
    assert!(discovery.errors.is_empty(), "{:?}", discovery.errors);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    let conn = db::open(&path).unwrap();
    // trigger that rejects any resource write immediately
    conn.execute(
        "CREATE TRIGGER fail_resource BEFORE INSERT ON resources BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        [],
    )
    .unwrap();

    let baseline_gen = 0i64;
    let global_gen = 0i64;
    let rebaseline = HashSet::new();
    let result = engine::commit_scan(
        &conn,
        &discovery,
        true,
        baseline_gen,
        global_gen,
        &rebaseline,
        24,
        &db::now_rfc3339(),
        None,
    );
    assert!(!result.committed, "scan must not commit");
    assert!(!result.errors.is_empty(), "must report failure");

    // nothing persisted
    let resources: i64 = conn
        .query_row("SELECT COUNT(*) FROM resources", [], |r| r.get(0))
        .unwrap();
    let courses: i64 = conn
        .query_row("SELECT COUNT(*) FROM courses", [], |r| r.get(0))
        .unwrap();
    assert_eq!(resources, 0);
    assert_eq!(courses, 0);
    assert!(db::get_kv(&conn, "baseline_established").is_none());
}

#[test]
fn failed_event_statement_rolls_back() {
    let (addr, handle) = server(3, |path| {
        if path == "/my/" {
            (200, r#"<a href="/course/view.php?id=10">Course Ten</a>"#.to_string())
        } else if path.starts_with("/course/view.php") {
            (200, course_page())
        } else {
            (200, "<html><body>details</body></html>".to_string())
        }
    });
    let discovery = discovery_from(addr);
    handle.join().unwrap();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    let conn = db::open(&path).unwrap();
    conn.execute(
        "CREATE TRIGGER fail_event BEFORE INSERT ON change_events BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        [],
    )
    .unwrap();
    // baseline already established so new resource becomes a "new" event
    db::set_kv(&conn, "baseline_established", "2026-11-16T00:00:00Z").unwrap();

    let result = engine::commit_scan(
        &conn,
        &discovery,
        false,
        0,
        0,
        &HashSet::new(),
        24,
        &db::now_rfc3339(),
        None,
    );
    assert!(!result.committed);
    assert!(!result.errors.is_empty());

    let resources: i64 = conn
        .query_row("SELECT COUNT(*) FROM resources", [], |r| r.get(0))
        .unwrap();
    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM change_events", [], |r| r.get(0))
        .unwrap();
    assert_eq!(resources, 0);
    assert_eq!(events, 0);
}

#[test]
fn commit_failure_via_deferred_fk_preserves_state() {
    let (addr, handle) = server(3, |path| {
        if path == "/my/" {
            (200, r#"<a href="/course/view.php?id=10">Course Ten</a>"#.to_string())
        } else if path.starts_with("/course/view.php") {
            (200, course_page())
        } else {
            (200, "<html><body>details</body></html>".to_string())
        }
    });
    let discovery = discovery_from(addr);
    handle.join().unwrap();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    let conn = db::open(&path).unwrap();

    // seed existing inventory + marker + miss streak
    let course_id = db::upsert_course(
        &conn,
        "99",
        "Existing Course",
        None,
        "https://quanta.bits-pilani.ac.in/course/view.php?id=99",
        "2026-11-16T00:00:00Z",
    )
    .unwrap();
    let res_id = db::upsert_resource(
        &conn,
        &db::ResourceWrite {
            external_id: "existing-1",
            course_id: Some(course_id),
            title: "Existing",
            url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
            source_page_url: None,
            resource_type: "pdf",
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            fingerprint: "fp",
            size_bytes: None,
            section: None,
            section_path: None,
            is_external: false,
            availability: "available",
        },
        "2026-11-16T00:00:00Z",
    )
    .unwrap();
    conn.execute(
        "UPDATE resources SET miss_streak = 2 WHERE id = ?1",
        [res_id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO change_events(resource_id, course_id, change_type, title, detected_at, deduplication_key) VALUES(?1,?2,'new','Kept','2026-11-16T00:00:00Z','kept')",
        rusqlite::params![res_id, course_id],
    )
    .unwrap();
    db::set_kv(&conn, "rebaseline_courses", "[10]").unwrap();
    db::set_kv(&conn, "baseline_established", "2026-11-15T00:00:00Z").unwrap();

    // deferred FK trigger: statement succeeds, commit fails
    conn.execute(
        "CREATE TABLE commit_fail (x INTEGER REFERENCES resources(id) DEFERRABLE INITIALLY DEFERRED)",
        [],
    )
    .unwrap();
    conn.execute(
        "CREATE TRIGGER fail_commit AFTER INSERT ON resources BEGIN INSERT INTO commit_fail(x) VALUES (999999); END;",
        [],
    )
    .unwrap();

    let before_miss: i64 = conn
        .query_row("SELECT miss_streak FROM resources WHERE external_resource_id='existing-1'", [], |r| r.get(0))
        .unwrap();
    let before_events: i64 = conn
        .query_row("SELECT COUNT(*) FROM change_events", [], |r| r.get(0))
        .unwrap();
    let before_resources: i64 = conn
        .query_row("SELECT COUNT(*) FROM resources", [], |r| r.get(0))
        .unwrap();

    let result = engine::commit_scan(
        &conn,
        &discovery,
        false,
        0,
        0,
        &HashSet::from([10i64]),
        24,
        &db::now_rfc3339(),
        None,
    );
    assert!(!result.committed, "commit must fail");
    assert!(!result.errors.is_empty());

    // existing state preserved
    let after_miss: i64 = conn
        .query_row("SELECT miss_streak FROM resources WHERE external_resource_id='existing-1'", [], |r| r.get(0))
        .unwrap();
    let after_events: i64 = conn
        .query_row("SELECT COUNT(*) FROM change_events", [], |r| r.get(0))
        .unwrap();
    let after_resources: i64 = conn
        .query_row("SELECT COUNT(*) FROM resources", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before_miss, after_miss);
    assert_eq!(before_events, after_events);
    assert_eq!(before_resources, after_resources);
    assert_eq!(
        db::get_kv(&conn, "rebaseline_courses").as_deref(),
        Some("[10]")
    );
    assert!(db::get_kv(&conn, "baseline_established").is_some());
    // no committed success effects
    assert_eq!(result.new, 0);
    assert_eq!(result.updated, 0);
    assert_eq!(result.unavailable, 0);
    assert!(result.missing_ids.is_empty());
}

#[test]
fn complete_success_commits_and_preserves_quiet_baseline() {
    let (addr, handle) = server(3, |path| {
        if path == "/my/" {
            (200, r#"<a href="/course/view.php?id=10">Course Ten</a>"#.to_string())
        } else if path.starts_with("/course/view.php") {
            (200, course_page())
        } else {
            (200, "<html><body>details</body></html>".to_string())
        }
    });
    let discovery = discovery_from(addr);
    handle.join().unwrap();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    let conn = db::open(&path).unwrap();

    let result = engine::commit_scan(
        &conn,
        &discovery,
        true,
        0,
        0,
        &HashSet::new(),
        24,
        &db::now_rfc3339(),
        None,
    );
    assert!(result.committed, "{:?}", result.errors);
    assert_eq!(result.new, 0);
    assert_eq!(result.updated, 0);
    assert_eq!(result.unavailable, 0);
    assert!(db::get_kv(&conn, "baseline_established").is_some());
    let resources: i64 = conn
        .query_row("SELECT COUNT(*) FROM resources", [], |r| r.get(0))
        .unwrap();
    assert_eq!(resources, 1);
}

#[test]
fn reset_during_collection_retains_newer_generation() {
    let (addr, handle) = server(3, |path| {
        if path == "/my/" {
            (200, r#"<a href="/course/view.php?id=10">Course Ten</a>"#.to_string())
        } else if path.starts_with("/course/view.php") {
            (200, course_page())
        } else {
            (200, "<html><body>details</body></html>".to_string())
        }
    });
    let discovery = discovery_from(addr);
    handle.join().unwrap();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    let mut conn = db::open(&path).unwrap();
    // simulate a reset arriving during collection: DB generation now 5
    db::request_baseline_reset(&mut conn, None).unwrap(); // 1
    // make generation 5 by requesting more
    for _ in 0..4 {
        db::request_baseline_reset(&mut conn, None).unwrap();
    }
    let newer_gen: i64 = db::get_kv(&conn, "baseline_global_reset_generation")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(newer_gen, 5);

    // scan captured stale generation 0
    let result = engine::commit_scan(
        &conn,
        &discovery,
        true,
        0,
        0,
        &HashSet::new(),
        24,
        &db::now_rfc3339(),
        None,
    );
    assert!(result.committed, "{:?}", result.errors);
    // baseline should NOT be established because generation changed
    assert!(db::get_kv(&conn, "baseline_established").is_none());
    // newer generation retained
    let gen_after: i64 = db::get_kv(&conn, "baseline_global_reset_generation")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(gen_after, newer_gen);
}

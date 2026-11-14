//! HTTP regressions for typed expiry propagation through real discovery.

use super::{discover, CrawlLimits, Discovery};
use crate::quanta::client::QuantaClient;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Duration, Instant};

async fn crawl(responses: Vec<(&'static str, u16, &'static str)>) -> Discovery {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let client = Arc::new(QuantaClient::fixture_client(listener.local_addr().unwrap()));
    let server = std::thread::spawn(move || {
        for (path, status, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "missing request for {path}");
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                assert_eq!(socket.read(&mut byte).unwrap(), 1);
                request.push(byte[0]);
            }
            assert!(String::from_utf8_lossy(&request).starts_with(&format!("GET {path} HTTP/1.1")));
            write!(socket, "HTTP/1.1 {status} Fixture\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    let result = discover(
        client,
        CrawlLimits::default(),
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    server.join().unwrap();
    result
}

const COURSE: &str = r#"<a href="/course/view.php?id=42">Course</a>"#;
const LOGIN: &str = r#"<form id="login"></form>"#;

#[tokio::test]
async fn expiry_on_course_page_reaches_engine_without_inventory() {
    let result = crawl(vec![
        ("/my/", 200, COURSE),
        ("/course/view.php?id=42", 200, LOGIN),
    ])
    .await;
    assert!(result.auth_expired);
    assert_eq!(result.courses_failed, 1);
    assert!(result.resources.is_empty());
}

#[tokio::test]
async fn expiry_on_fallback_course_list_is_not_an_empty_success() {
    let result = crawl(vec![("/my/", 200, ""), ("/my/courses.php", 401, "")]).await;
    assert!(result.auth_expired);
    assert!(!result.errors.is_empty());
}

#[tokio::test]
async fn dashboard_expiry_stops_discovery() {
    let result = crawl(vec![("/my/", 200, LOGIN)]).await;
    assert!(result.auth_expired);
    assert!(result.courses.is_empty());
}

#[tokio::test]
async fn temporary_course_failure_does_not_expire_session() {
    let result = crawl(vec![
        ("/my/", 200, COURSE),
        ("/course/view.php?id=42", 503, ""),
    ])
    .await;
    assert!(!result.auth_expired);
    assert_eq!(result.courses_failed, 1);
    assert!(!result.errors.is_empty());
}

#[tokio::test]
async fn expiry_on_nested_course_section_reaches_engine() {
    let result = crawl(vec![
        ("/my/", 200, COURSE),
        (
            "/course/view.php?id=42",
            200,
            r#"<a href="/course/view.php?id=42&section=2">Section 2</a>"#,
        ),
        ("/course/view.php?id=42&section=2", 403, ""),
    ])
    .await;
    assert!(result.auth_expired);
    assert_eq!(result.courses_failed, 1);
}

#[tokio::test]
async fn healthy_empty_course_is_still_successful() {
    let result = crawl(vec![
        ("/my/", 200, COURSE),
        ("/course/view.php?id=42", 200, ""),
    ])
    .await;
    assert!(!result.auth_expired);
    assert_eq!(result.courses_scanned, 1);
    assert_eq!(result.courses_failed, 0);
    assert!(result.errors.is_empty());
}

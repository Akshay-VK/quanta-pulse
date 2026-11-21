//! Synthetic loopback proof of the production verification/publication operation.
//! No webview, installed profile, or live Quanta session is used.
use super::*;
use crate::core::files::FileStore;
use crate::core::mirror::{Mirror, MirrorConfig};
use crate::settings::Settings;
use crate::state::SyncControl;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::sync::{mpsc, Mutex};

const VERIFIED_PAGE: &str = r#"<html><script>M.cfg = {"sesskey":"synthetic-key","userId":4242};</script><span class="usertext">Fixture Student</span></html>"#;

struct Fixture {
    address: SocketAddr,
    requests: mpsc::Receiver<String>,
    release: mpsc::Sender<()>,
    server: std::thread::JoinHandle<()>,
}

impl Fixture {
    fn start(status: u16, count: usize) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (sent, requests) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let server = std::thread::spawn(move || {
            for index in 0..count {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    assert_eq!(stream.read(&mut byte).unwrap(), 1);
                    request.push(byte[0]);
                }
                sent.send(String::from_utf8(request).unwrap()).unwrap();
                if index == 0 {
                    gate.recv_timeout(Duration::from_secs(15)).unwrap();
                }
                let body = if index == 0 {
                    VERIFIED_PAGE
                } else {
                    "<html>next request</html>"
                };
                write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: text/html\r\nSet-Cookie: MoodleSession=synthetic-rotated; Path=/; HttpOnly\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        Self {
            address,
            requests,
            release,
            server,
        }
    }

    fn candidate(&self, method: &str, email: &str) -> QuantaClient {
        QuantaClient::fixture_session_client(
            self.address,
            SessionInfo {
                email: email.into(),
                method: method.into(),
                user_id: Some(7),
                fullname: Some("Unverified Name".into()),
                sesskey: Some("synthetic-old-key".into()),
                session_cookie: "synthetic-original".into(),
                acquired_at: "2026-01-01T00:00:00Z".into(),
            },
        )
    }
}

fn state(data: &tempfile::TempDir) -> AppState {
    let settings = Settings::default();
    let db_path = data.path().join("session-proof.sqlite");
    AppState {
        conn: Mutex::new(db::open(&db_path).unwrap()),
        db_path,
        files: FileStore::new(data.path()),
        mirror: Mirror::new(
            data.path().join("mirror"),
            MirrorConfig::from_settings(&settings),
        ),
        client: Mutex::new(None),
        settings: Mutex::new(settings),
        sync: Arc::new(SyncControl::default()),
    }
}

fn assert_cookie(request: &str, expected: &str) {
    let cookies: Vec<_> = request
        .lines()
        .filter(|line| line.to_ascii_lowercase().starts_with("cookie:"))
        .map(|line| line.split_once(':').unwrap().1.trim())
        .collect();
    assert_eq!(cookies, vec![expected]);
}

async fn assert_verified_publication(method: &str, email: &str, attempt_id: Option<&str>) {
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(200, 2);
    let candidate = fixture.candidate(method, email);
    let fixture_origin = candidate.origin().clone();
    claim(&state, attempt_id.unwrap_or("unrelated-sso"));
    *state.sync.last_error.lock().unwrap() = Some("synthetic previous failure".into());
    let expected_email = if email == "quanta-account" {
        "Fixture Student"
    } else {
        email
    };
    fixture.release.send(()).unwrap();
    verify_and_install_session(&state, candidate, attempt_id)
        .await
        .unwrap();
    let status = auth_status(&state);
    let active = state.client().unwrap();
    assert_eq!(active.origin(), &fixture_origin);
    active
        .fetch(&active.origin().join("/next").unwrap())
        .await
        .unwrap();
    let first = fixture
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    let next = fixture
        .requests
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    fixture.server.join().unwrap();
    assert!(status.authenticated);
    assert_eq!(
        status.attempt_id.as_deref(),
        Some(attempt_id.unwrap_or("unrelated-sso"))
    );
    assert_eq!(status.email.as_deref(), Some(expected_email));
    assert_eq!(status.full_name.as_deref(), Some("Fixture Student"));
    assert_eq!(status.method.as_deref(), Some(method));
    assert_eq!(state.sync.auth_state(), "authenticated");
    assert_eq!(active.session.email, expected_email);
    assert_eq!(active.session.fullname.as_deref(), Some("Fixture Student"));
    assert!(state.sync.last_error.lock().unwrap().is_none());
    assert_eq!(active.session.user_id, Some(4242));
    assert_eq!(active.session.sesskey.as_deref(), Some("synthetic-key"));
    assert_eq!(active.session.session_cookie, "synthetic-rotated");
    assert_eq!(active.session.acquired_at, "2026-01-01T00:00:00Z");
    assert_eq!(
        db::get_kv(&state.conn(), "current_email").as_deref(),
        Some(expected_email)
    );
    assert!(first.starts_with("GET /my/ "));
    assert_cookie(&first, "MoodleSession=synthetic-original");
    assert!(next.starts_with("GET /next "));
    assert_cookie(&next, "MoodleSession=synthetic-rotated");
}

fn claim(state: &AppState, id: &str) -> SsoAttempt {
    let (completion, _) = tokio::sync::watch::channel(None);
    let candidate = SsoAttempt {
        id: id.into(),
        window_label: format!("fixture-{id}"),
        completion,
        terminal: Arc::new(AtomicBool::new(false)),
    };
    let (attempt, owns) = claim_sso_attempt(
        &mut state.sync.sso_lifecycle.lock().unwrap(),
        &state.sync.auth_resetting,
        candidate,
    )
    .unwrap();
    assert!(owns);
    attempt
}

#[tokio::test]
async fn password_verification_publishes_identity_and_rotated_transport() {
    assert_verified_publication("password", "student@example.invalid", None).await;
}

#[tokio::test]
async fn current_sso_publishes_verified_identity_and_rotated_transport() {
    assert_verified_publication("sso", "quanta-account", Some("current")).await;
}

#[tokio::test]
async fn current_sso_preserves_explicit_account_label() {
    assert_verified_publication("sso", "sso@example.invalid", Some("current")).await;
}

fn seed_prior_session(state: &AppState, fixture: &Fixture) -> Arc<QuantaClient> {
    let previous = Arc::new(fixture.candidate("password", "previous@example.invalid"));
    state.set_client(Some(previous.clone()));
    db::set_kv(&state.conn(), "current_email", "previous@example.invalid").unwrap();
    state.sync.set_auth_state("expired");
    *state.sync.last_error.lock().unwrap() = Some("synthetic previous failure".into());
    previous
}

fn assert_prior_session_untouched(state: &AppState, previous: &Arc<QuantaClient>) {
    assert!(Arc::ptr_eq(&state.client().unwrap(), previous));
    let status = auth_status(state);
    assert_eq!(status.email.as_deref(), Some("previous@example.invalid"));
    assert!(status.session_expired);
    assert_eq!(
        db::get_kv(&state.conn(), "current_email").as_deref(),
        Some("previous@example.invalid")
    );
    assert_eq!(
        state.sync.last_error.lock().unwrap().as_deref(),
        Some("synthetic previous failure")
    );
}

async fn assert_delayed_sso_rejected(successor: bool) {
    let data = tempfile::tempdir().unwrap();
    let state = Arc::new(state(&data));
    let fixture = Fixture::start(200, 1);
    let previous = seed_prior_session(&state, &fixture);
    let attempt = claim(&state, "cancelled");
    let waiter = attempt.completion.subscribe();
    let candidate = fixture.candidate("sso", "quanta-account");
    let verifying = {
        let state = state.clone();
        tokio::spawn(async move {
            verify_and_install_session(&state, candidate, Some("cancelled")).await
        })
    };
    // The real verification request is in flight when cancellation releases its
    // slot, as in cancel_sso_login. Only the native window adapter is omitted.
    let request = fixture
        .requests
        .recv_timeout(Duration::from_secs(10))
        .unwrap();
    assert!(request.starts_with("GET /my/ "));
    assert_cookie(&request, "MoodleSession=synthetic-original");
    let cancelled =
        take_sso_attempt(&mut state.sync.sso_lifecycle.lock().unwrap(), "cancelled").unwrap();
    assert!(cancelled.publish(Err("synthetic cancellation".into())));
    let successor = successor.then(|| claim(&state, "successor"));
    fixture.release.send(()).unwrap();
    let result = verifying.await.unwrap();
    fixture.server.join().unwrap();
    assert_eq!(result.unwrap_err(), "Sign-in attempt is no longer active.");
    assert_prior_session_untouched(&state, &previous);
    assert_eq!(
        waiter.borrow().as_ref().unwrap().as_ref().unwrap_err(),
        "synthetic cancellation"
    );
    assert_eq!(
        active_sso_attempt_id(&state).as_deref(),
        successor.as_ref().map(|a| a.id.as_str())
    );
    if let Some(successor) = successor {
        assert!(successor.completion.borrow().is_none());
        assert!(!successor.terminal.load(Ordering::SeqCst));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_sso_verification_cannot_install_after_response() {
    assert_delayed_sso_rejected(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_sso_verification_cannot_install_over_successor() {
    assert_delayed_sso_rejected(true).await;
}

#[tokio::test]
async fn unusable_session_never_replaces_active_identity() {
    let data = tempfile::tempdir().unwrap();
    let state = state(&data);
    let fixture = Fixture::start(401, 1);
    let previous = seed_prior_session(&state, &fixture);
    fixture.release.send(()).unwrap();
    let result = verify_and_install_session(
        &state,
        fixture.candidate("password", "new@example.invalid"),
        None,
    )
    .await;
    fixture.server.join().unwrap();
    assert_eq!(
        result.unwrap_err(),
        "Sign-in did not establish a usable session."
    );
    assert_prior_session_untouched(&state, &previous);
}

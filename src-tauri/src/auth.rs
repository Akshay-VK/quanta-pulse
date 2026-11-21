//! Authentication against the official Quanta origin.
//!
//! Two legitimate flows are supported:
//!
//! * **Native credential sign-in** — POST the Moodle login form (with its CSRF
//!   token) to `https://quanta.bits-pilani.ac.in/login/index.php`. This works
//!   only for accounts that have a Moodle password.
//! * **Interactive SSO** — BITS uses a SAML2 provider backed by Google. When an
//!   account must use it, we open the *official* provider flow in a webview and
//!   wait for the user to complete sign-in (including MFA). We never automate or
//!   bypass the provider.
//!
//! Passwords are held only for the duration of a single request and are zeroed
//! afterwards. Session cookies remain in memory only; sign in again after restart.

use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::cookie::CookieStore;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;
use zeroize::Zeroizing;

use crate::db;
use crate::models::{AuthStatus, SessionRefreshResult, SessionResetResult};
use crate::quanta::client::{QuantaClient, QuantaError, SessionInfo};
use crate::quanta::parse;
use crate::quanta::urlnorm::QUANTA_ORIGIN;
use crate::state::AppState;

const SSO_URL: &str = "https://quanta.bits-pilani.ac.in/auth/saml2/login.php?wants&idp=a3d2b918db7e3b6e3523237dc27a53ce&passive=off";
const SSO_TIMEOUT: Duration = Duration::from_secs(300);
const SSO_WINDOW_LABEL: &str = "quanta-login";
const QUANTA_HOST: &str = "quanta.bits-pilani.ac.in";
const RESET_IDLE_TIMEOUT: Duration = Duration::from_secs(130);

#[derive(Clone)]
enum SsoLoginFailure {
    LoginRequired(String),
    Failed(String),
}

/// Private attempt identity shared by duplicate start callers. Results remain
/// bounded to the active attempt; completion drops this state immediately.
#[derive(Clone)]
pub(crate) struct SsoAttempt {
    id: String,
    window_label: String,
    completion: tokio::sync::watch::Sender<Option<Result<AuthStatus, String>>>,
    terminal: Arc<AtomicBool>,
}

impl SsoAttempt {
    fn publish(&self, result: Result<AuthStatus, String>) -> bool {
        if self.terminal.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.completion.send_replace(Some(result));
        true
    }
}

fn take_sso_attempt(active: &mut Option<SsoAttempt>, id: &str) -> Option<SsoAttempt> {
    if active.as_ref().is_some_and(|attempt| attempt.id == id) {
        active.take()
    } else {
        None
    }
}

/// Claim or join an SSO attempt while holding the lifecycle lock and checking
/// the reset gate in the same critical section.
fn claim_sso_attempt(
    active: &mut Option<SsoAttempt>,
    resetting: &std::sync::atomic::AtomicBool,
    candidate: SsoAttempt,
) -> Result<(SsoAttempt, bool), String> {
    if resetting.load(Ordering::SeqCst) {
        return Err("Quanta session reset is in progress. Try signing in again shortly.".into());
    }
    if let Some(attempt) = active.as_ref() {
        Ok((attempt.clone(), false))
    } else {
        *active = Some(candidate.clone());
        Ok((candidate, true))
    }
}

fn matching_sso_window_label(active: &Option<SsoAttempt>, id: &str) -> Option<String> {
    active
        .as_ref()
        .filter(|attempt| attempt.id == id)
        .map(|attempt| attempt.window_label.clone())
}

/// Run the synchronous session commit only while its verified attempt owns the slot.
fn commit_sso_if_current(
    lifecycle: &std::sync::Mutex<Option<SsoAttempt>>,
    attempt_id: &str,
    commit: impl FnOnce(),
) -> bool {
    let active = lifecycle.lock().unwrap();
    if !active
        .as_ref()
        .is_some_and(|attempt| attempt.id == attempt_id)
    {
        return false;
    }
    // Lock order: SSO lifecycle, then DB connection, then other state locks.
    // No await or window callback is permitted inside this synchronous commit.
    commit();
    true
}

pub(crate) fn active_sso_attempt_id(state: &AppState) -> Option<String> {
    state
        .sync
        .sso_lifecycle
        .lock()
        .unwrap()
        .as_ref()
        .map(|attempt| attempt.id.clone())
}

impl SsoLoginFailure {
    fn message(self) -> String {
        match self {
            Self::LoginRequired(message) | Self::Failed(message) => message,
        }
    }
}

struct AtomicFlagReset<'a>(&'a std::sync::atomic::AtomicBool);

impl<'a> AtomicFlagReset<'a> {
    fn try_acquire(flag: &'a std::sync::atomic::AtomicBool, message: &str) -> Result<Self, String> {
        if flag.swap(true, std::sync::atomic::Ordering::SeqCst) {
            Err(message.to_string())
        } else {
            Ok(Self(flag))
        }
    }
}

impl Drop for AtomicFlagReset<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/* ------------------------------------------------------------ credential flow */

pub async fn login_with_password(
    app: AppHandle,
    email: String,
    password: Zeroizing<String>,
) -> Result<AuthStatus, String> {
    let state = app.state::<AppState>();
    if state.sync.auth_resetting.load(Ordering::SeqCst) {
        return Err("Quanta session reset is in progress. Try signing in again shortly.".into());
    }
    let _active = AtomicFlagReset::try_acquire(
        &state.sync.credential_login_active,
        "A Quanta credential sign-in is already in progress.",
    )?;
    if state.sync.auth_resetting.load(Ordering::SeqCst) {
        return Err("Quanta session reset is in progress. Try signing in again shortly.".into());
    }
    let timeout = app.state::<AppState>().settings().request_timeout_secs;
    let (http, jar) = QuantaClient::anonymous(timeout).map_err(|e| e.to_string())?;
    let origin = Url::parse(QUANTA_ORIGIN).expect("valid origin");
    let login_url = origin.join("/login/index.php").map_err(|e| e.to_string())?;

    let page = http
        .get(login_url.clone())
        .send()
        .await
        .map_err(|e| format!("Could not reach Quanta: {e}"))?;
    if !page.status().is_success() {
        return Err(format!("Quanta's login page returned {}", page.status()));
    }
    let body = page.text().await.map_err(|e| e.to_string())?;
    let token = parse::parse_login_token(&body).ok_or("Quanta's login form could not be read.")?;

    let resp = http
        .post(login_url)
        .form(&[
            ("username", email.as_str()),
            ("password", password.as_str()),
            ("logintoken", token.as_str()),
            ("anchor", ""),
        ])
        .send()
        .await
        .map_err(|e| format!("Sign-in request failed: {e}"))?;

    let status = resp.status();
    let final_url = resp.url().clone();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    if final_url.path().starts_with("/login") || parse::looks_like_login_page(&body) {
        let lower = body.to_lowercase();
        if lower.contains("invalid login") || lower.contains("loginerrormessage") {
            return Err("Incorrect email or password.".to_string());
        }
        if final_url.path().starts_with("/auth/")
            || lower.contains("saml")
            || lower.contains("google")
        {
            return Err(
                "This account signs in with BITS Google. Use \"Sign in with BITS Google\"."
                    .to_string(),
            );
        }
        return Err(
            "Quanta did not accept the sign-in. Your account may require BITS Google sign-in."
                .to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!("Quanta returned {status}."));
    }

    let cookie_header = jar
        .cookies(&origin)
        .and_then(|c| c.to_str().ok().map(|s| s.to_string()))
        .unwrap_or_default();
    let session_cookie =
        extract_session_cookie(&cookie_header).ok_or("Quanta did not issue a session.")?;
    let (user_id, sesskey, fullname) = parse::parse_session_facts(&body);

    let session = SessionInfo {
        email,
        method: "password".to_string(),
        user_id,
        fullname,
        session_cookie,
        sesskey,
        acquired_at: db::now_rfc3339(),
    };
    let status = finalize_session(&app, session, None).await?;
    resume_monitoring(app.clone(), "login");
    Ok(status)
}

/* --------------------------------------------------------------- SSO flow */

pub async fn start_sso_login(app: AppHandle) -> Result<AuthStatus, String> {
    let state = app.state::<AppState>();
    let (attempt, receiver, owner, focus_label) = {
        let mut active = state.sync.sso_lifecycle.lock().unwrap();
        // Serialize the reset gate with claiming an attempt. Reset sets its flag
        // before taking this lock, so it either rejects this start or cancels it.
        let id = uuid::Uuid::new_v4().to_string();
        let (completion, _candidate_receiver) = tokio::sync::watch::channel(None);
        let candidate = SsoAttempt {
            id: id.clone(),
            window_label: format!("{SSO_WINDOW_LABEL}-{id}"),
            completion,
            terminal: Arc::new(AtomicBool::new(false)),
        };
        let (attempt, owner) =
            claim_sso_attempt(&mut active, &state.sync.auth_resetting, candidate)?;
        if !owner {
            let receiver = attempt.completion.subscribe();
            (
                attempt.clone(),
                receiver,
                false,
                Some(attempt.window_label.clone()),
            )
        } else {
            let receiver = attempt.completion.subscribe();
            state.sync.sso_login_active.store(true, Ordering::SeqCst);
            (attempt, receiver, true, None)
        }
    };
    if let Some(label) = focus_label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
    if owner {
        let result = run_sso_login_inner(&app, &attempt)
            .await
            .map_err(SsoLoginFailure::message);
        let mut active = state.sync.sso_lifecycle.lock().unwrap();
        let is_current = active
            .as_ref()
            .is_some_and(|current| current.id == attempt.id);
        if is_current {
            *active = None;
            state.sync.sso_login_active.store(false, Ordering::SeqCst);
            // Serialize terminal publication with cancellation. Only the slot
            // owner may complete the shared promise.
            attempt.publish(result.clone());
        }
        drop(active);
        if result.is_ok() {
            resume_monitoring(app.clone(), "login");
        }
        result
    } else {
        let mut receiver = receiver;
        loop {
            if let Some(result) = receiver.borrow().clone() {
                return result;
            }
            if receiver.changed().await.is_err() {
                return Err("Quanta sign-in ended.".into());
            }
        }
    }
}

async fn run_sso_login_inner(
    app: &AppHandle,
    attempt: &SsoAttempt,
) -> Result<AuthStatus, SsoLoginFailure> {
    let url = Url::parse(SSO_URL).map_err(|e| SsoLoginFailure::Failed(e.to_string()))?;

    let window = WebviewWindowBuilder::new(app, &attempt.window_label, WebviewUrl::External(url))
        .title("Sign in to Quanta")
        .inner_size(520.0, 720.0)
        .resizable(true)
        .build()
        .map_err(|e| SsoLoginFailure::Failed(format!("Could not open the sign-in window: {e}")))?;

    let deadline = Instant::now() + SSO_TIMEOUT;
    let mut found: Option<String> = None;
    let mut failure: Option<SsoLoginFailure> = None;

    while Instant::now() < deadline {
        if !is_current_attempt(app, attempt)
            || app.get_webview_window(&attempt.window_label).is_none()
        {
            failure = Some(SsoLoginFailure::LoginRequired(
                "Sign-in was cancelled. Quanta authentication is still required.".to_string(),
            ));
            break;
        }
        if let Ok(current) = window.url() {
            let host = current.host_str().unwrap_or_default().to_string();
            let path = current.path().to_string();
            // Only trust a cookie once we are back on the Quanta origin, past the
            // login/SSO handshake pages.
            if host == QUANTA_HOST && !path.starts_with("/login") && !path.starts_with("/auth/") {
                match window.cookies() {
                    Ok(cookies) => {
                        if let Some(cookie) = cookies.iter().find(|c| c.name() == "MoodleSession") {
                            found = Some(cookie.value().to_string());
                            break;
                        }
                    }
                    Err(error) => {
                        failure = Some(SsoLoginFailure::Failed(format!(
                            "Could not read the Quanta sign-in session: {error}"
                        )));
                        break;
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }

    if app.get_webview_window(&attempt.window_label).is_some() {
        window.close().map_err(|e| {
            SsoLoginFailure::Failed(format!("Could not close the Quanta sign-in window: {e}"))
        })?;
    }
    if let Some(failure) = failure {
        return Err(failure);
    }

    let session_cookie = found.ok_or_else(|| {
        SsoLoginFailure::LoginRequired(
            "Sign-in timed out. Quanta authentication is still required.".to_string(),
        )
    })?;
    let email = {
        let state = app.state::<AppState>();
        let conn = state.conn();
        db::get_kv(&conn, "current_email").unwrap_or_else(|| "quanta-account".to_string())
    };

    let session = SessionInfo {
        email,
        method: "sso".to_string(),
        user_id: None,
        fullname: None,
        session_cookie,
        sesskey: None,
        acquired_at: db::now_rfc3339(),
    };
    finalize_sso_session(app, session, &attempt.id)
        .await
        .map_err(|message| {
            if message == "Sign-in did not establish a usable session." {
                SsoLoginFailure::LoginRequired(message)
            } else {
                SsoLoginFailure::Failed(message)
            }
        })
}

/* ---------------------------------------------------------------- shared */

async fn finalize_session(
    app: &AppHandle,
    session: SessionInfo,
    sso_attempt: Option<&str>,
) -> Result<AuthStatus, String> {
    let timeout = app.state::<AppState>().settings().request_timeout_secs;
    // Build the client before verification so its cookie jar can absorb any
    // session cookie rotation performed by the verification response. The
    // verified facts are published into this same client below instead of
    // constructing a second one from a stale cookie.
    let mut client =
        QuantaClient::from_session(session.clone(), timeout).map_err(|e| e.to_string())?;

    // Verify the session actually works before storing it.
    let my = client.origin().join("/my/").map_err(|e| e.to_string())?;
    let page = client.fetch(&my).await.map_err(|e| match e {
        QuantaError::AuthExpired => "Sign-in did not establish a usable session.".to_string(),
        other => other.to_string(),
    })?;

    let (uid, sesskey, fullname) = parse::parse_session_facts(&page.body);
    let mut session = session;
    if uid.is_some() {
        session.user_id = uid;
    }
    if sesskey.is_some() {
        session.sesskey = sesskey;
    }
    if fullname.is_some() {
        session.fullname = fullname;
    }
    if session.email == "quanta-account" {
        if let Some(name) = &session.fullname {
            session.email = name.clone();
        }
    }
    // Preserve a session cookie rotated by the verification response instead of
    // recreating the client from the stale cookie captured before verification.
    if let Some(header) = client.session_cookie_header() {
        if let Some(cookie) = extract_session_cookie(&header) {
            session.session_cookie = cookie;
        }
    }
    // Publish the fully verified session facts into the active client.
    client.session = session.clone();

    let client = Arc::new(client);

    let state = app.state::<AppState>();
    let install = || {
        let conn = state.conn();
        let _ = db::set_kv(&conn, "current_email", &session.email);
        state.set_client(Some(client));
        // Anything that parked itself waiting for a session resumes now, and
        // the pending downloads are re-validated against this session.
        state.mirror.session_restored();
        state.sync.set_auth_state("authenticated");
        *state.sync.last_error.lock().unwrap() = None;
    };
    if let Some(attempt_id) = sso_attempt {
        if !commit_sso_if_current(&state.sync.sso_lifecycle, attempt_id, install) {
            return Err("Sign-in attempt is no longer active.".into());
        }
    } else {
        install();
    }

    let _ = app.emit("auth:changed", ());

    let state = app.state::<AppState>();
    Ok(auth_status(&state))
}

async fn finalize_sso_session(
    app: &AppHandle,
    session: SessionInfo,
    attempt_id: &str,
) -> Result<AuthStatus, String> {
    finalize_session(app, session, Some(attempt_id)).await
}

fn is_current_attempt(app: &AppHandle, attempt: &SsoAttempt) -> bool {
    app.state::<AppState>()
        .sync
        .sso_lifecycle
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|current| current.id == attempt.id)
}

/// Focus an active SSO window only when the opaque attempt ID still matches.
pub fn focus_sso_login(app: &AppHandle, attempt_id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let label = {
        let active = state.sync.sso_lifecycle.lock().unwrap();
        matching_sso_window_label(&active, attempt_id)
    };
    if let Some(label) = label {
        if let Some(window) = app.get_webview_window(&label) {
            window.show().map_err(|e| e.to_string())?;
            window.unminimize().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Cancel only the matching active attempt. Stale and repeated cancellation is harmless.
pub fn cancel_sso_login(app: &AppHandle, attempt_id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let attempt = {
        let mut lifecycle = state.sync.sso_lifecycle.lock().unwrap();
        let Some(attempt) = take_sso_attempt(&mut lifecycle, attempt_id) else {
            return Ok(());
        };
        let _ = attempt.publish(Err(
            "Sign-in was cancelled. Quanta authentication is still required.".into(),
        ));
        state.sync.sso_login_active.store(false, Ordering::SeqCst);
        attempt
    };
    if let Some(window) = app.get_webview_window(&attempt.window_label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn resume_monitoring(app: AppHandle, reason: &'static str) {
    // The existing scheduler remains the only background worker. This one
    // verified post-login scan uses the engine's running guard, so it cannot
    // create a duplicate scan if the scheduler is already waking up.
    tauri::async_runtime::spawn(async move {
        crate::sync::engine::run_scan(app, reason).await;
    });
}

pub fn restore_session(state: &AppState) {
    // No session token is persisted. A prior account label may remain in local
    // settings, but it never implies authentication after a process restart.
    state.set_client(None);
    state.sync.set_auth_state("unauthenticated");
}

pub fn logout(state: &AppState) -> Result<(), String> {
    {
        let conn = state.conn();
        let _ = db::del_kv(&conn, "current_email");
        let _ = db::del_kv(&conn, "next_scan_at");
    }
    state.set_client(None);
    state.sync.set_auth_state("unauthenticated");
    Ok(())
}

pub fn auth_status(state: &AppState) -> AuthStatus {
    let auth_state = state.sync.auth_state();
    let client = state.client();
    AuthStatus {
        authenticated: client.is_some(),
        attempt_id: active_sso_attempt_id(state),
        email: client
            .as_ref()
            .map(|c| c.session.email.clone())
            .or_else(|| {
                let conn = state.conn();
                db::get_kv(&conn, "current_email")
            })
            .filter(|e| !e.is_empty()),
        full_name: client.as_ref().and_then(|c| c.session.fullname.clone()),
        method: client.as_ref().map(|c| c.session.method.clone()),
        acquired_at: client.as_ref().map(|c| c.session.acquired_at.clone()),
        session_expired: auth_state == "expired",
    }
}

/// Dispose of the stale Quanta session and start a new interactive login.
/// Only Quanta's own Moodle session cookie is removed from the shared webview
/// store; other sites' cookies and all application data remain untouched.
pub async fn restart_quanta_session(app: AppHandle) -> SessionResetResult {
    let state = app.state::<AppState>();
    let _reset = match AtomicFlagReset::try_acquire(
        &state.sync.auth_resetting,
        "A Quanta session reset is already in progress.",
    ) {
        Ok(guard) => guard,
        Err(message) => {
            return SessionResetResult {
                status: "failed".into(),
                message,
            }
        }
    };

    let result = reset_and_login(&app).await;
    drop(_reset);

    if result.status == "connected" {
        resume_monitoring(app.clone(), "session_reset");
    }
    result
}

async fn reset_and_login(app: &AppHandle) -> SessionResetResult {
    let state = app.state::<AppState>();

    // Gate every new Quanta operation before asking existing work to stop.
    state.sync.cancel.store(true, Ordering::SeqCst);
    if let Some(id) = active_sso_attempt_id(&state) {
        let _ = cancel_sso_login(app, &id);
    }

    if !wait_for_quanta_work_to_stop(&state).await {
        return reset_result(
            "failed",
            "Quanta requests are still finishing. Retry the session reset shortly.",
        );
    }

    // Drop the in-memory reqwest client only after its scan/preview users have
    // released it. The old client is never handed to the new login flow.
    state.set_client(None);
    state.sync.set_auth_state("expired");
    *state.sync.last_error.lock().unwrap() = None;
    let _ = app.emit("auth:changed", ());
    let _ = app.emit("sync:status", state.sync_status());

    if let Err(error) = clear_quanta_session_cookie(app) {
        return reset_result("failed", error);
    }

    // The prior SSO operation, if any, has been closed and released its guard.
    // Hold that guard while the fresh Quanta window is open to prevent a
    // second login window from racing this reset.
    let attempt = {
        let mut active = state.sync.sso_lifecycle.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let (completion, _receiver) = tokio::sync::watch::channel(None);
        let attempt = SsoAttempt {
            window_label: format!("{SSO_WINDOW_LABEL}-{id}"),
            id,
            completion,
            terminal: Arc::new(AtomicBool::new(false)),
        };
        *active = Some(attempt.clone());
        state.sync.sso_login_active.store(true, Ordering::SeqCst);
        attempt
    };
    let flow_result = run_sso_login_inner(app, &attempt).await;
    // Reset's own caller gets its structured result below; publish to any
    // duplicate start callers sharing this attempt before releasing its slot.
    let shared_result = flow_result.clone().map_err(SsoLoginFailure::message);
    {
        let mut active = state.sync.sso_lifecycle.lock().unwrap();
        if active
            .as_ref()
            .is_some_and(|current| current.id == attempt.id)
        {
            attempt.publish(shared_result);
            *active = None;
            state.sync.sso_login_active.store(false, Ordering::SeqCst);
        }
    }

    match flow_result {
        Ok(_) => reset_result(
            "connected",
            "Quanta access was verified. Monitoring is resuming.",
        ),
        Err(SsoLoginFailure::LoginRequired(message)) => {
            state.set_client(None);
            state.sync.set_auth_state("expired");
            let _ = app.emit("auth:changed", ());
            reset_result("login_required", message)
        }
        Err(SsoLoginFailure::Failed(message)) => {
            state.set_client(None);
            state.sync.set_auth_state("expired");
            *state.sync.last_error.lock().unwrap() = Some(message.clone());
            let _ = app.emit("auth:changed", ());
            reset_result("failed", message)
        }
    }
}

fn reset_result(status: &str, message: impl Into<String>) -> SessionResetResult {
    SessionResetResult {
        status: status.to_string(),
        message: message.into(),
    }
}

async fn wait_for_quanta_work_to_stop(state: &AppState) -> bool {
    let deadline = Instant::now() + RESET_IDLE_TIMEOUT;
    loop {
        let sync = &state.sync;
        let idle = !sync.is_running()
            && sync.active_previews.load(Ordering::SeqCst) == 0
            && !sync.auth_refreshing.load(Ordering::SeqCst)
            && !sync.credential_login_active.load(Ordering::SeqCst)
            && !sync.sso_login_active.load(Ordering::SeqCst);
        if idle {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn clear_quanta_session_cookie(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Could not access the Quanta webview cookie store.".to_string())?;
    let origin = Url::parse(QUANTA_ORIGIN).map_err(|error| error.to_string())?;
    let cookies = window
        .cookies_for_url(origin)
        .map_err(|error| format!("Could not inspect Quanta session cookies: {error}"))?;

    for cookie in cookies {
        if is_quanta_session_cookie(cookie.name(), cookie.domain()) {
            window
                .delete_cookie(cookie)
                .map_err(|error| format!("Could not clear the expired Quanta session: {error}"))?;
        }
    }
    Ok(())
}

fn is_quanta_session_cookie(name: &str, domain: Option<&str>) -> bool {
    name.eq_ignore_ascii_case("MoodleSession")
        && domain
            .map(|domain| {
                domain
                    .trim_start_matches('.')
                    .eq_ignore_ascii_case(QUANTA_HOST)
            })
            // cookies_for_url(QUANTA_ORIGIN) scopes a host-only cookie to the
            // Quanta host, so a missing Domain attribute is safe to clear.
            .unwrap_or(true)
}

/// Revalidate the existing in-memory Moodle session. This only checks `/my/`;
/// expired sessions must use `restart_quanta_session` to clear stale webview
/// session state and open a fresh interactive login.
pub async fn refresh_existing_session(app: AppHandle) -> SessionRefreshResult {
    let state = app.state::<AppState>();
    if state.sync.auth_resetting.load(Ordering::SeqCst) {
        return SessionRefreshResult {
            status: "login_required".into(),
            message: "A Quanta session reset is in progress.".into(),
        };
    }
    let _active = match AtomicFlagReset::try_acquire(
        &state.sync.auth_refreshing,
        "A session check is already in progress.",
    ) {
        Ok(guard) => guard,
        Err(message) => {
            return SessionRefreshResult {
                status: "failed".into(),
                message,
            }
        }
    };
    if state.sync.auth_resetting.load(Ordering::SeqCst) {
        return SessionRefreshResult {
            status: "login_required".into(),
            message: "A Quanta session reset is in progress.".into(),
        };
    }

    let result = async {
        let Some(client) = state.client() else {
            return SessionRefreshResult {
                status: "login_required".into(),
                message: "No active Quanta session is available. Sign in again to continue.".into(),
            };
        };
        let url = match client.origin().join("/my/") {
            Ok(url) => url,
            Err(_) => {
                return SessionRefreshResult {
                    status: "failed".into(),
                    message: "Could not build the Quanta session check request.".into(),
                }
            }
        };

        match tokio::time::timeout(Duration::from_secs(20), client.fetch(&url)).await {
            Ok(Ok(_)) => {
                state.sync.set_auth_state("authenticated");
                *state.sync.last_error.lock().unwrap() = None;
                let _ = app.emit("auth:changed", ());
                if !state.sync.is_running() {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::sync::engine::run_scan(app, "session_refresh").await;
                    });
                }
                SessionRefreshResult {
                    status: "restored".into(),
                    message: "The existing Quanta session is working again.".into(),
                }
            }
            Ok(Err(QuantaError::AuthExpired)) => {
                state.sync.set_auth_state("expired");
                SessionRefreshResult {
                    status: "login_required".into(),
                    message:
                        "Quanta requires interactive sign-in. Log in again to create a new session."
                            .into(),
                }
            }
            Ok(Err(error)) => SessionRefreshResult {
                status: "failed".into(),
                message: format!("Could not verify the Quanta session: {error}"),
            },
            Err(_) => SessionRefreshResult {
                status: "failed".into(),
                message: "The Quanta session check timed out. Check your connection and retry."
                    .into(),
            },
        }
    }
    .await;
    result
}

fn extract_session_cookie(cookie_header: &str) -> Option<String> {
    cookie_header
        .split(';')
        .map(str::trim)
        .find_map(|kv| kv.strip_prefix("MoodleSession=").map(|v| v.to_string()))
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{
        claim_sso_attempt, commit_sso_if_current, extract_session_cookie, is_quanta_session_cookie,
        matching_sso_window_label, take_sso_attempt, AtomicFlagReset, SsoAttempt,
    };
    use std::sync::atomic::{AtomicBool, Ordering};

    fn attempt(
        id: &str,
    ) -> (
        SsoAttempt,
        tokio::sync::watch::Receiver<Option<Result<super::AuthStatus, String>>>,
    ) {
        let (completion, receiver) = tokio::sync::watch::channel(None);
        (
            SsoAttempt {
                id: id.to_string(),
                window_label: format!("quanta-login-{id}"),
                completion,
                terminal: std::sync::Arc::new(AtomicBool::new(false)),
            },
            receiver,
        )
    }

    /// Interactive Windows/WebView2 proof, explicitly opted into by the operator.
    /// Uses no application startup, plugins, auth URL, credentials, or persisted profile.
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires an interactive Windows desktop and WebView2"]
    fn native_blank_window_focus_cancel_delivery() {
        use crate::core::files::FileStore;
        use crate::core::mirror::{Mirror, MirrorConfig};
        use crate::settings::Settings;
        use crate::state::{AppState, SyncControl};
        use std::sync::{Arc, Mutex};
        use std::time::{Duration, Instant};
        use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

        #[link(name = "user32")]
        extern "system" {
            fn IsWindow(hwnd: isize) -> i32;
            fn IsWindowVisible(hwnd: isize) -> i32;
            fn IsIconic(hwnd: isize) -> i32;
            fn GetForegroundWindow() -> isize;
        }
        fn eventually(description: &str, mut check: impl FnMut() -> bool) {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !check() {
                assert!(
                    Instant::now() < deadline,
                    "native assertion timed out: {description}"
                );
                std::thread::sleep(Duration::from_millis(50));
            }
            println!("PASS native: {description}");
        }

        let data = tempfile::tempdir().unwrap();
        let settings = Settings::default();
        let state = AppState {
            conn: Mutex::new(crate::db::open(&data.path().join("proof.sqlite")).unwrap()),
            db_path: data.path().join("proof.sqlite"),
            files: FileStore::new(data.path()),
            mirror: Mirror::new(
                data.path().join("mirror"),
                MirrorConfig::from_settings(&settings),
            ),
            client: Mutex::new(None),
            settings: Mutex::new(settings),
            sync: Arc::new(SyncControl::default()),
        };
        let mut context = tauri::generate_context!();
        context.config_mut().identifier =
            format!("com.quantapulse.b08a.native.{}", std::process::id());
        context.config_mut().app.windows.clear();
        let profile = data.path().join("webview2");
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let app = tauri::Builder::default()
            .any_thread()
            .manage(state)
            .setup(move |app| {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        let state = handle.state::<AppState>();
                        let (a, waiter) = attempt("native-A");
                        let duplicate_waiter = a.completion.subscribe();
                        let a_window = WebviewWindowBuilder::new(
                            &handle, &a.window_label,
                            WebviewUrl::External(url::Url::parse("about:blank").unwrap()),
                        )
                        .title("B08A isolated blank native proof A")
                        .data_directory(profile.clone())
                        .visible(false)
                        .build().unwrap();
                        let a_hwnd = a_window.hwnd().unwrap().0 as isize;
                        assert_eq!(unsafe { IsWindowVisible(a_hwnd) }, 0);
                        *state.sync.sso_lifecycle.lock().unwrap() = Some(a.clone());
                        state.sync.sso_login_active.store(true, Ordering::SeqCst);
                        super::focus_sso_login(&handle, &a.id).unwrap();
                        eventually("A shown and OS foreground via focus_sso_login", || unsafe {
                            IsWindowVisible(a_hwnd) != 0 && GetForegroundWindow() == a_hwnd
                        });
                        a_window.minimize().unwrap();
                        eventually("A minimized", || unsafe { IsIconic(a_hwnd) != 0 });
                        super::focus_sso_login(&handle, &a.id).unwrap();
                        eventually("A restored and OS foreground via focus_sso_login", || unsafe {
                            IsIconic(a_hwnd) == 0 && GetForegroundWindow() == a_hwnd
                        });
                        super::cancel_sso_login(&handle, &a.id).unwrap();
                        eventually("A HWND destroyed via cancel_sso_login", || unsafe { IsWindow(a_hwnd) == 0 });
                        assert!(handle.get_webview_window(&a.window_label).is_none());
                        for receiver in [&waiter, &duplicate_waiter] {
                            assert!(receiver.borrow().as_ref().unwrap().as_ref().unwrap_err().contains("cancelled"));
                        }
                        assert!(state.sync.sso_lifecycle.lock().unwrap().is_none());
                        assert!(!state.sync.sso_login_active.load(Ordering::SeqCst));
                        println!("PASS native: cancellation completes both waiters and releases slot/flag");

                        let (b, b_waiter) = attempt("native-B");
                        let b_window = WebviewWindowBuilder::new(
                            &handle, &b.window_label,
                            WebviewUrl::External(url::Url::parse("about:blank").unwrap()),
                        )
                        .title("B08A isolated blank native proof B")
                        .data_directory(profile)
                        .visible(false)
                        .build().unwrap();
                        let b_hwnd = b_window.hwnd().unwrap().0 as isize;
                        *state.sync.sso_lifecycle.lock().unwrap() = Some(b.clone());
                        state.sync.sso_login_active.store(true, Ordering::SeqCst);
                        for _ in 0..2 {
                            super::focus_sso_login(&handle, &a.id).unwrap();
                            super::cancel_sso_login(&handle, &a.id).unwrap();
                        }
                        // Roundtrip through the native dispatcher before checking stale no-ops.
                        assert!(!b_window.is_visible().unwrap());
                        assert_ne!(unsafe { IsWindow(b_hwnd) }, 0);
                        assert_eq!(unsafe { IsWindowVisible(b_hwnd) }, 0);
                        assert_eq!(super::active_sso_attempt_id(&state).as_deref(), Some(b.id.as_str()));
                        assert!(state.sync.sso_login_active.load(Ordering::SeqCst));
                        assert!(b_waiter.borrow().is_none());
                        assert!(!b.terminal.load(Ordering::SeqCst));
                        println!("PASS native: repeated stale A focus/cancel leaves hidden B HWND, slot, flag, waiter untouched");
                        super::focus_sso_login(&handle, &b.id).unwrap();
                        eventually("successor B shown and OS foreground", || unsafe {
                            IsWindowVisible(b_hwnd) != 0 && GetForegroundWindow() == b_hwnd
                        });
                        // Optional external window-only capture handshake; bounded and test-only.
                        if let Some(marker) = std::env::var_os("B08A_NATIVE_CAPTURE_MARKER") {
                            let marker = std::path::PathBuf::from(marker);
                            std::fs::write(&marker, b_hwnd.to_string()).unwrap();
                            eventually("external window-only capture completed", || marker.with_extension("done").exists());
                        }
                        super::cancel_sso_login(&handle, &b.id).unwrap();
                        eventually("successor B HWND destroyed", || unsafe { IsWindow(b_hwnd) == 0 });
                        assert!(b_waiter.borrow().as_ref().unwrap().is_err());
                        assert!(state.client().is_none());
                        println!("PASS native: no authenticated client installed; blank URLs only");
                    }));
                    done_tx.send(result).unwrap();
                    handle.exit(0);
                });
                Ok(())
            })
            .build(context).unwrap();
        let exit = app.run_return(|_, event| {
            // Closing A must not end the event loop before successor B is built.
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
            }
        });
        assert_eq!(exit, 0);
        if let Err(panic) = done_rx.recv_timeout(Duration::from_secs(5)).unwrap() {
            std::panic::resume_unwind(panic);
        }
        println!(
            "PASS native: event loop exited; isolated data root {}",
            data.path().display()
        );
    }

    #[tokio::test]
    async fn duplicate_starts_share_one_attempt_and_one_completion() {
        let (owner, first) = attempt("A");
        let second = owner.completion.subscribe();
        assert_eq!(owner.id, "A");
        assert_eq!(owner.window_label, "quanta-login-A");
        assert!(owner.publish(Err("finished".into())));
        assert_eq!(
            first.borrow().as_ref().unwrap().as_ref().unwrap_err(),
            "finished"
        );
        assert_eq!(
            second.borrow().as_ref().unwrap().as_ref().unwrap_err(),
            "finished"
        );
    }

    #[tokio::test]
    async fn cancelled_attempt_cannot_publish_over_successor_or_be_targeted_stale() {
        let (a, a_waiter) = attempt("A");
        let mut slot = Some(a.clone());
        let cancelled = take_sso_attempt(&mut slot, "A").unwrap();
        assert!(cancelled.publish(Err("cancelled".into())));
        let (b, _b_waiter) = attempt("B");
        slot = Some(b);
        assert!(take_sso_attempt(&mut slot, "A").is_none());
        assert_eq!(slot.as_ref().unwrap().id, "B");
        assert!(!a.publish(Err("late verification".into())));
        assert_eq!(
            a_waiter.borrow().as_ref().unwrap().as_ref().unwrap_err(),
            "cancelled"
        );
        assert_eq!(slot.as_ref().unwrap().window_label, "quanta-login-B");
    }

    #[test]
    fn verified_session_install_callback_is_fenced_by_current_attempt() {
        let (a, _receiver) = attempt("A");
        let lifecycle = std::sync::Mutex::new(Some(a));
        let installs = std::sync::atomic::AtomicUsize::new(0);
        assert!(commit_sso_if_current(&lifecycle, "A", || {
            installs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        assert_eq!(installs.load(std::sync::atomic::Ordering::SeqCst), 1);
        take_sso_attempt(&mut lifecycle.lock().unwrap(), "A");
        let (b, _receiver) = attempt("B");
        *lifecycle.lock().unwrap() = Some(b);
        assert!(!commit_sso_if_current(&lifecycle, "A", || {
            installs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        assert_eq!(installs.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn stale_focus_and_close_operations_cannot_target_successor_window() {
        let (a, _receiver) = attempt("A");
        let mut slot = Some(a);
        assert_eq!(
            matching_sso_window_label(&slot, "A").as_deref(),
            Some("quanta-login-A")
        );
        take_sso_attempt(&mut slot, "A");
        let (b, _receiver) = attempt("B");
        slot = Some(b);
        let mut fake_window_operations = Vec::new();
        if let Some(label) = matching_sso_window_label(&slot, "A") {
            fake_window_operations.push(("focus", label));
        }
        if let Some(attempt) = take_sso_attempt(&mut slot, "A") {
            fake_window_operations.push(("close", attempt.window_label));
        }
        assert!(fake_window_operations.is_empty());
        assert_eq!(slot.as_ref().unwrap().id, "B");
        assert_eq!(
            matching_sso_window_label(&slot, "B").as_deref(),
            Some("quanta-login-B")
        );
    }

    #[test]
    fn reset_waiting_after_false_gate_claim_cancels_the_claimed_attempt() {
        let lifecycle = std::sync::Arc::new(std::sync::Mutex::new(None));
        let resetting = std::sync::Arc::new(AtomicBool::new(false));
        let (a, waiter) = attempt("A");
        let mut guard = lifecycle.lock().unwrap();
        assert!(
            claim_sso_attempt(&mut guard, &resetting, a.clone())
                .unwrap()
                .1
        );
        let (locked_tx, locked_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let reset_lifecycle = lifecycle.clone();
        let reset_gate = resetting.clone();
        let reset_thread = std::thread::spawn(move || {
            reset_gate.store(true, Ordering::SeqCst);
            locked_tx.send(()).unwrap();
            let mut slot = reset_lifecycle.lock().unwrap();
            let cancelled = take_sso_attempt(&mut slot, "A").unwrap();
            cancelled.publish(Err("reset".into()));
            done_tx.send(()).unwrap();
        });
        locked_rx.recv().unwrap();
        // The reset has raised the gate and is blocked on the lifecycle lock.
        assert!(resetting.load(Ordering::SeqCst));
        drop(guard);
        done_rx.recv().unwrap();
        reset_thread.join().unwrap();
        assert!(lifecycle.lock().unwrap().is_none());
        assert_eq!(
            waiter.borrow().as_ref().unwrap().as_ref().unwrap_err(),
            "reset"
        );
    }

    #[test]
    fn reset_gate_first_rejects_start_claim() {
        let mut slot = None;
        let resetting = AtomicBool::new(true);
        let (candidate, _) = attempt("A");
        assert!(claim_sso_attempt(&mut slot, &resetting, candidate).is_err());
        assert!(slot.is_none());
    }

    #[test]
    fn delayed_close_delivers_captured_a_label_without_affecting_b() {
        let (a, _a_waiter) = attempt("A");
        let mut slot = Some(a);
        let captured = take_sso_attempt(&mut slot, "A").unwrap();
        let (b, b_waiter) = attempt("B");
        slot = Some(b);
        let mut closed_labels = Vec::new();
        closed_labels.push(captured.window_label.clone()); // delayed fake sink delivery
        assert_eq!(closed_labels, ["quanta-login-A"]);
        assert_eq!(slot.as_ref().unwrap().id, "B");
        assert!(!slot.as_ref().unwrap().terminal.load(Ordering::SeqCst));
        assert!(b_waiter.borrow().is_none());
    }

    #[tokio::test]
    async fn terminal_completion_is_one_shot_for_timeout_window_close_and_reset() {
        for (id, reason) in [
            ("timeout", "timed out"),
            ("close", "window closed"),
            ("reset", "reset"),
        ] {
            let (attempt, waiter) = attempt(id);
            assert!(attempt.publish(Err(reason.into())));
            assert!(!attempt.publish(Err("owner returned late".into())));
            assert_eq!(
                waiter.borrow().as_ref().unwrap().as_ref().unwrap_err(),
                reason
            );
        }
    }

    #[test]
    fn extracts_session_cookie_from_jar_header() {
        let header = "MOODLEID1_=abc; MoodleSession=deadbeef123; other=1";
        assert_eq!(
            extract_session_cookie(header).as_deref(),
            Some("deadbeef123")
        );
        assert_eq!(extract_session_cookie("nothing=here"), None);
    }

    #[test]
    fn concurrent_sso_attempts_cannot_open_overlapping_windows() {
        let active = AtomicBool::new(false);
        let first = AtomicFlagReset::try_acquire(&active, "already active").unwrap();
        assert!(AtomicFlagReset::try_acquire(&active, "already active").is_err());
        drop(first);
        assert!(AtomicFlagReset::try_acquire(&active, "already active").is_ok());
    }

    #[test]
    fn reset_cookie_filter_only_clears_quanta_host_session_cookie() {
        assert!(is_quanta_session_cookie("MoodleSession", None));
        assert!(is_quanta_session_cookie(
            "moodlesession",
            Some(".quanta.bits-pilani.ac.in")
        ));
        assert!(!is_quanta_session_cookie(
            "MoodleSession",
            Some(".bits-pilani.ac.in")
        ));
        assert!(!is_quanta_session_cookie(
            "MoodleSession",
            Some("accounts.google.com")
        ));
        assert!(!is_quanta_session_cookie(
            "session",
            Some("quanta.bits-pilani.ac.in")
        ));
    }
}

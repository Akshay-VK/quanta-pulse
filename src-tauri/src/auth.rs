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

use std::sync::Arc;
use std::sync::atomic::Ordering;
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

enum SsoLoginFailure {
    LoginRequired(String),
    Failed(String),
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
    let login_url = origin
        .join("/login/index.php")
        .map_err(|e| e.to_string())?;

    let page = http
        .get(login_url.clone())
        .send()
        .await
        .map_err(|e| format!("Could not reach Quanta: {e}"))?;
    if !page.status().is_success() {
        return Err(format!("Quanta's login page returned {}", page.status()));
    }
    let body = page.text().await.map_err(|e| e.to_string())?;
    let token = parse::parse_login_token(&body)
        .ok_or("Quanta's login form could not be read.")?;

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
        if final_url.path().starts_with("/auth/") || lower.contains("saml") || lower.contains("google") {
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
    let status = finalize_session(&app, session).await?;
    resume_monitoring(app.clone(), "login");
    Ok(status)
}

/* --------------------------------------------------------------- SSO flow */

pub async fn start_sso_login(app: AppHandle) -> Result<AuthStatus, String> {
    let state = app.state::<AppState>();
    if state.sync.auth_resetting.load(Ordering::SeqCst) {
        return Err("Quanta session reset is in progress. Try signing in again shortly.".into());
    }
    let _active = AtomicFlagReset::try_acquire(
        &state.sync.sso_login_active,
        "A Quanta sign-in is already in progress. Finish it in the open sign-in window.",
    )?;

    if state.sync.auth_resetting.load(Ordering::SeqCst) {
        return Err("Quanta session reset is in progress. Try signing in again shortly.".into());
    }

    let status = run_sso_login_inner(&app).await.map_err(SsoLoginFailure::message)?;
    resume_monitoring(app.clone(), "login");
    Ok(status)
}

async fn run_sso_login_inner(app: &AppHandle) -> Result<AuthStatus, SsoLoginFailure> {

    let url = Url::parse(SSO_URL).map_err(|e| SsoLoginFailure::Failed(e.to_string()))?;

    if app.get_webview_window(SSO_WINDOW_LABEL).is_some() {
        return Err(SsoLoginFailure::Failed(
            "The Quanta sign-in window is already open.".to_string(),
        ));
    }

    let window = WebviewWindowBuilder::new(app, SSO_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Sign in to Quanta")
        .inner_size(520.0, 720.0)
        .resizable(true)
        .build()
        .map_err(|e| SsoLoginFailure::Failed(format!("Could not open the sign-in window: {e}")))?;

    let deadline = Instant::now() + SSO_TIMEOUT;
    let mut found: Option<String> = None;
    let mut failure: Option<SsoLoginFailure> = None;

    while Instant::now() < deadline {
        if app.get_webview_window(SSO_WINDOW_LABEL).is_none() {
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
            if host == QUANTA_HOST
                && !path.starts_with("/login")
                && !path.starts_with("/auth/")
            {
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

    if app.get_webview_window(SSO_WINDOW_LABEL).is_some() {
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
    finalize_session(app, session).await.map_err(|message| {
        if message == "Sign-in did not establish a usable session." {
            SsoLoginFailure::LoginRequired(message)
        } else {
            SsoLoginFailure::Failed(message)
        }
    })
}

/* ---------------------------------------------------------------- shared */

async fn finalize_session(app: &AppHandle, session: SessionInfo) -> Result<AuthStatus, String> {
    let timeout = app.state::<AppState>().settings().request_timeout_secs;
    let client = Arc::new(
        QuantaClient::from_session(session.clone(), timeout).map_err(|e| e.to_string())?,
    );

    // Verify the session actually works before storing it.
    let my = client
        .origin()
        .join("/my/")
        .map_err(|e| e.to_string())?;
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

    {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let _ = db::set_kv(&conn, "current_email", &session.email);
        state.set_client(Some(client));
        state.sync.set_auth_state("authenticated");
        *state.sync.last_error.lock().unwrap() = None;
    }

    let _ = app.emit("auth:changed", ());

    let state = app.state::<AppState>();
    Ok(auth_status(&state))
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
    if let Some(window) = app.get_webview_window(SSO_WINDOW_LABEL) {
        if let Err(error) = window.close() {
            return reset_result(
                "failed",
                format!("Could not close the stale Quanta sign-in window: {error}"),
            );
        }
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
    let flow_result = {
        let _sso = match AtomicFlagReset::try_acquire(
            &state.sync.sso_login_active,
            "A Quanta sign-in is already in progress.",
        ) {
            Ok(guard) => guard,
            Err(message) => return reset_result("failed", message),
        };
        run_sso_login_inner(app).await
    };

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
            .map(|domain| domain.trim_start_matches('.').eq_ignore_ascii_case(QUANTA_HOST))
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
            Err(_) => return SessionRefreshResult {
                status: "failed".into(),
                message: "Could not build the Quanta session check request.".into(),
            },
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
                    message: "Quanta requires interactive sign-in. Log in again to create a new session.".into(),
                }
            }
            Ok(Err(error)) => SessionRefreshResult {
                status: "failed".into(),
                message: format!("Could not verify the Quanta session: {error}"),
            },
            Err(_) => SessionRefreshResult {
                status: "failed".into(),
                message: "The Quanta session check timed out. Check your connection and retry.".into(),
            },
        }
    }.await;
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
    use super::{extract_session_cookie, is_quanta_session_cookie, AtomicFlagReset};
    use std::sync::atomic::AtomicBool;

    #[test]
    fn extracts_session_cookie_from_jar_header() {
        let header = "MOODLEID1_=abc; MoodleSession=deadbeef123; other=1";
        assert_eq!(extract_session_cookie(header).as_deref(), Some("deadbeef123"));
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

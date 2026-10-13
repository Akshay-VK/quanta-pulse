//! Authenticated HTTP client for Quanta.
//!
//! Quanta Pulse keeps the Moodle session cookie in memory only. It never sends credentials anywhere except the official
//! Quanta origin.

use std::sync::Arc;
use std::time::Duration;

use reqwest::cookie::{CookieStore, Jar};
use reqwest::{Client, StatusCode};
use url::Url;

use crate::quanta::parse::looks_like_login_page;

pub const QUANTA_ORIGIN: &str = "https://quanta.bits-pilani.ac.in";

#[derive(Debug, thiserror::Error)]
pub enum QuantaError {
    #[error("network error: {0}")]
    Network(String),
    #[error("Quanta returned a temporary server error ({0})")]
    Server(u16),
    #[error("session expired: authentication required")]
    AuthExpired,
    #[error("resource is not accessible ({0})")]
    NotAccessible(u16),
    #[error("client error: {0}")]
    Client(String),
}

impl QuantaError {
    /// Whether retrying the same request later could plausibly succeed.
    pub fn is_transient(&self) -> bool {
        matches!(self, QuantaError::Network(_) | QuantaError::Server(_))
    }
}

/// The minimal state needed to re-establish an authenticated session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionInfo {
    pub email: String,
    pub method: String,
    pub user_id: Option<i64>,
    pub fullname: Option<String>,
    /// The `MoodleSession` cookie value.
    pub session_cookie: String,
    pub sesskey: Option<String>,
    pub acquired_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct Fetched {
    pub status: u16,
    pub final_url: String,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_length: Option<i64>,
    pub body: String,
}

impl Fetched {
    pub fn is_html(&self) -> bool {
        self.content_type
            .as_deref()
            .map(|c| c.contains("text/html") || c.contains("application/xhtml"))
            .unwrap_or(true)
    }
}

/// A binary (or text) response body read with an explicit byte ceiling.
#[derive(Debug, Clone, Default)]
pub struct FetchedBinary {
    pub status: u16,
    pub final_url: String,
    pub content_type: Option<String>,
    /// `true` when the body was cut off because it exceeded `max_bytes`.
    pub truncated: bool,
    /// The advertised content length, when the server provided one.
    pub content_length: Option<i64>,
    pub bytes: Vec<u8>,
}

pub struct QuantaClient {
    http: Client,
    jar: Arc<Jar>,
    origin: Url,
    pub session: SessionInfo,
}

impl QuantaClient {
    /// Build a client seeded with an existing session cookie.
    pub fn from_session(session: SessionInfo, timeout_secs: u64) -> Result<Self, QuantaError> {
        let origin = Url::parse(QUANTA_ORIGIN).expect("valid origin");
        let jar = Arc::new(Jar::default());
        let cookie = format!(
            "MoodleSession={}; Domain={}; Path=/; Secure; HttpOnly",
            session.session_cookie, "quanta.bits-pilani.ac.in"
        );
        jar.add_cookie_str(&cookie, &origin);

        let http = Client::builder()
            .user_agent(concat!("QuantaPulse/", env!("CARGO_PKG_VERSION")))
            .cookie_provider(jar.clone())
            .timeout(Duration::from_secs(timeout_secs))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .gzip(true)
            .brotli(true)
            .build()
            .map_err(|e| QuantaError::Client(e.to_string()))?;

        Ok(QuantaClient {
            http,
            jar,
            origin,
            session,
        })
    }

    /// Build a fresh, unauthenticated client (used for the credential login).
    pub fn anonymous(timeout_secs: u64) -> Result<(Client, Arc<Jar>), QuantaError> {
        let jar = Arc::new(Jar::default());
        let http = Client::builder()
            .user_agent(concat!("QuantaPulse/", env!("CARGO_PKG_VERSION")))
            .cookie_provider(jar.clone())
            .timeout(Duration::from_secs(timeout_secs))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| QuantaError::Client(e.to_string()))?;
        Ok((http, jar))
    }

    pub fn origin(&self) -> &Url {
        &self.origin
    }

    /// The cookie header value for the session cookie, if the jar still holds it.
    pub fn session_cookie_header(&self) -> Option<String> {
        self.jar
            .cookies(&self.origin)
            .and_then(|v| v.to_str().ok().map(|s| s.to_string()))
    }

    /// GET a page, returning its body and headers.
    pub async fn fetch(&self, url: &Url) -> Result<Fetched, QuantaError> {
        let resp = self
            .http
            .get(url.clone())
            .send()
            .await
            .map_err(|e| QuantaError::Network(e.to_string()))?;

        let status = resp.status();
        let final_url = resp.url().to_string();
        let headers = resp.headers().clone();

        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(QuantaError::AuthExpired);
        }
        if status.is_server_error() {
            return Err(QuantaError::Server(status.as_u16()));
        }
        if status == StatusCode::NOT_FOUND {
            return Err(QuantaError::NotAccessible(404));
        }

        let body = resp
            .text()
            .await
            .map_err(|e| QuantaError::Network(e.to_string()))?;

        // Moodle redirects unauthenticated users to the login page.
        if final_url.contains("/login/index.php") || looks_like_login_page(&body) {
            return Err(QuantaError::AuthExpired);
        }

        Ok(Fetched {
            status: status.as_u16(),
            final_url,
            content_type: header(&headers, "content-type"),
            etag: header(&headers, "etag"),
            last_modified: header(&headers, "last-modified"),
            content_length: header(&headers, "content-length").and_then(|v| v.parse().ok()),
            body,
        })
    }

    /// GET a resource as raw bytes, never reading more than `max_bytes`.
    ///
    /// Used by the on-demand preview command: the caller decides whether the
    /// body is renderable (PDF, image, media, HTML/text) from the returned
    /// content type. Auth/status handling mirrors [`fetch`], and an HTML body
    /// that looks like the login page still reports `AuthExpired`.
    pub async fn fetch_bytes(
        &self,
        url: &Url,
        max_bytes: usize,
    ) -> Result<FetchedBinary, QuantaError> {
        let mut resp = self
            .http
            .get(url.clone())
            .send()
            .await
            .map_err(|e| QuantaError::Network(e.to_string()))?;

        let status = resp.status();
        let final_url = resp.url().to_string();
        let headers = resp.headers().clone();

        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(QuantaError::AuthExpired);
        }
        if status.is_server_error() {
            return Err(QuantaError::Server(status.as_u16()));
        }
        if status == StatusCode::NOT_FOUND {
            return Err(QuantaError::NotAccessible(404));
        }

        let content_type = header(&headers, "content-type");
        let content_length = header(&headers, "content-length").and_then(|v| v.parse().ok());
        let is_html = content_type
            .as_deref()
            .map(|c| c.contains("text/html") || c.contains("application/xhtml"))
            .unwrap_or(true);

        if final_url.contains("/login/index.php") {
            return Err(QuantaError::AuthExpired);
        }

        let mut bytes: Vec<u8> = Vec::new();
        let mut truncated = false;
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| QuantaError::Network(e.to_string()))?
        {
            if bytes.len() + chunk.len() > max_bytes {
                let remaining = max_bytes.saturating_sub(bytes.len());
                bytes.extend_from_slice(&chunk[..remaining]);
                truncated = true;
                break;
            }
            bytes.extend_from_slice(&chunk);
        }

        // Only an untruncated HTML body can be identified as Moodle's login
        // page; binary payloads are never login pages.
        if is_html && !truncated {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                if looks_like_login_page(text) {
                    return Err(QuantaError::AuthExpired);
                }
            }
        }

        Ok(FetchedBinary {
            status: status.as_u16(),
            final_url,
            content_type,
            truncated,
            content_length,
            bytes,
        })
    }

    /// HEAD a file to read metadata without downloading the body.
    pub async fn head(&self, url: &Url) -> Result<Fetched, QuantaError> {
        let resp = self
            .http
            .head(url.clone())
            .send()
            .await
            .map_err(|e| QuantaError::Network(e.to_string()))?;
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(QuantaError::AuthExpired);
        }
        if status.is_server_error() {
            return Err(QuantaError::Server(status.as_u16()));
        }
        let headers = resp.headers().clone();
        Ok(Fetched {
            status: status.as_u16(),
            final_url: resp.url().to_string(),
            content_type: header(&headers, "content-type"),
            etag: header(&headers, "etag"),
            last_modified: header(&headers, "last-modified"),
            content_length: header(&headers, "content-length").and_then(|v| v.parse().ok()),
            body: String::new(),
        })
    }
}

fn header(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

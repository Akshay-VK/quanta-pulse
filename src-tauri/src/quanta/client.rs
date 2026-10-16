//! Authenticated HTTP client for Quanta.
//!
//! Quanta Pulse keeps the Moodle session cookie in memory only. It never sends credentials anywhere except the official
//! Quanta origin.

use std::io::Write;
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
    #[error("file is larger than the download limit")]
    TooLarge,
    /// The server rejected the resumed range: the file changed under us. The
    /// caller restarts from zero.
    #[error("the partial download no longer matches the file on the server")]
    StaleResume,
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

/// A download whose headers have arrived but whose body has not been read.
///
/// Two-phase on purpose: the filename usually lives in `Content-Disposition`,
/// which is only known after the request is sent, and the mirror needs it before
/// it can create the target file.
#[derive(Debug, Default)]
pub struct DownloadResponse {
    pub status: u16,
    pub final_url: String,
    pub content_type: Option<String>,
    /// The raw `Content-Disposition` header, for filename extraction.
    pub content_disposition: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_length: Option<i64>,
    /// The server confirmed nothing changed; there is no body to read.
    pub not_modified: bool,
    /// The server honoured the `Range` request, so the body is only the tail.
    pub resumed: bool,
    resp: Option<reqwest::Response>,
}

/// Knobs for a resumable, conditional download.
#[derive(Debug, Clone, Default)]
pub struct DownloadRequest {
    /// Byte offset to continue from. Adds `Range: bytes=<n>-`.
    pub resume_from: u64,
    /// With `resume_from`, `If-Range` makes the server send the whole body
    /// again instead of the tail when the file has changed since we started.
    pub if_range: Option<String>,
    /// Conditional revalidation for a download that starts from zero.
    pub if_none_match: Option<String>,
    pub if_modified_since: Option<String>,
}

/// Chunk of an HTML body buffered before deciding whether it is the login page.
/// Moodle's login form sits near the top of the document, well inside this.
const LOGIN_SNIFF_BYTES: usize = 64 * 1024;

pub struct QuantaClient {
    http: Client,
    /// A second client for downloads: same cookies, but no overall request
    /// timeout, because a lecture recording legitimately takes longer than the
    /// API timeout. Stalls are detected per chunk instead.
    download_http: Client,
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

        // Same cookie jar, no total timeout: see the field comment.
        let download_http = Client::builder()
            .user_agent(concat!("QuantaPulse/", env!("CARGO_PKG_VERSION")))
            .cookie_provider(jar.clone())
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| QuantaError::Client(e.to_string()))?;

        Ok(QuantaClient {
            http,
            download_http,
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

    /// Open a download: send the request, validate the response, and hand back
    /// the headers so the caller can name the file before reading the body.
    ///
    /// Auth and status handling mirror [`fetch_bytes`], except that the body is
    /// never buffered here — a 500 MB recording must not pass through memory.
    pub async fn download(
        &self,
        url: &Url,
        req: &DownloadRequest,
    ) -> Result<DownloadResponse, QuantaError> {
        let mut builder = self.download_http.get(url.clone());
        if req.resume_from > 0 {
            builder = builder.header(reqwest::header::RANGE, format!("bytes={}-", req.resume_from));
            if let Some(tag) = req.if_range.as_deref().filter(|t| !t.trim().is_empty()) {
                builder = builder.header(reqwest::header::IF_RANGE, tag);
            }
        } else {
            if let Some(tag) = req.if_none_match.as_deref().filter(|t| !t.trim().is_empty()) {
                builder = builder.header(reqwest::header::IF_NONE_MATCH, tag);
            }
            if let Some(since) = req
                .if_modified_since
                .as_deref()
                .filter(|t| !t.trim().is_empty())
            {
                builder = builder.header(reqwest::header::IF_MODIFIED_SINCE, since);
            }
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| QuantaError::Network(e.to_string()))?;

        let status = resp.status();
        let final_url = resp.url().to_string();
        let headers = resp.headers().clone();

        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(QuantaError::AuthExpired);
        }
        // 429 is not an error status to reqwest, but it is a "come back later".
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(QuantaError::Server(429));
        }
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            return Err(QuantaError::StaleResume);
        }
        if status.is_server_error() {
            return Err(QuantaError::Server(status.as_u16()));
        }
        if status == StatusCode::NOT_FOUND {
            return Err(QuantaError::NotAccessible(404));
        }
        if final_url.contains("/login/index.php") {
            return Err(QuantaError::AuthExpired);
        }

        let not_modified = status == StatusCode::NOT_MODIFIED;
        Ok(DownloadResponse {
            status: status.as_u16(),
            final_url,
            content_type: header(&headers, "content-type"),
            content_disposition: header(&headers, "content-disposition"),
            etag: header(&headers, "etag"),
            last_modified: header(&headers, "last-modified"),
            content_length: header(&headers, "content-length").and_then(|v| v.parse().ok()),
            not_modified,
            resumed: status == StatusCode::PARTIAL_CONTENT,
            resp: if not_modified { None } else { Some(resp) },
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

impl DownloadResponse {
    /// Whether the body is an HTML document, i.e. possibly Moodle's login page
    /// where a file was expected.
    fn is_html(&self) -> bool {
        self.content_type
            .as_deref()
            .map(|c| {
                let c = c.to_ascii_lowercase();
                c.contains("text/html") || c.contains("application/xhtml")
            })
            .unwrap_or(false)
    }

    /// Stream the body into `sink`, returning the bytes written.
    ///
    /// Three things happen here that a plain `bytes().await` would not do:
    ///
    /// - **Stall detection.** No chunk for `stall` ends the transfer with a
    ///   transient error, so a dead connection is retried instead of hanging.
    /// - **Login-page detection.** Moodle answers an expired session with HTTP
    ///   200 and its login form, which would otherwise be saved as the file. The
    ///   first [`LOGIN_SNIFF_BYTES`] are buffered and checked; a match is an auth
    ///   failure, so the caller can wait for a sign-in instead of storing junk.
    /// - **A size ceiling.** `max_bytes` of 0 means no limit. Exceeding it is
    ///   [`QuantaError::TooLarge`], which the caller reports as "skipped", not a
    ///   failure.
    pub async fn stream_to(
        &mut self,
        sink: &mut (dyn Write + Send),
        max_bytes: u64,
        stall: Duration,
    ) -> Result<u64, QuantaError> {
        let is_html = self.is_html();
        let Some(resp) = self.resp.as_mut() else {
            return Ok(0);
        };

        let mut written: u64 = 0;
        let mut sniffer: Vec<u8> = Vec::new();
        let mut sniffing = true;

        loop {
            let chunk = match tokio::time::timeout(stall, resp.chunk()).await {
                Err(_) => return Err(QuantaError::Network("the download stalled".into())),
                Ok(Err(e)) => return Err(QuantaError::Network(e.to_string())),
                Ok(Ok(c)) => c,
            };
            let at_end = chunk.is_none();

            if sniffing {
                if let Some(c) = chunk.as_ref() {
                    sniffer.extend_from_slice(c);
                }
                // Decide once the buffer is big enough, or at the end of a short
                // body — never on a partial document that would hide the form.
                if !at_end && sniffer.len() < LOGIN_SNIFF_BYTES {
                    continue;
                }
                if is_html {
                    let text = String::from_utf8_lossy(&sniffer);
                    if looks_like_login_page(&text) {
                        return Err(QuantaError::AuthExpired);
                    }
                }
                sniffing = false;
                written += write_all_within(sink, &sniffer, max_bytes, written)?;
                if at_end {
                    break;
                }
                continue;
            }

            match chunk {
                None => break,
                Some(c) => written += write_all_within(sink, &c, max_bytes, written)?,
            }
        }

        Ok(written)
    }
}

/// Write a whole chunk, refusing to blow past `max_bytes`.
fn write_all_within(
    sink: &mut (dyn Write + Send),
    bytes: &[u8],
    max_bytes: u64,
    already: u64,
) -> Result<u64, QuantaError> {
    if max_bytes > 0 && already + bytes.len() as u64 > max_bytes {
        return Err(QuantaError::TooLarge);
    }
    sink.write_all(bytes)
        .map_err(|e| QuantaError::Client(format!("could not write the file: {e}")))?;
    Ok(bytes.len() as u64)
}

fn header(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

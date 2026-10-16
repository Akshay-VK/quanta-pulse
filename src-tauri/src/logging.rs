//! Structured logging with automatic redaction of authentication material.
//!
//! Logs are written to `<Application Support>/Quanta Pulse/logs/`. Anything that
//! looks like a session cookie, token, or password is redacted before it is
//! written, so troubleshooting logs are safe to share.

use std::sync::{Arc, Mutex, OnceLock};

use tauri::Manager;

static LOG_DIR: OnceLock<std::path::PathBuf> = OnceLock::new();

/// Values that must never appear in logs.
const SENSITIVE_MARKERS: &[&str] = &[
    "MoodleSession=",
    "moodlesession",
    "wstoken",
    "sesskey=",
    "password",
    "authorization:",
    "sid=",
    // A Telegram bot token travels inside the request URL, and a Bot API error
    // quotes that URL back.
    "api.telegram.org",
    "telegram_bot_token",
];

/// Redact any line that could contain credentials or session material.
pub fn redact(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(&marker.to_ascii_lowercase()))
    {
        return "[redacted: potential credential or session material]".to_string();
    }
    line.to_string()
}

pub fn log_dir() -> Option<std::path::PathBuf> {
    LOG_DIR.get().cloned()
}

/// Initialise file logging. Safe to call once; subsequent calls are ignored.
pub fn init(app: &tauri::AppHandle) {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let _ = LOG_DIR.set(dir.clone());

    let file_appender = tracing_appender::rolling::daily(&dir, "quanta-pulse.log");
    let appender = Arc::new(Mutex::new(file_appender));
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(move || RedactingWriter(appender.clone()))
        .try_init();
}

/// A writer adapter that redacts sensitive content line by line.
#[derive(Clone)]
struct RedactingWriter(Arc<Mutex<tracing_appender::rolling::RollingFileAppender>>);

impl std::io::Write for RedactingWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let text = String::from_utf8_lossy(buf);
        let safe = text
            .lines()
            .map(redact)
            .collect::<Vec<_>>()
            .join("\n");
        let mut file = self.0.lock().unwrap();
        file.write_all(safe.as_bytes())?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.0.lock().unwrap().flush()
    }
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redacts_session_cookie_lines() {
        assert!(redact("Set-Cookie: MoodleSession=abc123; path=/").contains("redacted"));
        assert!(redact("sending sesskey=deadbeef to server").contains("redacted"));
        assert!(redact("password=hunter2").contains("redacted"));
    }

    #[test]
    fn redacts_the_telegram_token_url() {
        // A Bot API error quotes the request URL, and the URL carries the token.
        assert!(redact(
            "telegram poll failed: error sending request for url (https://api.telegram.org/bot123:AAHdqTcvCH1vGWJxfSeof/getUpdates)"
        )
        .contains("redacted"));
        assert!(redact("telegram_bot_token=123:AAH").contains("redacted"));
    }

    #[test]
    fn keeps_ordinary_lines() {
        let line = "synced 42 resources across 5 courses";
        assert_eq!(redact(line), line);
    }
}

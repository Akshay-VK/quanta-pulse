//! Telegram: the bot API client, the command surface, and the message text.
//!
//! The Telegram account is the user's own bot (created with @BotFather), so the
//! only host ever contacted is `api.telegram.org`, and the only secret is the
//! token the user pasted. Files are never uploaded from Quanta: `/get` waits for
//! the local mirror (`Mirror::ensure_local`) and sends that copy, so the bot
//! works offline and never doubles the load on Quanta.
//!
//! Forwarding is per category and reuses the six category switches Settings
//! already shows under Notifications — the bot never has a second, hidden set of
//! filters.

use std::path::Path;
use std::time::Duration;

use reqwest::multipart;
use reqwest::Client;
use serde::Deserialize;

use super::search::SearchHit;
use crate::models::{ChangeEvent, MirrorStats};
use crate::settings::Settings;

/// The Bot API host. Nothing else is ever contacted.
const API_ROOT: &str = "https://api.telegram.org";

/// The Bot API refuses `sendDocument` above 50 MB. Larger files get a message
/// with the path instead of an upload.
pub const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;

/// A command the bot understands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Help,
    Status,
    Search(String),
    Get(String),
    Unknown(String),
}

/// Parse a message into a command. `None` means ordinary text, not a command.
///
/// The `@botname` suffix Telegram adds in group chats is stripped, and the
/// command name is matched case-insensitively, both as the Bot API documents.
pub fn parse_command(text: &str) -> Option<Command> {
    let rest = text.trim().strip_prefix('/')?;
    let (head, args) = match rest.split_once(char::is_whitespace) {
        Some((head, args)) => (head, args.trim()),
        None => (rest, ""),
    };
    let head = head.split('@').next().unwrap_or(head).to_ascii_lowercase();
    Some(match head.as_str() {
        "start" | "help" => Command::Help,
        "status" => Command::Status,
        "search" | "find" => Command::Search(args.to_string()),
        "get" => Command::Get(args.to_string()),
        other => Command::Unknown(other.to_string()),
    })
}

/// Whether this event is forwarded to Telegram. The six category switches in
/// Settings decide, exactly as they do for native notifications.
pub fn forwards(settings: &Settings, change_type: &str) -> bool {
    settings.telegram_enabled && crate::notify::category_enabled(settings, change_type)
}

/// Whether Telegram is configured enough to talk to the API at all.
pub fn is_configured(settings: &Settings) -> bool {
    settings.telegram_bot_token.is_some() && settings.telegram_chat_id.is_some()
}

pub fn help_text() -> String {
    [
        "Quanta Pulse bot",
        "",
        "/search <words> — find material and get its id",
        "/get <id> — send the file",
        "/status — mirror and queue",
        "",
        "Files come from the local mirror on this computer, so they are instant \
         and work offline.",
    ]
    .join("\n")
}

/// Telegram's caption ceiling is 1024 characters; keep a little headroom.
const CAPTION_MAX_CHARS: usize = 1000;

/// One change event as a file caption: the same title and body the native
/// banner shows, without the link — the attached file is the point, so a URL
/// would only be a second, worse way to reach the same bytes.
pub fn event_caption(event: &ChangeEvent) -> String {
    let (title, body) = crate::notify::event_text(event);
    clip(format!("{title}\n{body}"), CAPTION_MAX_CHARS)
}

/// One change event as plain text, for the cases with no file to attach: an
/// external link, or a download that failed or is too large to send.
pub fn event_message(event: &ChangeEvent) -> String {
    let mut out = event_caption(event);
    if let Some(url) = event.resource_url.as_deref() {
        out.push('\n');
        out.push_str(url);
    }
    out
}

/// Trim to `max` characters, on a character boundary, with an ellipsis.
fn clip(text: String, max: usize) -> String {
    if text.chars().count() <= max {
        return text;
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Search results as a Telegram reply, one hit per line, id included so `/get`
/// can follow.
pub fn search_reply(hits: &[SearchHit]) -> String {
    if hits.is_empty() {
        return "No matches.".to_string();
    }
    let mut lines = Vec::with_capacity(hits.len() + 2);
    for hit in hits {
        let course = hit.course.as_deref().unwrap_or("");
        let local = if hit.local { " · local" } else { "" };
        lines.push(format!("#{} {}{}\n    {course}", hit.resource_id, hit.title, local));
    }
    lines.push(String::new());
    lines.push("/get <id> sends a file.".to_string());
    lines.join("\n")
}

/// Mirror state as a Telegram reply. Counts only: no paths, no byte maths.
pub fn status_text(stats: &MirrorStats) -> String {
    format!(
        "Mirror: {} of {} files saved\nQueue: {} queued, {} downloading, {} failed, {} kept\nState: {}",
        stats.done,
        stats.total_resources,
        stats.queued,
        stats.downloading,
        stats.failed,
        stats.kept,
        stats.state,
    )
}

/* ------------------------------------------------------------------ client */

/// The subset of an update the bot needs.
#[derive(Debug, Clone, Deserialize)]
pub struct Update {
    pub update_id: i64,
    pub message: Option<Message>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Message {
    pub chat: Chat,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Chat {
    pub id: i64,
}

impl Update {
    /// The chat this update came from, as settings store it (numeric string).
    pub fn chat_id(&self) -> Option<String> {
        self.message.as_ref().map(|m| m.chat.id.to_string())
    }

    pub fn text(&self) -> Option<&str> {
        self.message.as_ref().and_then(|m| m.text.as_deref())
    }
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

impl<T> Envelope<T> {
    fn into_result(self) -> Result<T, String> {
        if self.ok {
            self.result
                .ok_or_else(|| "Telegram returned no result.".to_string())
        } else {
            Err(self
                .description
                .unwrap_or_else(|| "Telegram rejected the request.".to_string()))
        }
    }
}

/// A reqwest error with the request URL removed. The URL embeds the bot token,
/// so it must never reach a log or a status line.
fn error_text(error: reqwest::Error) -> String {
    error.without_url().to_string()
}

/// A thin Bot API client. One instance per token; cheap to build.
pub struct TelegramClient {
    http: Client,
    token: String,
}

impl TelegramClient {
    pub fn new(token: &str) -> Result<Self, String> {
        let token = token.trim().to_string();
        if token.is_empty() {
            return Err("No Telegram bot token is configured.".to_string());
        }
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            // Long polling holds the request open; the ceiling covers a large
            // upload too. The connection timeout is what fails fast.
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(error_text)?;
        Ok(TelegramClient { http, token })
    }

    fn url(&self, method: &str) -> String {
        format!("{API_ROOT}/bot{}/{}", self.token, method)
    }

    /// Long poll for updates. `offset` acknowledges everything below it.
    pub async fn get_updates(&self, offset: i64, timeout_secs: u64) -> Result<Vec<Update>, String> {
        let body = serde_json::json!({
            "offset": offset,
            "timeout": timeout_secs,
            "allowed_updates": ["message"],
        });
        let response = self
            .http
            .post(self.url("getUpdates"))
            .json(&body)
            .send()
            .await
            .map_err(error_text)?;
        let envelope: Envelope<Vec<Update>> =
            response.json().await.map_err(error_text)?;
        envelope.into_result()
    }

    pub async fn send_message(&self, chat_id: &str, text: &str) -> Result<(), String> {
        let body = serde_json::json!({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": true,
        });
        let response = self
            .http
            .post(self.url("sendMessage"))
            .json(&body)
            .send()
            .await
            .map_err(error_text)?;
        self.read_ok(response).await
    }

    /// Send a file that is already on disk. `size` is checked by the caller
    /// against [`MAX_UPLOAD_BYTES`].
    pub async fn send_document(
        &self,
        chat_id: &str,
        path: &Path,
        caption: &str,
    ) -> Result<(), String> {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string());
        // The cap keeps this from pulling a large file into memory; the Bot API
        // would refuse the upload anyway.
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let form = multipart::Form::new()
            .text("chat_id", chat_id.to_string())
            .text("caption", caption.to_string())
            .part("document", multipart::Part::bytes(bytes).file_name(name));
        let response = self
            .http
            .post(self.url("sendDocument"))
            .multipart(form)
            .send()
            .await
            .map_err(error_text)?;
        self.read_ok(response).await
    }

    /// Whatever this bot is registered as, for the Settings status line.
    pub async fn bot_username(&self) -> Result<String, String> {
        let response = self
            .http
            .post(self.url("getMe"))
            .send()
            .await
            .map_err(error_text)?;
        let envelope: Envelope<BotUser> = response.json().await.map_err(error_text)?;
        let user = envelope.into_result()?;
        Ok(match user.username {
            Some(name) => format!("@{name}"),
            None => user.first_name,
        })
    }

    async fn read_ok(&self, response: reqwest::Response) -> Result<(), String> {
        let envelope: Envelope<serde_json::Value> =
            response.json().await.map_err(error_text)?;
        envelope.into_result().map(|_| ())
    }
}

#[derive(Debug, Deserialize)]
struct BotUser {
    first_name: String,
    username: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_commands_with_and_without_arguments() {
        assert_eq!(parse_command("/start"), Some(Command::Help));
        assert_eq!(parse_command("/help"), Some(Command::Help));
        assert_eq!(parse_command("/status"), Some(Command::Status));
        assert_eq!(
            parse_command("/search quiz 2"),
            Some(Command::Search("quiz 2".to_string()))
        );
        assert_eq!(parse_command("/get 42"), Some(Command::Get("42".to_string())));
        assert_eq!(parse_command("/GET 42"), Some(Command::Get("42".to_string())));
        assert_eq!(
            parse_command("/get@QuantaPulseBot 42"),
            Some(Command::Get("42".to_string()))
        );
        assert_eq!(
            parse_command("/nope"),
            Some(Command::Unknown("nope".to_string()))
        );
    }

    #[test]
    fn plain_text_is_not_a_command() {
        assert_eq!(parse_command("hello there"), None);
        assert_eq!(parse_command(""), None);
        assert_eq!(parse_command("  "), None);
    }

    #[test]
    fn forwarding_needs_the_switch_and_the_category() {
        let off = Settings::default();
        assert!(!forwards(&off, "new"));

        let settings = Settings {
            telegram_enabled: true,
            ..off
        };
        assert!(forwards(&settings, "new"));
        assert!(forwards(&settings, "announcement"));
        assert!(forwards(&settings, "updated"));
        assert!(forwards(&settings, "deadline"));
        assert!(forwards(&settings, "unavailable"));
        assert!(forwards(&settings, "restored"));
        assert!(forwards(&settings, "auth"));
        // A kind outside the six is never forwarded.
        assert!(!forwards(&settings, "something-else"));
    }

    #[test]
    fn forwarding_follows_the_six_settings_switches() {
        let settings = Settings {
            telegram_enabled: true,
            notify_deadlines: false,
            notify_updated: false,
            ..Settings::default()
        };
        assert!(!forwards(&settings, "deadline"));
        assert!(!forwards(&settings, "updated"));
        assert!(forwards(&settings, "new"));
    }

    #[test]
    fn a_search_reply_lists_the_id_and_the_local_marker() {
        let hits = vec![
            SearchHit {
                resource_id: 7,
                title: "Quiz 2 answer sheet".to_string(),
                course: Some("CS F222".to_string()),
                resource_type: "quiz".to_string(),
                uploaded_at: None,
                local: true,
            },
            SearchHit {
                resource_id: 9,
                title: "Workshop manual".to_string(),
                course: None,
                resource_type: "pdf".to_string(),
                uploaded_at: None,
                local: false,
            },
        ];
        let reply = search_reply(&hits);
        assert!(reply.starts_with("#7 Quiz 2 answer sheet · local"));
        assert!(reply.contains("#9 Workshop manual"));
        assert!(reply.contains("/get <id>"));
    }

    #[test]
    fn an_empty_search_reply_says_so() {
        assert_eq!(search_reply(&[]), "No matches.");
    }

    #[test]
    fn the_status_reply_counts_without_paths() {
        let stats = MirrorStats {
            queued: 3,
            downloading: 1,
            done: 312,
            failed: 2,
            skipped: 0,
            kept: 5,
            total_resources: 486,
            bytes_done: 1,
            bytes_total: 2,
            state: "idle".to_string(),
            root: "C:\\Users\\me\\Documents\\Quanta Pulse\\Files".to_string(),
            free_bytes: 10,
        };
        let text = status_text(&stats);
        assert!(text.contains("312 of 486"));
        assert!(text.contains("3 queued"));
        assert!(!text.contains("Documents"));
    }

    #[test]
    fn a_command_event_message_carries_the_course_and_the_link() {
        let event = ChangeEvent {
            id: 1,
            resource_id: Some(4),
            course_id: Some(2),
            course_name: Some("CS F222".to_string()),
            resource_title: Some("Quiz 2".to_string()),
            resource_url: Some("https://quanta/x".to_string()),
            source_page_url: None,
            section_path: vec![],
            resource_type: Some("quiz".to_string()),
            uploaded_at: None,
            change_type: "new".to_string(),
            title: "Quiz 2 answer sheet".to_string(),
            description: None,
            detected_at: "2026-10-15T00:00:00Z".to_string(),
            read: false,
        };
        let text = event_message(&event);
        assert!(text.starts_with("New upload · CS F222"));
        assert!(text.contains("Quiz 2 answer sheet"));
        assert!(text.contains("https://quanta/x"));
    }

    #[test]
    fn a_file_caption_has_no_link_and_is_clipped() {
        let base = ChangeEvent {
            id: 1,
            resource_id: Some(4),
            course_id: Some(2),
            course_name: Some("CS F222".to_string()),
            resource_title: Some("Quiz 2".to_string()),
            resource_url: Some("https://quanta/x".to_string()),
            source_page_url: None,
            section_path: vec![],
            resource_type: Some("quiz".to_string()),
            uploaded_at: None,
            change_type: "new".to_string(),
            title: "Quiz 2 answer sheet".to_string(),
            description: None,
            detected_at: "2026-10-15T00:00:00Z".to_string(),
            read: false,
        };

        let caption = event_caption(&base);
        assert!(caption.starts_with("New upload · CS F222"));
        assert!(caption.contains("Quiz 2 answer sheet"));
        assert!(!caption.contains("https://"), "the file replaces the link");

        // The text fallback still carries the link.
        assert!(event_message(&base).contains("https://quanta/x"));

        // A long body is trimmed to what Telegram accepts, on a char boundary.
        let long = ChangeEvent {
            description: Some("é".repeat(4000)),
            ..base
        };
        let clipped = event_caption(&long);
        assert_eq!(clipped.chars().count(), CAPTION_MAX_CHARS);
        assert!(clipped.ends_with('…'));
    }

    #[test]
    fn the_help_text_lists_the_commands() {        let help = help_text();
        for command in ["/search", "/get", "/status"] {
            assert!(help.contains(command), "missing {command}");
        }
    }

    #[test]
    fn an_envelope_reports_a_rejected_request() {
        let raw = r#"{"ok":false,"description":"Unauthorized"}"#;
        let envelope: Envelope<serde_json::Value> = serde_json::from_str(raw).unwrap();
        assert_eq!(envelope.into_result().unwrap_err(), "Unauthorized");

        let raw = r#"{"ok":true,"result":{"first_name":"Bot"}}"#;
        let envelope: Envelope<BotUser> = serde_json::from_str(raw).unwrap();
        assert_eq!(envelope.into_result().unwrap().first_name, "Bot");
    }
}

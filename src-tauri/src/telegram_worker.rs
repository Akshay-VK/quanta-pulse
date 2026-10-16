//! The Telegram worker.
//!
//! Two jobs, neither of them on the critical path of a scan:
//!
//! - **Forwarding.** Change events reach the user's chat when the six Settings
//!   categories allow it. A scan hands the events over and moves on; a slow or
//!   unreachable Telegram never delays monitoring.
//! - **Commands.** A long poll answers `/search`, `/get`, `/status` and `/help`
//!   from the configured chat only. `/get` waits for the local mirror, so the
//!   bytes come from this computer and Quanta is never fetched twice.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::core::search::{self, DEFAULT_LIMIT};
use crate::core::telegram::{
    self, parse_command, Command, TelegramClient, Update, MAX_UPLOAD_BYTES,
};
use crate::db;
use crate::models::ChangeEvent;
use crate::settings::Settings;
use crate::state::AppState;

/// How long Telegram holds a poll open when there is nothing to say.
const LONG_POLL_SECS: u64 = 25;
/// How long `/get` waits for a download before giving up.
const ENSURE_TIMEOUT: Duration = Duration::from_secs(60);
/// Idle poll when the bot is off, or not configured yet.
const IDLE: Duration = Duration::from_secs(15);

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move { run(app).await });
}

async fn run(app: AppHandle) {
    // Drain whatever queued up while the app was closed, without answering it:
    // a restart must not replay yesterday's commands.
    skip_backlog(&app).await;

    let mut offset: i64 = 0;
    let mut backoff = Duration::from_secs(5);
    loop {
        if app.state::<AppState>().sync.shutdown.load(Ordering::SeqCst) {
            break;
        }

        let settings = app.state::<AppState>().settings();
        let token = match (&settings.telegram_enabled, &settings.telegram_bot_token) {
            (true, Some(token)) => token.clone(),
            _ => {
                tokio::time::sleep(IDLE).await;
                continue;
            }
        };
        let Ok(client) = TelegramClient::new(&token) else {
            tokio::time::sleep(IDLE).await;
            continue;
        };

        match client.get_updates(offset, LONG_POLL_SECS).await {
            Ok(updates) => {
                backoff = Duration::from_secs(5);
                for update in &updates {
                    offset = offset.max(update.update_id + 1);
                    handle(&app, &client, &settings, update).await;
                }
            }
            Err(error) => {
                // The error text can carry the request URL, which carries the
                // token; `logging::redact` drops any line that names the host.
                tracing::warn!("telegram poll failed: {error}");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(60));
            }
        }
    }
}

/// Ask for pending updates once and throw them away, so the first real poll
/// starts after the backlog instead of replaying it.
async fn skip_backlog(app: &AppHandle) {
    let settings = app.state::<AppState>().settings();
    let token = match (&settings.telegram_enabled, &settings.telegram_bot_token) {
        (true, Some(token)) => token.clone(),
        _ => return,
    };
    if let Ok(client) = TelegramClient::new(&token) {
        let _ = client.get_updates(0, 0).await;
    }
}

async fn handle(app: &AppHandle, client: &TelegramClient, settings: &Settings, update: &Update) {
    let Some(text) = update.text() else {
        return;
    };
    // Only the configured chat is answered. Anything else is ignored, so a
    // guessed bot name gives a stranger nothing.
    if update.chat_id().as_deref() != settings.telegram_chat_id.as_deref() {
        return;
    }
    let Some(command) = parse_command(text) else {
        return;
    };

    match command {
        Command::Help => {
            let _ = client.send_message(chat_id(settings), &telegram::help_text()).await;
        }
        Command::Unknown(name) => {
            let reply = format!("I don't know /{name}. /help lists the commands.");
            let _ = client.send_message(chat_id(settings), &reply).await;
        }
        Command::Status => {
            let stats = {
                let state = app.state::<AppState>();
                let conn = state.conn();
                state.mirror.stats(&conn)
            };
            let _ = client.send_message(chat_id(settings), &telegram::status_text(&stats)).await;
        }
        Command::Search(query) => {
            let hits = {
                let state = app.state::<AppState>();
                let conn = state.conn();
                search::search(&conn, &state.mirror, &query, DEFAULT_LIMIT)
            };
            let _ = client
                .send_message(chat_id(settings), &telegram::search_reply(&hits))
                .await;
        }
        Command::Get(argument) => send_file(app, client, chat_id(settings), &argument).await,
    }
}

fn chat_id(settings: &Settings) -> &str {
    settings.telegram_chat_id.as_deref().unwrap_or_default()
}

/// `/get <id>`: wait for the local copy, then upload that file.
async fn send_file(app: &AppHandle, client: &TelegramClient, chat: &str, argument: &str) {
    let Ok(resource_id) = argument.trim().parse::<i64>() else {
        let _ = client
            .send_message(chat, "Usage: /get <id>. /search finds an id.")
            .await;
        return;
    };

    let state = app.state::<AppState>();
    let caption = {
        let conn = state.conn();
        db::get_resource_by_id(&conn, resource_id)
            .map(|resource| resource.title)
            .unwrap_or_else(|| format!("Resource {resource_id}"))
    };

    let ctx = state.mirror_ctx();
    let file = match state.mirror.ensure_local(&ctx, resource_id, ENSURE_TIMEOUT).await {
        Ok(file) => file,
        Err(error) => {
            let _ = client.send_message(chat, &error).await;
            return;
        }
    };

    if u64::try_from(file.size_bytes).unwrap_or(u64::MAX) > MAX_UPLOAD_BYTES {
        let reply = format!(
            "{caption} is larger than Telegram accepts. It is saved on this computer at:\n{}",
            file.path
        );
        let _ = client.send_message(chat, &reply).await;
        return;
    }

    if client
        .send_document(chat, Path::new(&file.path), &caption)
        .await
        .is_err()
    {
        let reply = format!("Could not send {caption}. It is saved at {}", file.path);
        let _ = client.send_message(chat, &reply).await;
    }
}

/// Forward change events to the configured chat. Fire-and-forget.
pub fn forward(app: &AppHandle, events: Vec<ChangeEvent>) {
    let settings = app.state::<AppState>().settings();
    let (Some(token), Some(chat)) = (
        settings.telegram_bot_token.clone(),
        settings.telegram_chat_id.clone(),
    ) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let Ok(client) = TelegramClient::new(&token) else {
            return;
        };
        for event in &events {
            let text = telegram::event_message(event);
            if let Err(error) = client.send_message(&chat, &text).await {
                tracing::warn!("telegram forward failed: {error}");
            }
        }
    });
}

/// Forward one line of plain text, for the messages that are not change events.
pub fn forward_text(app: &AppHandle, text: &str) {
    let settings = app.state::<AppState>().settings();
    let (Some(token), Some(chat)) = (
        settings.telegram_bot_token.clone(),
        settings.telegram_chat_id.clone(),
    ) else {
        return;
    };
    let text = text.to_string();
    tauri::async_runtime::spawn(async move {
        if let Ok(client) = TelegramClient::new(&token) {
            let _ = client.send_message(&chat, &text).await;
        }
    });
}

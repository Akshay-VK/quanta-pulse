//! Tauri commands — the entire surface exposed to the frontend.
//!
//! Every command validates its inputs. The only URL-accepting command opens a
//! link in the system browser and is restricted to http(s) destinations.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use zeroize::Zeroizing;

use crate::db::{self, EventFilter, ResourceFilter};
use crate::models::{AuthStatus, CacheStats, ChangeEvent, Course, Digest, Resource, ScanOutcome, ScanRun, SessionRefreshResult, SessionResetResult, SyncStatus};
use crate::quanta::client::QuantaError;
use crate::quanta::parse::extract_readable_text;
use crate::quanta::preview::{
    base64_encode, extension_of, is_unpreviewable_extension, preview_kind,
    refine_with_content_type, truncate_chars, PreviewKind,
};
use crate::quanta::urlnorm::is_internal;
use crate::settings::Settings;
use crate::state::AppState;
use crate::{auth, notify};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFilterInput {
    pub course_id: Option<i64>,
    pub search: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
    pub course_count: i64,
    pub resource_count: i64,
    pub event_count: i64,
    pub log_dir: Option<String>,
}

/* ---------------------------------------------------------------------- auth */

#[tauri::command]
pub async fn login(app: AppHandle, email: String, password: String) -> Result<AuthStatus, String> {
    let email = email.trim().to_string();
    if !email.contains('@') {
        return Err("Enter a valid email address.".to_string());
    }
    if password.is_empty() {
        return Err("Enter your password.".to_string());
    }
    // The password is zeroed as soon as this function returns.
    let password = Zeroizing::new(password);
    auth::login_with_password(app, email, password).await
}

#[tauri::command]
pub async fn start_sso_login(app: AppHandle) -> Result<AuthStatus, String> {
    auth::start_sso_login(app).await
}

#[tauri::command]
pub fn auth_status(state: State<AppState>) -> AuthStatus {
    auth::auth_status(&state)
}

#[tauri::command]
pub async fn refresh_session(app: AppHandle) -> SessionRefreshResult {
    auth::refresh_existing_session(app).await
}

#[tauri::command]
pub async fn restart_quanta_session(app: AppHandle) -> SessionResetResult {
    auth::restart_quanta_session(app).await
}

#[tauri::command]
pub fn logout(state: State<AppState>) -> Result<(), String> {
    auth::logout(&state)
}

/* --------------------------------------------------------------------- data */

#[tauri::command]
pub fn list_courses(state: State<AppState>) -> Result<Vec<Course>, String> {
    let conn = state.conn();
    db::list_courses(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_resources(
    state: State<AppState>,
    filter: ResourceFilterInput,
) -> Result<Vec<Resource>, String> {
    let conn = state.conn();
    db::list_resources(
        &conn,
        &ResourceFilter {
            course_id: filter.course_id,
            search: filter.search,
            kind: filter.kind,
            limit: Some(filter.limit.unwrap_or(500).clamp(1, 2000)),
            offset: filter.offset,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_dashboard_resources(state: State<AppState>) -> Result<Vec<Resource>, String> {
    let conn = state.conn();
    db::list_dashboard_resources(&conn, 2000).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_events(
    state: State<AppState>,
    unread_only: Option<bool>,
    limit: Option<i64>,
) -> Result<Vec<ChangeEvent>, String> {
    let conn = state.conn();
    db::list_events(&conn, unread_only.unwrap_or(false), limit.unwrap_or(200).clamp(1, 1000))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_dashboard_events(state: State<AppState>) -> Result<Vec<ChangeEvent>, String> {
    let conn = state.conn();
    db::list_dashboard_events(&conn, 1000).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_history_events(state: State<AppState>) -> Result<Vec<ChangeEvent>, String> {
    let conn = state.conn();
    db::list_history_events(&conn, 1000).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_dashboard_activity(state: State<AppState>) -> Result<(), String> {
    let conn = state.conn();
    db::clear_dashboard_activity(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history_activity(state: State<AppState>) -> Result<(), String> {
    let conn = state.conn();
    db::clear_history_activity(&conn).map_err(|e| e.to_string())
}

/// Events whose *local* detection date falls inside `[from, to]` (inclusive).
///
/// `from`/`to` are `YYYY-MM-DD`; either may be omitted to leave that side open.
/// The local dates are converted to a UTC instant window here so the calendar
/// and every other view group events by the user's calendar day, never by the
/// raw UTC date string.
#[tauri::command]
pub fn events_range(
    state: State<AppState>,
    from: Option<String>,
    to: Option<String>,
    course_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ChangeEvent>, String> {
    let conn = state.conn();
    let (since, until) = local_date_range(from.as_deref(), to.as_deref())?;
    db::list_events_filtered(
        &conn,
        &EventFilter {
            course_id,
            since,
            until,
            limit: Some(limit.unwrap_or(2000).clamp(1, 5000)),
            ..EventFilter::default()
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_scans(state: State<AppState>, limit: Option<i64>) -> Result<Vec<ScanRun>, String> {
    let conn = state.conn();
    db::list_scans(&conn, limit.unwrap_or(50).clamp(1, 500)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_history_scans(state: State<AppState>, limit: Option<i64>) -> Result<Vec<ScanRun>, String> {
    let conn = state.conn();
    db::list_history_scans(&conn, limit.unwrap_or(50).clamp(1, 500)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unread_count(state: State<AppState>) -> i64 {
    let conn = state.conn();
    db::unread_count(&conn)
}

#[tauri::command]
pub fn mark_read(state: State<AppState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.conn();
    db::mark_read(&conn, &ids, &db::now_rfc3339()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_all_read(state: State<AppState>) -> Result<(), String> {
    let conn = state.conn();
    db::mark_all_read(&conn, &db::now_rfc3339()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn daily_digest(state: State<AppState>, date: Option<String>) -> Result<Digest, String> {
    let conn = state.conn();
    let day = match date {
        Some(d) => parse_local_date(&d)?,
        None => chrono::Local::now().date_naive(),
    };
    let start = local_midnight_to_utc(day)?;
    let end = local_midnight_to_utc(day.succ_opt().unwrap_or(day))?;
    db::digest(&conn, &start, &end, &day.to_string()).map_err(|e| e.to_string())
}

/* --------------------------------------------------------------------- sync */

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<ScanOutcome, String> {
    Ok(crate::sync::engine::run_scan(app, "manual").await)
}

#[tauri::command]
pub fn cancel_sync(state: State<AppState>) {
    state
        .sync
        .cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn sync_status(state: State<AppState>) -> SyncStatus {
    state.sync_status()
}

#[tauri::command]
pub fn rebuild_baseline(state: State<AppState>, course_id: Option<i64>) -> Result<(), String> {
    let conn = state.conn();
    if let Some(id) = course_id {
        // Per-course re-baseline: the next scan suppresses events for this course.
        let existing = db::get_kv(&conn, "rebaseline_courses").unwrap_or_else(|| "[]".into());
        let mut list: Vec<i64> = serde_json::from_str(&existing).unwrap_or_default();
        if !list.contains(&id) {
            list.push(id);
        }
        db::set_kv(&conn, "rebaseline_courses", &serde_json::to_string(&list).unwrap())
            .map_err(|e| e.to_string())?;
    } else {
        db::del_kv(&conn, "baseline_established").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/* ----------------------------------------------------------------- settings */

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    state.set_settings(settings)?;
    let updated = state.settings();
    // Keep launch-at-login in sync with the preference.
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        let result = if updated.launch_at_login {
            manager.enable()
        } else {
            manager.disable()
        };
        if let Err(e) = result {
            tracing::warn!("could not update launch-at-login: {e}");
        }
    }
    Ok(updated)
}

#[tauri::command]
pub fn set_monitoring(
    state: State<AppState>,
    course_id: i64,
    status: String,
) -> Result<(), String> {
    if !matches!(status.as_str(), "monitored" | "paused") {
        return Err("Invalid monitoring status.".to_string());
    }
    let conn = state.conn();
    db::set_monitoring(&conn, course_id, &status).map_err(|e| e.to_string())
}

/* ---------------------------------------------------------------- preview */

/// Maximum bytes fetched for a binary preview. Larger files are reported as
/// too large and left to the system browser.
const PREVIEW_MAX_BINARY_BYTES: usize = 8 * 1024 * 1024;
/// Maximum characters of readable text returned for an HTML/text preview.
const PREVIEW_MAX_TEXT_CHARS: usize = 200_000;

/// A resource preview fetched on demand with the authenticated session.
///
/// Tagged by `kind` so the frontend can narrow the union:
/// - `text` — readable text extracted from an HTML/text response.
/// - `binary` — base64 bytes plus the renderer `mode` and `mime`.
/// - `unsupported` — a type the webview cannot render; open it externally.
/// - `tooLarge` — exceeded `limitBytes`; open it externally.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ResourcePreview {
    Text {
        text: String,
        truncated: bool,
        source_url: String,
        content_type: Option<String>,
    },
    Binary {
        mode: String,
        mime: String,
        data: String,
        source_url: String,
        size_bytes: usize,
    },
    Unsupported {
        reason: String,
        source_url: String,
        content_type: Option<String>,
    },
    TooLarge {
        size_bytes: Option<u64>,
        limit_bytes: u64,
        source_url: String,
    },
}

/// Preview a resource in-app.
///
/// The local copy is tried first, through `core::text` and `core::mirror`: a
/// mirrored page or file needs no network, no preview lease and no session, so
/// a preview never pauses a scan and works offline. Only when nothing is local
/// is the resource fetched through the authenticated session, and then the
/// bytes are held only long enough to hand to the webview.
#[tauri::command]
pub async fn preview_resource(
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<ResourcePreview, String> {
    // Read the stored metadata, then release the database lock before awaiting.
    let resource = {
        let conn = state.conn();
        db::get_resource_by_id(&conn, resource_id)
    };
    let Some(resource) = resource else {
        return Err("Resource not found.".to_string());
    };

    let Ok(url) = url::Url::parse(resource.url.trim()) else {
        return Err("This resource has no previewable link.".to_string());
    };
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http(s) resources can be previewed.".to_string());
    }
    if !is_internal(&url) {
        return Ok(ResourcePreview::Unsupported {
            reason: "This resource lives outside Quanta; open it in your browser.".to_string(),
            source_url: resource.url.clone(),
            content_type: None,
        });
    }

    // Known non-renderable formats: don't spend a request on them.
    if let Some(ext) = extension_of(&url) {
        if is_unpreviewable_extension(&ext) {
            return Ok(ResourcePreview::Unsupported {
                reason: format!("Files of type .{ext} can't be previewed in the app."),
                source_url: resource.url.clone(),
                content_type: None,
            });
        }
    }

    let metadata_kind = preview_kind(&resource.resource_type, Some(&url));

    // A local copy answers offline. A miss falls through to the network.
    if let Some(preview) = preview_from_local(&state, resource_id, metadata_kind, &resource.url) {
        return Ok(preview);
    }

    // From here the network is needed, so take the lease (it pauses scanning)
    // and require a session.
    let _preview_lease = state
        .sync
        .begin_preview()
        .ok_or_else(|| "Quanta authentication is being reset. Try again after sign-in.".to_string())?;
    let Some(client) = state.client() else {
        return Err("Sign in to Quanta to preview resources.".to_string());
    };

    let fetched = client
        .fetch_bytes(&url, PREVIEW_MAX_BINARY_BYTES)
        .await
        .map_err(preview_error)?;
    let kind = refine_with_content_type(metadata_kind, fetched.content_type.as_deref());

    match kind {
        PreviewKind::Text => {
            let raw = String::from_utf8_lossy(&fetched.bytes).into_owned();
            let text = if content_is_html(fetched.content_type.as_deref()) {
                extract_readable_text(&raw)
            } else {
                raw.trim().to_string()
            };
            let (text, truncated) = truncate_chars(&text, PREVIEW_MAX_TEXT_CHARS);
            Ok(ResourcePreview::Text {
                text,
                truncated: truncated || fetched.truncated,
                source_url: fetched.final_url,
                content_type: fetched.content_type,
            })
        }
        kind if kind.is_binary() => {
            if fetched.truncated {
                return Ok(ResourcePreview::TooLarge {
                    size_bytes: fetched.content_length.and_then(|n| u64::try_from(n).ok()),
                    limit_bytes: PREVIEW_MAX_BINARY_BYTES as u64,
                    source_url: fetched.final_url,
                });
            }
            // Keep the bytes: the content indexer and the Telegram bot both need
            // them again, and the preview already paid for this download.
            // Best-effort — a full or read-only disk must not break the preview.
            let limit = state.settings().cache_limit_bytes;
            {
                let conn = state.conn();
                let _ = state.files.put(&conn, resource_id, &fetched.bytes);
                let _ = state.files.evict_to(&conn, limit);
            }
            Ok(ResourcePreview::Binary {
                mode: kind.mode().unwrap_or("file").to_string(),
                mime: fetched
                    .content_type
                    .clone()
                    .unwrap_or_else(|| kind.default_mime().to_string()),
                data: base64_encode(&fetched.bytes),
                source_url: fetched.final_url,
                size_bytes: fetched.bytes.len(),
            })
        }
        _ => Ok(ResourcePreview::Unsupported {
            reason: "This resource can't be previewed in the app.".to_string(),
            source_url: fetched.final_url,
            content_type: fetched.content_type,
        }),
    }
}

fn content_is_html(content_type: Option<&str>) -> bool {
    content_type
        .map(|c| c.contains("text/html") || c.contains("application/xhtml"))
        .unwrap_or(true)
}

/// A preview built from the resource's local copy, or `None` when there is
/// nothing local to read.
///
/// Text goes through `core::text`, so an announcement or page reads as the same
/// readable text the preview would have extracted from the network. A binary
/// copy is read from disk, capped at the same limit a download would be, so a
/// large file still reports `tooLarge` and opens externally instead of filling
/// memory.
fn preview_from_local(
    state: &AppState,
    resource_id: i64,
    metadata_kind: PreviewKind,
    source_url: &str,
) -> Option<ResourcePreview> {
    let conn = state.conn();
    let file = state.mirror.local_file(&conn, resource_id)?;

    match metadata_kind {
        PreviewKind::Text => {
            let local = crate::core::text::local_text(&conn, &state.mirror, resource_id)?;
            let (text, truncated) = truncate_chars(&local.text, PREVIEW_MAX_TEXT_CHARS);
            Some(ResourcePreview::Text {
                text,
                truncated,
                source_url: source_url.to_string(),
                content_type: None,
            })
        }
        kind if kind.is_binary() => {
            let kind = refine_with_content_type(kind, file.mime.as_deref());
            if !kind.is_binary() {
                // The served type turned out to be text; let the network path
                // decide rather than guessing here.
                return None;
            }
            let size = u64::try_from(file.size_bytes).unwrap_or(u64::MAX);
            if size > PREVIEW_MAX_BINARY_BYTES as u64 {
                return Some(ResourcePreview::TooLarge {
                    size_bytes: Some(size),
                    limit_bytes: PREVIEW_MAX_BINARY_BYTES as u64,
                    source_url: source_url.to_string(),
                });
            }
            let bytes = fs::read(&file.path).ok()?;
            Some(ResourcePreview::Binary {
                mode: kind.mode().unwrap_or("file").to_string(),
                mime: file
                    .mime
                    .clone()
                    .unwrap_or_else(|| kind.default_mime().to_string()),
                data: base64_encode(&bytes),
                source_url: source_url.to_string(),
                size_bytes: bytes.len(),
            })
        }
        _ => None,
    }
}

fn preview_error(error: QuantaError) -> String {
    match error {
        QuantaError::AuthExpired => {
            "Your Quanta session expired. Sign in again to preview resources.".to_string()
        }
        QuantaError::NotAccessible(_) => "This resource is not available on Quanta.".to_string(),
        other => format!("Could not load preview: {other}"),
    }
}

#[cfg(test)]
mod preview_tests {
    use super::ResourcePreview;

    /// The frontend union is keyed off `kind` and camelCase fields; lock the
    /// wire format so a rename cannot silently break the TypeScript contract.
    #[test]
    fn preview_serialises_with_camel_case_tags_and_fields() {
        let value = serde_json::to_value(ResourcePreview::TooLarge {
            size_bytes: Some(3),
            limit_bytes: 8,
            source_url: "https://x".into(),
        })
        .unwrap();
        assert_eq!(value["kind"], "tooLarge");
        assert_eq!(value["limitBytes"], 8);
        assert_eq!(value["sizeBytes"], 3);
        assert_eq!(value["sourceUrl"], "https://x");

        let value = serde_json::to_value(ResourcePreview::Binary {
            mode: "pdf".into(),
            mime: "application/pdf".into(),
            data: "JVBERi0=".into(),
            source_url: "https://x".into(),
            size_bytes: 6,
        })
        .unwrap();
        assert_eq!(value["kind"], "binary");
        assert_eq!(value["sourceUrl"], "https://x");
        assert_eq!(value["sizeBytes"], 6);
        assert!(value.get("contentType").is_none());

        let value = serde_json::to_value(ResourcePreview::Text {
            text: "hi".into(),
            truncated: false,
            source_url: "https://x".into(),
            content_type: Some("text/html".into()),
        })
        .unwrap();
        assert_eq!(value["kind"], "text");
        assert_eq!(value["contentType"], "text/html");
    }
}

/* ---------------------------------------------------------------- misc / os */

#[tauri::command]
pub fn test_notification(app: AppHandle) {
    notify::test_notification(&app);
}

#[tauri::command]
pub fn db_info(state: State<AppState>) -> DbInfo {
    let conn = state.conn();
    let size = std::fs::metadata(&state.db_path).map(|m| m.len()).unwrap_or(0);
    let log_dir = crate::logging::log_dir().map(|p| p.to_string_lossy().to_string());
    DbInfo {
        path: state.db_path.to_string_lossy().to_string(),
        size_bytes: size,
        course_count: db::count_courses(&conn),
        resource_count: db::count_resources(&conn),
        event_count: db::count_events(&conn),
        log_dir,
    }
}

/// Occupancy of the local byte cache, for Settings > Data.
#[tauri::command]
pub fn cache_stats(state: State<AppState>) -> CacheStats {
    let limit = state.settings().cache_limit_bytes;
    let conn = state.conn();
    state.files.stats(&conn, limit)
}

/// Empty the local byte cache. Downloaded bytes can always be fetched again, so
/// this only affects speed, never data the user can't recover.
#[tauri::command]
pub fn clear_file_cache(state: State<AppState>) -> CacheStats {
    let limit = state.settings().cache_limit_bytes;
    let conn = state.conn();
    state.files.clear(&conn);
    state.files.stats(&conn, limit)
}

/// One-shot startup self-check. Shortly after launch the Rust side evaluates a
/// tiny script in the webview, which reports back what the DOM actually
/// contains. Logged so a rendered (or broken) UI can be confirmed from the log
/// alone — useful when the display is locked, headless, or off-screen.
#[tauri::command]
pub fn ui_ready(summary: String) {
    tracing::info!("ui ready: {summary}");
}

/// Opens the OS notification settings pane. Used by Settings > Account when the
/// notification permission is Blocked and the app cannot ask again.
///
/// The target is a compile-time constant, so unlike `open_external` it needs no
/// scheme allowlist; the opener plugin's scope rules only gate JS callers.
#[tauri::command]
pub fn open_notification_settings(app: AppHandle) -> Result<(), String> {
    let target = if cfg!(target_os = "windows") {
        "ms-settings:notifications"
    } else if cfg!(target_os = "macos") {
        "x-apple.systempreferences:com.apple.preference.notifications"
    } else {
        return Err("Open your system notification settings from the desktop.".to_string());
    };
    app.opener()
        .open_url(target, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http(s) links can be opened.".to_string());
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle, navigate: Option<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if let Some(target) = navigate {
        use tauri::Emitter;
        let _ = app.emit("ui:navigate", target);
    }
}

fn parse_local_date(value: &str) -> Result<chrono::NaiveDate, String> {
    chrono::NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| "Invalid date (expected YYYY-MM-DD).".to_string())
}

/// Convert inclusive local-calendar-date bounds into a UTC instant window.
/// `until` is the exclusive start of the day *after* `to`.
fn local_date_range(
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(Option<String>, Option<String>), String> {
    let start = match from {
        Some(s) if !s.trim().is_empty() => Some(local_midnight_to_utc(parse_local_date(s)?)?),
        _ => None,
    };
    let end = match to {
        Some(s) if !s.trim().is_empty() => {
            let day = parse_local_date(s)?;
            let next = day.succ_opt().ok_or("Date out of range.".to_string())?;
            Some(local_midnight_to_utc(next)?)
        }
        _ => None,
    };
    Ok((start, end))
}

fn local_midnight_to_utc(date: chrono::NaiveDate) -> Result<String, String> {
    use chrono::{LocalResult, TimeZone};
    let naive = date
        .and_hms_opt(0, 0, 0)
        .ok_or("Invalid date.".to_string())?;
    // Resolve local midnight even across a rare DST transition: prefer the
    // single mapping, else the earliest, so an event never lands a day off.
    let resolved = match chrono::Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Some(dt),
        LocalResult::Ambiguous(dt, _) => Some(dt),
        LocalResult::None => None,
    };
    resolved
        .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .ok_or_else(|| "Could not resolve local timezone.".to_string())
}

/* ------------------------------------------------------------- local mirror */

/// Occupancy and queue state of the permanent local mirror.
#[tauri::command]
pub fn mirror_status(state: State<AppState>) -> crate::models::MirrorStats {
    let conn = state.conn();
    state.mirror.stats(&conn)
}

/// One status per indexed resource, so rows can show their own mirror state
/// without one command per row.
#[tauri::command]
pub fn mirror_local_files(
    state: State<'_, AppState>,
) -> Vec<crate::models::LocalFileStatus> {
    let conn = state.conn();
    state
        .mirror
        .statuses(&conn)
        .into_iter()
        .map(|(resource_id, status, error)| crate::models::LocalFileStatus {
            resource_id,
            status,
            error,
        })
        .collect()
}

/// The resolved local copy of one resource, for the peek panel. `null` when
/// there is nothing usable yet — the caller offers a download instead.
#[tauri::command]
pub fn mirror_local_file(
    state: State<'_, AppState>,
    resource_id: i64,
) -> Option<crate::models::LocalFile> {
    let conn = state.conn();
    state.mirror.local_file(&conn, resource_id)
}

/// Re-hash every local copy and requeue what is missing or corrupt.
#[tauri::command]
pub fn mirror_verify_files(state: State<'_, AppState>) -> crate::models::MirrorStats {
    let requeued = {
        let conn = state.conn();
        state.mirror.verify(&conn)
    };
    tracing::info!(requeued, "mirror verification queued for re-download");
    let conn = state.conn();
    state.mirror.stats(&conn)
}

/// Remove every local copy. Manual action only, behind a ConfirmDialog.
#[tauri::command]
pub fn mirror_delete_all(state: State<'_, AppState>) -> crate::models::MirrorStats {
    let removed = {
        let conn = state.conn();
        state.mirror.delete_all(&conn)
    };
    tracing::info!(removed, "all local mirror copies deleted");
    let conn = state.conn();
    state.mirror.stats(&conn)
}

/// Let the user pick the mirror folder. Existing files stay where they are: the
/// caller decides between moving them and starting fresh here.
#[tauri::command]
pub async fn pick_mirror_root(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::models::MirrorStats, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_title("Choose where files are saved")
        .blocking_pick_folder();
    let Some(folder) = picked else {
        let conn = state.conn();
        return Ok(state.mirror.stats(&conn));
    };

    let root = folder.into_path().map_err(|e| e.to_string())?;
    {
        let mut settings = state.settings();
        settings.mirror_root = Some(root.to_string_lossy().into_owned());
        state.set_settings(settings)?;
    }
    state.mirror.set_root(root);

    let conn = state.conn();
    Ok(state.mirror.stats(&conn))
}

/// Move existing mirror files to the newly selected root. Verifies each file's
/// SHA-256, copies to the new location, then deletes the old copy. Resumable
/// on failure.
#[tauri::command]
pub async fn mirror_move_files(
    state: State<'_, AppState>,
) -> Result<crate::models::MirrorStats, String> {
    let moved = {
        let conn = state.conn();
        state.mirror.move_to_new_root(&conn).map_err(|e| e.to_string())?
    };
    tracing::info!(moved, "mirror files moved to new root");
    let conn = state.conn();
    Ok(state.mirror.stats(&conn))
}

/// Queue every resource that has no local copy, and re-check anything whose
/// metadata changed. Starts the worker's attention immediately.
#[tauri::command]
pub fn mirror_start_backfill(state: State<AppState>) -> crate::models::MirrorStats {
    let enqueued = {
        let conn = state.conn();
        state.mirror.enqueue_all(&conn)
    };
    tracing::info!(enqueued, "mirror backfill requested");
    let conn = state.conn();
    state.mirror.stats(&conn)
}

#[tauri::command]
pub fn mirror_pause(state: State<AppState>) -> crate::models::MirrorStats {
    state.mirror.pause();
    let conn = state.conn();
    state.mirror.stats(&conn)
}

#[tauri::command]
pub fn mirror_resume(state: State<AppState>) -> crate::models::MirrorStats {
    state.mirror.resume();
    let conn = state.conn();
    state.mirror.stats(&conn)
}

/// Put every failed or skipped resource back in the queue, clearing the attempt
/// count so the backoff starts over.
#[tauri::command]
pub fn mirror_retry_failed(state: State<AppState>) -> crate::models::MirrorStats {
    let retried = {
        let conn = state.conn();
        state.mirror.retry_failed(&conn)
    };
    tracing::info!(retried, "mirror failures queued for retry");
    let conn = state.conn();
    state.mirror.stats(&conn)
}

/// Wait for a resource to be local, downloading it at the front of the queue.
/// This is what 'Open' calls: it never returns a path that does not exist.
#[tauri::command]
pub async fn ensure_local(
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<crate::models::LocalFile, String> {
    state
        .mirror
        .ensure_local(
            &state.mirror_ctx(),
            resource_id,
            crate::core::mirror::ENSURE_TIMEOUT,
        )
        .await
        .map_err(|e| {
            tracing::warn!(resource_id, error = %e, "ensure_local failed");
            e
        })
        .inspect(|file| tracing::debug!(resource_id, path = %file.path, "ensure_local"))
}

/// Open a resource's local copy with the system default handler, downloading
/// it first if it is not on disk yet.
#[tauri::command]
pub async fn open_local_file(
    app: AppHandle,
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<(), String> {
    let file = ensure_local(state, resource_id).await?;
    open_path(&app, &file.path, &file.rel_path)
}

/// Reveal a resource's local copy in the file manager.
#[tauri::command]
pub async fn reveal_local_file(
    app: AppHandle,
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<(), String> {
    let file = ensure_local(state, resource_id).await?;
    app.opener()
        .reveal_item_in_dir(&file.path)
        .map_err(|e| format!("could not reveal {}: {e}", file.rel_path))
}

fn open_path(app: &AppHandle, path: &str, label: &str) -> Result<(), String> {
    app.opener()
        .open_path(path.to_string(), None::<&str>)
        .map_err(|e| format!("could not open {label}: {e}"))
}

/// 'Open' / 'Show in folder' for the places Pulse owns: the database, the log
/// directory and the mirror root.
///
/// `kind` picks which one; no path is ever taken from the caller. 'Show in
/// folder' on the database selects the file itself, which is what a reader
/// expects; on the folders it opens the folder.
#[tauri::command]
pub fn open_app_folder(
    app: AppHandle,
    state: State<AppState>,
    kind: String,
    reveal: bool,
) -> Result<(), String> {
    let (target, label) = match kind.to_ascii_lowercase().as_str() {
        "database" => {
            let parent = state
                .db_path
                .parent()
                .ok_or_else(|| "the database path has no parent".to_string())?;
            if reveal {
                (state.db_path.clone(), state.db_path.display().to_string())
            } else {
                (parent.to_path_buf(), parent.display().to_string())
            }
        }
        "logs" => {
            let dir = crate::logging::log_dir()
                .ok_or_else(|| "the log directory is not available".to_string())?;
            (dir.clone(), dir.display().to_string())
        }
        "mirror" => {
            let root = state.mirror.root();
            (root.clone(), root.display().to_string())
        }
        other => return Err(format!("unknown folder: {other}")),
    };

    if !target.exists() {
        return Err(format!("{label} does not exist yet."));
    }
    if reveal {
        app.opener()
            .reveal_item_in_dir(&target)
            .map_err(|e| format!("could not reveal {label}: {e}"))
    } else {
        open_path(&app, &target.display().to_string(), &label)
    }
}



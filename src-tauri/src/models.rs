//! Serialisable data types shared between the Rust backend and the React UI.

use serde::{Deserialize, Serialize};

/// UTC timestamps are stored as RFC 3339 strings so the UI can localise them.
pub type Timestamp = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: i64,
    pub external_course_id: String,
    pub name: String,
    pub short_name: Option<String>,
    pub url: String,
    pub first_seen_at: Timestamp,
    pub last_scanned_at: Option<Timestamp>,
    pub last_scan_status: Option<String>,
    pub monitoring_status: String,
    pub resource_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: i64,
    pub external_resource_id: String,
    pub course_id: Option<i64>,
    pub course_name: Option<String>,
    pub title: String,
    /// Direct file / download URL of the resource.
    pub url: String,
    /// The page where the resource's link was listed (course, section or
    /// folder page). `None` when discovery has not captured a listing page yet.
    pub source_page_url: Option<String>,
    pub resource_type: String,
    /// When the resource was uploaded by the course staff, if Quanta exposes it.
    pub uploaded_at: Option<Timestamp>,
    /// When the resource became available to students, if known.
    pub published_at: Option<Timestamp>,
    /// When the underlying file/page was last modified, if known.
    pub modified_at: Option<Timestamp>,
    /// Deadline for assignments and quizzes, if known.
    pub due_at: Option<Timestamp>,
    /// When Quanta Pulse first observed the resource.
    pub first_seen_at: Timestamp,
    pub last_seen_at: Option<Timestamp>,
    pub last_checked_at: Option<Timestamp>,
    pub content_fingerprint: Option<String>,
    pub availability_status: String,
    pub size_bytes: Option<i64>,
    pub section: Option<String>,
    /// Ordered Quanta section/page titles from the course root to the parent
    /// listing page. Empty means the location has not been discovered.
    pub section_path: Vec<String>,
    pub is_external: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    New,
    Updated,
    Announcement,
    Deadline,
    Unavailable,
    Restored,
    Baseline,
}

impl ChangeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChangeType::New => "new",
            ChangeType::Updated => "updated",
            ChangeType::Announcement => "announcement",
            ChangeType::Deadline => "deadline",
            ChangeType::Unavailable => "unavailable",
            ChangeType::Restored => "restored",
            ChangeType::Baseline => "baseline",
        }
    }

    pub fn from_str(s: &str) -> ChangeType {
        match s {
            "new" => ChangeType::New,
            "updated" => ChangeType::Updated,
            "announcement" => ChangeType::Announcement,
            "deadline" => ChangeType::Deadline,
            "unavailable" => ChangeType::Unavailable,
            "restored" => ChangeType::Restored,
            _ => ChangeType::Baseline,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEvent {
    pub id: i64,
    pub resource_id: Option<i64>,
    pub course_id: Option<i64>,
    pub course_name: Option<String>,
    pub resource_title: Option<String>,
    pub resource_url: Option<String>,
    /// Page listing the resource, when the linked resource row knows one.
    pub source_page_url: Option<String>,
    /// Ordered section/page path of the related resource, when known.
    pub section_path: Vec<String>,
    pub resource_type: Option<String>,
    pub uploaded_at: Option<Timestamp>,
    pub change_type: String,
    pub title: String,
    pub description: Option<String>,
    pub detected_at: Timestamp,
    pub read: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRun {
    pub id: i64,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub status: String,
    pub discovered_count: i64,
    pub new_count: i64,
    pub updated_count: i64,
    pub unavailable_count: i64,
    pub courses_scanned: i64,
    pub courses_failed: i64,
    pub error_summary: Option<String>,
    pub is_baseline: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub running: bool,
    pub phase: String,
    pub progress: f32,
    pub last_success_at: Option<Timestamp>,
    pub next_scheduled_at: Option<Timestamp>,
    /// Unread `new`/`announcement` change events. Derived from the canonical
    /// `change_events` table so the menu bar, the History badge and the
    /// Dashboard all agree instead of resetting after every scan.
    pub unread_new: i64,
    pub last_error: Option<String>,
    pub auth_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    pub email: Option<String>,
    pub full_name: Option<String>,
    pub method: Option<String>,
    pub acquired_at: Option<Timestamp>,
    pub session_expired: bool,
}

/// Result of checking the current in-memory Moodle session without starting
/// another authentication flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRefreshResult {
    /// `restored`, `login_required`, or `failed`.
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResetResult {
    /// `connected`, `login_required`, or `failed`.
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Digest {
    pub date: String,
    pub new_count: i64,
    pub updated_count: i64,
    pub announcement_count: i64,
    pub deadline_count: i64,
    pub unavailable_count: i64,
    pub courses_failed: i64,
    pub last_success_at: Option<Timestamp>,
    pub items: Vec<ChangeEvent>,
}

/// Result of a discovery scan, before it is written to the UI.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOutcome {
    pub discovered: usize,
    pub new: usize,
    pub updated: usize,
    pub unavailable: usize,
    pub courses_scanned: usize,
    pub courses_failed: usize,
    pub errors: Vec<String>,
    pub auth_expired: bool,
    pub cancelled: bool,
}

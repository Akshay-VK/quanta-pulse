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
    /// Local presentation override; never used as the Quanta identity.
    pub display_name: Option<String>,
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
    /// Deadline for assignments and quizzes, if known: RFC 3339 instant or
    /// YYYY-MM-DD when the source supplies only a date.
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

/// Filter and explicit pagination for the History Activity tab.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilter {
    pub change_type: Option<String>,
    pub course_id: Option<i64>,
    /// Inclusive RFC 3339 timestamp.
    pub since: Option<Timestamp>,
    /// Exclusive RFC 3339 timestamp.
    pub until: Option<Timestamp>,
    pub search: Option<String>,
    pub offset: usize,
    pub limit: usize,
}

/// Complete filtered total and one page of History activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub items: Vec<ChangeEvent>,
    pub total: usize,
}

/// Explicit pagination for History scan runs. The History scan recipe has no
/// additional filters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFilter {
    pub offset: usize,
    pub limit: usize,
}

/// Complete History scan total and one page of runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPage {
    pub items: Vec<ScanRun>,
    pub total: usize,
}

/// Exact History IDs frozen for a destructive confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDeletionScope {
    pub event_ids: Vec<i64>,
    pub scan_ids: Vec<i64>,
}

/// Number of rows removed from a previously confirmed History scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDeletionResult {
    pub events_deleted: usize,
    pub scans_deleted: usize,
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

/// Terminal state observed for a course scan or one of its steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanCourseStatus {
    Success,
    Partial,
    Failed,
    Cancelled,
}

/// Persisted per-course observations for one scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDetails {
    pub scan_id: i64,
    pub courses: Vec<ScanCourseDetail>,
}

/// Actual timing, result and steps observed for a course during a scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCourseDetail {
    pub course_id: Option<i64>,
    pub course_name: String,
    pub status: ScanCourseStatus,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub steps: Vec<ScanStep>,
    pub error: Option<String>,
}

/// Actual step timing and result observed during a course scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStep {
    pub label: String,
    pub status: ScanCourseStatus,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub error: Option<String>,
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
    pub attempt_id: Option<String>,
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
    pub committed: bool,
}

/// Local byte-cache occupancy, for Settings > Data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub file_count: i64,
    pub total_bytes: i64,
    pub limit_bytes: u64,
}

/// One resource's permanent local copy, resolved to an absolute path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    pub resource_id: i64,
    /// Path relative to the mirror root, exactly as stored at write time.
    pub rel_path: String,
    pub path: String,
    pub size_bytes: i64,
    pub mime: Option<String>,
    pub sha256: Option<String>,
    /// queued | downloading | ok | failed | skipped | kept
    pub status: String,
    pub error: Option<String>,
}

/// One resource's mirror state, for row status icons. No path: the UI asks for
/// the path only when the user acts on a file it knows is local.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileStatus {
    pub resource_id: i64,
    /// queued | downloading | ok | failed | skipped | kept
    pub status: String,
    pub error: Option<String>,
}

/// One in-memory mirror download attempt's observed progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorDownloadProgress {
    pub resource_id: i64,
    /// Unique to this attempt so consumers can discard late updates.
    pub attempt_id: String,
    pub state: String,
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub error: Option<String>,
}

/// Mirror occupancy and queue state, for Settings > Files and the sidebar.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorStats {
    pub queued: i64,
    pub downloading: i64,
    pub done: i64,
    pub failed: i64,
    pub skipped: i64,
    /// Local copies Quanta no longer serves. Never deleted automatically.
    pub kept: i64,
    /// Resources that can have a local copy at all.
    pub total_resources: i64,
    pub bytes_done: i64,
    pub bytes_total: i64,
    /// idle | running | paused | low_disk | waiting_for_sign_in
    pub state: String,
    pub root: String,
    pub free_bytes: u64,
}

/// Attention filtering is independent from the recorded change type.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Attention {
    #[default]
    All,
    Unread,
}

/// Complete collection filters. Offset pagination is stable for an unchanged snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InboxFilter {
    pub course_id: Option<i64>,
    pub change_type: Option<String>,
    pub attention: Attention,
    pub search: Option<String>,
    pub offset: usize,
    pub limit: usize,
}
impl Default for InboxFilter {
    fn default() -> Self {
        Self {
            course_id: None,
            change_type: None,
            attention: Attention::All,
            search: None,
            offset: 0,
            limit: 100,
        }
    }
}

/// One surviving resource group, or one recorded orphan event. All IDs are
/// non-dismissed relevant events; matching a type selects the whole group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub key: String,
    pub resource_id: Option<i64>,
    pub course_id: Option<i64>,
    pub latest_event: ChangeEvent,
    pub event_ids: Vec<i64>,
    pub change_types: Vec<String>,
    pub unread: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxCourseCount {
    pub course_id: Option<i64>,
    pub total: usize,
    pub unread_total: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxPage {
    pub items: Vec<InboxItem>,
    pub total: usize,
    pub unread_total: usize,
    pub course_counts: Vec<InboxCourseCount>,
}

/// Due bounds are inclusive `from`, exclusive `until`; accept RFC 3339 or
/// YYYY-MM-DD (midnight UTC). No implicit current time or submission status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DueFilter {
    pub course_id: Option<i64>,
    pub resource_type: Option<String>,
    pub search: Option<String>,
    pub from: Option<String>,
    pub until: Option<String>,
    /// Optional local calendar bounds for date-only sources; override the
    /// instant range for those sources without assigning them a timezone.
    pub date_from: Option<String>,
    pub date_until: Option<String>,
    pub offset: usize,
    pub limit: usize,
}
impl Default for DueFilter {
    fn default() -> Self {
        Self {
            course_id: None,
            resource_type: None,
            search: None,
            from: None,
            until: None,
            date_from: None,
            date_until: None,
            offset: 0,
            limit: 100,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DueDateKind {
    Date,
    Instant,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DueResource {
    pub resource: Resource,
    pub date_kind: DueDateKind,
    pub course_paused: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuePage {
    pub items: Vec<DueResource>,
    pub total: usize,
}

//! Private academic storage and read authority. No collectors are scheduled here.
//!
//! Lock order is academic authority -> SQLite; neither guard crosses an await.
//! Only verified authentication installs an owner. Process restart starts locked.
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db, state::AppState};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicOwner {
    pub origin: String,
    pub moodle_user_id: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicContext {
    pub contract_version: u32,
    pub generation: String,
    pub owner: Option<AcademicOwner>,
    /// V1 has not verified any deployed domain or unattended request policy.
    pub collectors_enabled: bool,
}

pub(crate) struct Authority {
    context: AcademicContext,
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
impl Default for Authority {
    fn default() -> Self {
        Self {
            cancelled: Default::default(),
            context: AcademicContext {
                contract_version: 1,
                generation: uuid::Uuid::new_v4().to_string(),
                owner: None,
                collectors_enabled: false,
            },
        }
    }
}
impl Authority {
    pub(crate) fn replace(&mut self, owner: Option<AcademicOwner>) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.cancelled = Default::default();
        self.context.generation = uuid::Uuid::new_v4().to_string();
        self.context.owner = owner;
    }
    pub(crate) fn is_generation(&self, generation: &str) -> bool {
        self.context.generation == generation
    }
    pub(crate) fn reminder_owner(&self, generation: &str) -> Option<&AcademicOwner> {
        self.check(generation).ok()
    }
    fn check(&self, generation: &str) -> Result<&AcademicOwner, String> {
        if self.context.generation != generation {
            return Err("Academic session changed".into());
        }
        self.context
            .owner
            .as_ref()
            .ok_or_else(|| "Verified student required".into())
    }
}

pub fn context(state: &AppState) -> AcademicContext {
    state.sync.academic.lock().unwrap().context.clone()
}
/// Hide immediately, also when a reset later fails to drain or sign in.
pub fn invalidate(state: &AppState) {
    state.sync.academic.lock().unwrap().replace(None);
}

/// Account-change admission hides private reads immediately even if the new
/// authentication fails. Material retention remains under its existing policy.
pub fn begin_account_change(state: &AppState) -> String {
    invalidate(state);
    state
        .sync
        .cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
    context(state).generation
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Coverage {
    Complete,
    Partial,
    Denied,
    Unsupported,
    Offline,
    Cancelled,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Visibility {
    Visible,
    Hidden,
    Unreleased,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum AcademicDate {
    Unknown,
    Unsupported,
    Unset,
    Instant(String),
    DateOnly(String),
    Ambiguous(String),
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicSource {
    pub source_id: String,
    pub source_url: String,
    pub observed_at: String,
    pub visibility: Visibility,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentObservation {
    pub source: AcademicSource,
    pub title: String,
    pub course_module_id: Option<i64>,
    pub activity_instance_id: Option<i64>,
    pub resource_id: Option<i64>,
    pub due: AcademicDate,
    pub due_display: Option<String>,
    pub submission_display: Option<String>,
    pub calendar_event_id: Option<i64>,
    pub submission_status: SubmissionStatus,
    pub attempt_number: Option<i64>,
    #[serde(default)]
    pub details: Option<AssignmentFacts>,
}

/// Source values survive independently of the projected student deadline.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentFacts {
    pub base_due: AcademicDate,
    pub effective_due: AcademicDate,
    pub opening: AcademicDate,
    pub extension: AcademicDate,
    pub cut_off: AcademicDate,
    pub grading_due: AcademicDate,
    pub due_provenance: DueProvenance,
    pub mode: SubmissionMode,
    pub pending_team_confirmations: Option<u32>,
    pub time_limit_seconds: Option<u32>,
    pub description: Option<String>,
    pub attachments: Vec<AssignmentAttachment>,
    pub grading_status: Option<String>,
    pub released_feedback: Option<String>,
}

/// A reference linked from the assignment introduction.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentAttachment {
    pub title: String,
    pub url: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DueProvenance {
    Unknown,
    Base,
    Effective,
    Extension,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmissionMode {
    Unknown,
    Individual,
    Team,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmissionStatus {
    Unknown,
    Unsubmitted,
    Draft,
    Submitted,
    Reopened,
    NotRequired,
    NotYetOpen,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GradeKind {
    Item,
    Category,
    CourseTotal,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeObservation {
    pub source: AcademicSource,
    pub title: String,
    pub grade_item_id: Option<i64>,
    pub parent_source_id: Option<String>,
    pub item_kind: GradeKind,
    pub display_value: Option<String>,
    pub numeric_value: Option<f64>,
    pub range_display: Option<String>,
    pub weight_display: Option<String>,
    /// Plain released text only; authenticated HTML is never stored.
    pub feedback: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceObservation {
    pub source: AcademicSource,
    pub activity_instance_id: i64,
    pub course_module_id: Option<i64>,
    /// None means a scoped report snapshot, never a fabricated session ID.
    pub session_id: Option<i64>,
    pub scope_display: String,
    pub status_display: Option<String>,
    pub points_display: Option<String>,
    pub maximum_display: Option<String>,
    pub summary_display: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AcademicBatch {
    Assignments(Vec<AssignmentObservation>),
    Grades(Vec<GradeObservation>),
    Attendance(Vec<AttendanceObservation>),
}
impl AcademicBatch {
    fn domain(&self) -> &'static str {
        match self {
            Self::Assignments(_) => "assignments",
            Self::Grades(_) => "grades",
            Self::Attendance(_) => "attendance",
        }
    }
    fn sources(&self) -> Vec<&AcademicSource> {
        match self {
            Self::Assignments(v) => v.iter().map(|r| &r.source).collect(),
            Self::Grades(v) => v.iter().map(|r| &r.source).collect(),
            Self::Attendance(v) => v.iter().map(|r| &r.source).collect(),
        }
    }
    fn sources_mut(&mut self) -> Vec<&mut AcademicSource> {
        match self {
            Self::Assignments(v) => v.iter_mut().map(|r| &mut r.source).collect(),
            Self::Grades(v) => v.iter_mut().map(|r| &mut r.source).collect(),
            Self::Attendance(v) => v.iter_mut().map(|r| &mut r.source).collect(),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AcademicPermission {
    Unknown,
    Permitted,
    Restricted,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverageReason {
    IncompleteSource,
    PermissionDenied,
    SourceUnverified,
    NetworkUnavailable,
    WorkCancelled,
    CollectionFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicCoverage {
    pub reason: Option<CoverageReason>,
    pub permission: AcademicPermission,
    pub coverage: Coverage,
    pub observed_at: String,
    pub last_successful_at: Option<String>,
    pub baseline_established: bool,
    pub stale: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicPage<T> {
    pub context: AcademicContext,
    pub course_id: i64,
    pub coverage: Option<AcademicCoverage>,
    pub records: Vec<T>,
}
/// Private refresh eligibility, containing no academic values. Not a generic event.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicCommit {
    pub generation: String,
    pub course_id: i64,
    pub domain: String,
    pub changed: bool,
}
/// A caller may publish only while this check still owns the lifecycle lock.
/// Logout/switch waits for this synchronous publication before invalidating it.
pub fn publish_if_current(
    state: &AppState,
    committed: &AcademicCommit,
    publish: impl FnOnce(),
) -> Result<(), String> {
    let authority = state.sync.academic.lock().unwrap();
    authority.check(&committed.generation)?;
    publish();
    Ok(())
}

fn encoded<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("serializable academic enum")
}
fn decoded<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}
fn storage_error(_: rusqlite::Error) -> String {
    "Academic storage unavailable".into()
}

/// Commit an already interpreted observation. This does not fetch or enable a
/// domain. Failure coverage retains prior truth and never consumes a baseline.
pub fn commit(
    state: &AppState,
    generation: &str,
    course_id: i64,
    coverage: Coverage,
    mut batch: AcademicBatch,
) -> Result<AcademicCommit, String> {
    let authority = state.sync.academic.lock().unwrap();
    let owner = authority.check(generation)?;
    if state
        .sync
        .auth_resetting
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Academic session changed".into());
    }
    if state.sync.auth_state() != "authenticated" {
        return Err("Academic collection requires sign-in".into());
    }
    if course_id <= 0 {
        return Err("Invalid course".into());
    }
    let domain = batch.domain();
    for source in batch.sources_mut() {
        source.observed_at = chrono::DateTime::parse_from_rfc3339(&source.observed_at)
            .map_err(|_| "Invalid academic source time")?
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    }
    let mut ids = std::collections::HashSet::new();
    for source in batch.sources() {
        let url = url::Url::parse(&source.source_url).map_err(|_| "Invalid academic source")?;
        let expected_path = match domain {
            "assignments" => "/mod/assign/view.php",
            "grades" => "/grade/report/user/index.php",
            _ => "/mod/attendance/view.php",
        };
        let query: Vec<_> = url.query_pairs().collect();
        if url.path() != expected_path
            || query.len() != 1
            || query[0].0 != "id"
            || query[0]
                .1
                .parse::<i64>()
                .ok()
                .filter(|id| *id > 0)
                .is_none()
            || url.origin().ascii_serialization() != owner.origin
            || !url.username().is_empty()
            || url.password().is_some()
            || source.source_id.is_empty()
            || !ids.insert(&source.source_id)
            || chrono::DateTime::parse_from_rfc3339(&source.observed_at).is_err()
        {
            return Err("Invalid academic source".into());
        }
    }
    if let AcademicBatch::Assignments(rows) = &mut batch {
        for row in rows {
            normalize_date(&mut row.due)?;
            if let Some(details) = &mut row.details {
                for date in [
                    &mut details.base_due,
                    &mut details.effective_due,
                    &mut details.opening,
                    &mut details.extension,
                    &mut details.cut_off,
                    &mut details.grading_due,
                ] {
                    normalize_date(date)?;
                }
            }
            if row.source.visibility != Visibility::Visible {
                row.due = AcademicDate::Unknown;
                row.submission_status = SubmissionStatus::Unknown;
                row.due_display = None;
                row.submission_display = None;
                row.attempt_number = None;
                row.details = None;
            }
        }
    }
    if let AcademicBatch::Grades(rows) = &mut batch {
        for row in rows {
            if row.numeric_value.is_some_and(|v| !v.is_finite()) {
                return Err("Invalid academic grade".into());
            }
            if let Some(feedback) = &row.feedback {
                if feedback.contains('<') {
                    row.feedback = Some(crate::quanta::parse::extract_readable_text(feedback));
                }
            }
        }
    }
    let now = db::now_rfc3339();
    let mut conn = state.conn();
    let tx = conn.transaction().map_err(storage_error)?;
    let prior: Option<(bool, Option<String>)> = tx.query_row("SELECT baseline, fingerprint FROM academic_coverage WHERE origin=?1 AND owner_id=?2 AND course_id=?3 AND domain=?4", params![owner.origin, owner.moodle_user_id, course_id, domain], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(storage_error)?;
    let complete = coverage == Coverage::Complete;
    if complete {
        let table = match &batch {
            AcademicBatch::Assignments(_) => "academic_assignments",
            AcademicBatch::Grades(_) => "academic_grades",
            AcademicBatch::Attendance(_) => "academic_attendance",
        };
        // A complete assignment inventory is a snapshot. Grade omission alone
        // is not visibility loss; attendance may contain separate report scopes.
        if matches!(batch, AcademicBatch::Assignments(_)) {
            tx.execute(
                &format!("DELETE FROM {table} WHERE origin=?1 AND owner_id=?2 AND course_id=?3"),
                params![owner.origin, owner.moodle_user_id, course_id],
            )
            .map_err(storage_error)?;
        }
        match &batch {
            AcademicBatch::Assignments(rows) => {
                for r in rows {
                    tx.execute("INSERT INTO academic_assignments VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)", params![owner.origin,owner.moodle_user_id,course_id,r.source.source_id,r.source.source_url,r.source.observed_at,encoded(&r.source.visibility),r.title,r.course_module_id,r.activity_instance_id,r.resource_id,encoded(&r.due),encoded(&r.submission_status),r.attempt_number,r.due_display,r.submission_display,r.calendar_event_id,r.details.as_ref().map(encoded)]).map_err(storage_error)?;
                }
            }
            AcademicBatch::Grades(rows) => {
                for r in rows {
                    tx.execute("INSERT INTO academic_grades VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) ON CONFLICT(origin,owner_id,course_id,source_id) DO UPDATE SET source_url=excluded.source_url, observed_at=excluded.observed_at, visibility=excluded.visibility, title=excluded.title, grade_item_id=excluded.grade_item_id, parent_source_id=excluded.parent_source_id, item_kind=excluded.item_kind, display_value=excluded.display_value, numeric_value=excluded.numeric_value, range_display=excluded.range_display, weight_display=excluded.weight_display, feedback=excluded.feedback", params![owner.origin,owner.moodle_user_id,course_id,r.source.source_id,r.source.source_url,r.source.observed_at,encoded(&r.source.visibility),r.title,r.grade_item_id,r.parent_source_id,encoded(&r.item_kind),r.display_value,r.numeric_value,r.range_display,r.weight_display,r.feedback]).map_err(storage_error)?;
                }
            }
            AcademicBatch::Attendance(rows) => {
                for r in rows {
                    tx.execute("INSERT INTO academic_attendance VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) ON CONFLICT(origin,owner_id,course_id,source_id) DO UPDATE SET source_url=excluded.source_url, observed_at=excluded.observed_at, visibility=excluded.visibility, activity_instance_id=excluded.activity_instance_id, session_id=excluded.session_id, scope_display=excluded.scope_display, status_display=excluded.status_display, points_display=excluded.points_display, maximum_display=excluded.maximum_display, summary_display=excluded.summary_display, course_module_id=excluded.course_module_id", params![owner.origin,owner.moodle_user_id,course_id,r.source.source_id,r.source.source_url,r.source.observed_at,encoded(&r.source.visibility),r.activity_instance_id,r.session_id,r.scope_display,r.status_display,r.points_display,r.maximum_display,r.summary_display,r.course_module_id]).map_err(storage_error)?;
                }
            }
        }
    }
    // Never retain marks/feedback from a non-visible observation, even if an
    // upstream adapter accidentally supplied them alongside a restriction.
    match domain {
        "grades" => {
            tx.execute("UPDATE academic_grades SET display_value=NULL,numeric_value=NULL,range_display=NULL,weight_display=NULL,feedback=NULL WHERE origin=?1 AND owner_id=?2 AND course_id=?3 AND visibility!='\"visible\"'",params![owner.origin,owner.moodle_user_id,course_id]).map_err(storage_error)?;
        }
        "attendance" => {
            tx.execute("UPDATE academic_attendance SET status_display=NULL,points_display=NULL,maximum_display=NULL,summary_display=NULL WHERE origin=?1 AND owner_id=?2 AND course_id=?3 AND visibility!='\"visible\"'",params![owner.origin,owner.moodle_user_id,course_id]).map_err(storage_error)?;
        }
        _ => {}
    }
    if coverage == Coverage::Denied {
        // Explicit permission loss removes values, retaining only source identity
        // and baseline. A later failure/empty report cannot resurrect them.
        let sql = match domain {
            "assignments" => "UPDATE academic_assignments SET visibility='\"hidden\"',due_value='{\"kind\":\"unknown\"}',submission_status='\"unknown\"',attempt_number=NULL,due_display=NULL,submission_display=NULL,details=NULL WHERE origin=?1 AND owner_id=?2 AND course_id=?3",
            "grades" => "UPDATE academic_grades SET visibility='\"hidden\"',display_value=NULL,numeric_value=NULL,range_display=NULL,weight_display=NULL,feedback=NULL WHERE origin=?1 AND owner_id=?2 AND course_id=?3",
            _ => "UPDATE academic_attendance SET visibility='\"hidden\"',status_display=NULL,points_display=NULL,maximum_display=NULL,summary_display=NULL WHERE origin=?1 AND owner_id=?2 AND course_id=?3",
        };
        tx.execute(sql, params![owner.origin, owner.moodle_user_id, course_id])
            .map_err(storage_error)?;
    }
    let fingerprint = scope_fingerprint(&tx, owner, course_id, domain).map_err(storage_error)?;
    let changed = complete
        && prior
            .as_ref()
            .is_some_and(|(baseline, old)| *baseline && old.as_ref() != Some(&fingerprint));
    tx.execute("INSERT INTO academic_coverage(origin,owner_id,course_id,domain,coverage,observed_at,last_successful_at,baseline,fingerprint,permission) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(origin,owner_id,course_id,domain) DO UPDATE SET coverage=excluded.coverage,observed_at=excluded.observed_at,last_successful_at=COALESCE(excluded.last_successful_at,academic_coverage.last_successful_at),baseline=MAX(academic_coverage.baseline,excluded.baseline),fingerprint=COALESCE(excluded.fingerprint,academic_coverage.fingerprint),permission=CASE WHEN excluded.permission='\"unknown\"' THEN academic_coverage.permission ELSE excluded.permission END", params![owner.origin,owner.moodle_user_id,course_id,domain,encoded(&coverage),now,complete.then_some(&now),complete,Some(fingerprint),encoded(&if coverage == Coverage::Denied {AcademicPermission::Restricted} else if complete {AcademicPermission::Permitted} else {AcademicPermission::Unknown})]).map_err(storage_error)?;
    tx.commit().map_err(storage_error)?;
    Ok(AcademicCommit {
        generation: generation.into(),
        course_id,
        domain: domain.into(),
        changed,
    })
}

fn scope_fingerprint(
    conn: &rusqlite::Connection,
    owner: &AcademicOwner,
    course_id: i64,
    domain: &str,
) -> rusqlite::Result<String> {
    let table = match domain {
        "assignments" => "academic_assignments",
        "grades" => "academic_grades",
        _ => "academic_attendance",
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT * FROM {table} WHERE origin=?1 AND owner_id=?2 AND course_id=?3 ORDER BY source_id"
    ))?;
    let count = stmt.column_count();
    let rows = stmt
        .query_map(
            params![owner.origin, owner.moodle_user_id, course_id],
            |row| {
                let mut values = Vec::new();
                for column in 3..count {
                    if column == 5 {
                        continue;
                    }
                    let value: rusqlite::types::Value = row.get(column)?;
                    // A revision-9 assignment with no new facts keeps its fingerprint.
                    if domain == "assignments"
                        && column == 17
                        && value == rusqlite::types::Value::Null
                    {
                        continue;
                    }
                    values.push(format!("{value:?}"));
                }
                Ok(values)
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&rows)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
    )))
}

fn coverage(
    conn: &rusqlite::Connection,
    owner: &AcademicOwner,
    course: i64,
    domain: &str,
) -> Result<Option<AcademicCoverage>, String> {
    conn.query_row("SELECT coverage,observed_at,last_successful_at,baseline,permission FROM academic_coverage WHERE origin=?1 AND owner_id=?2 AND course_id=?3 AND domain=?4", params![owner.origin,owner.moodle_user_id,course,domain], |r| {
        let coverage: Coverage = decoded(r.get(0)?)?;
        Ok(AcademicCoverage { permission:decoded(r.get(4)?)?, reason:match coverage {Coverage::Complete=>None,Coverage::Partial=>Some(CoverageReason::IncompleteSource),Coverage::Denied=>Some(CoverageReason::PermissionDenied),Coverage::Unsupported=>Some(CoverageReason::SourceUnverified),Coverage::Offline=>Some(CoverageReason::NetworkUnavailable),Coverage::Cancelled=>Some(CoverageReason::WorkCancelled),Coverage::Failed=>Some(CoverageReason::CollectionFailed)}, coverage, observed_at:r.get(1)?,last_successful_at:r.get(2)?,baseline_established:r.get(3)?,stale:coverage != Coverage::Complete })
    }).optional().map_err(storage_error)
}
fn session_coverage(
    state: &AppState,
    conn: &rusqlite::Connection,
    owner: &AcademicOwner,
    course_id: i64,
    domain: &str,
) -> Result<Option<AcademicCoverage>, String> {
    let mut coverage = coverage(conn, owner, course_id, domain)?;
    if state.sync.auth_state() != "authenticated" {
        if let Some(coverage) = &mut coverage {
            coverage.stale = true;
        }
    }
    Ok(coverage)
}

fn visible(coverage: &Option<AcademicCoverage>) -> bool {
    coverage.as_ref().is_some_and(|c| {
        c.last_successful_at.is_some()
            && c.permission == AcademicPermission::Permitted
            && !matches!(c.coverage, Coverage::Denied | Coverage::Unsupported)
    })
}
fn source(row: &rusqlite::Row<'_>) -> rusqlite::Result<AcademicSource> {
    Ok(AcademicSource {
        source_id: row.get(3)?,
        source_url: row.get(4)?,
        observed_at: row.get(5)?,
        visibility: decoded(row.get(6)?)?,
    })
}
pub fn assignments(
    state: &AppState,
    generation: &str,
    course_id: i64,
) -> Result<AcademicPage<AssignmentObservation>, String> {
    let authority = state.sync.academic.lock().unwrap();
    let owner = authority.check(generation)?;
    let conn = state.conn();
    let coverage = session_coverage(state, &conn, owner, course_id, "assignments")?;
    let records = if visible(&coverage) {
        let mut stmt = conn.prepare("SELECT * FROM academic_assignments WHERE origin=?1 AND owner_id=?2 AND course_id=?3 AND visibility='\"visible\"' ORDER BY source_id").map_err(storage_error)?;
        let rows = stmt
            .query_map(
                params![owner.origin, owner.moodle_user_id, course_id],
                |r| {
                    Ok(AssignmentObservation {
                        source: source(r)?,
                        title: r.get(7)?,
                        course_module_id: r.get(8)?,
                        activity_instance_id: r.get(9)?,
                        resource_id: r.get(10)?,
                        due: decoded(r.get(11)?)?,
                        submission_status: decoded(r.get(12)?)?,
                        attempt_number: r.get(13)?,
                        due_display: r.get(14)?,
                        submission_display: r.get(15)?,
                        calendar_event_id: r.get(16)?,
                        details: r.get::<_, Option<String>>(17)?.map(decoded).transpose()?,
                    })
                },
            )
            .map_err(storage_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?
    } else {
        vec![]
    };
    Ok(AcademicPage {
        context: authority.context.clone(),
        course_id,
        coverage,
        records,
    })
}
pub fn grades(
    state: &AppState,
    generation: &str,
    course_id: i64,
) -> Result<AcademicPage<GradeObservation>, String> {
    let authority = state.sync.academic.lock().unwrap();
    let owner = authority.check(generation)?;
    let conn = state.conn();
    let coverage = session_coverage(state, &conn, owner, course_id, "grades")?;
    let records = if visible(&coverage) {
        let mut stmt = conn.prepare("SELECT * FROM academic_grades WHERE origin=?1 AND owner_id=?2 AND course_id=?3 ORDER BY source_id").map_err(storage_error)?;
        let rows = stmt
            .query_map(
                params![owner.origin, owner.moodle_user_id, course_id],
                |r| {
                    Ok(GradeObservation {
                        source: source(r)?,
                        title: r.get(7)?,
                        grade_item_id: r.get(8)?,
                        parent_source_id: r.get(9)?,
                        item_kind: decoded(r.get(10)?)?,
                        display_value: r.get(11)?,
                        numeric_value: r.get(12)?,
                        range_display: r.get(13)?,
                        weight_display: r.get(14)?,
                        feedback: r.get(15)?,
                    })
                },
            )
            .map_err(storage_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?
    } else {
        vec![]
    };
    Ok(AcademicPage {
        context: authority.context.clone(),
        course_id,
        coverage,
        records,
    })
}
pub fn attendance(
    state: &AppState,
    generation: &str,
    course_id: i64,
) -> Result<AcademicPage<AttendanceObservation>, String> {
    let authority = state.sync.academic.lock().unwrap();
    let owner = authority.check(generation)?;
    let conn = state.conn();
    let coverage = session_coverage(state, &conn, owner, course_id, "attendance")?;
    let records = if visible(&coverage) {
        let mut stmt = conn.prepare("SELECT * FROM academic_attendance WHERE origin=?1 AND owner_id=?2 AND course_id=?3 ORDER BY source_id").map_err(storage_error)?;
        let rows = stmt
            .query_map(
                params![owner.origin, owner.moodle_user_id, course_id],
                |r| {
                    Ok(AttendanceObservation {
                        source: source(r)?,
                        activity_instance_id: r.get(7)?,
                        session_id: r.get(8)?,
                        scope_display: r.get(9)?,
                        status_display: r.get(10)?,
                        points_display: r.get(11)?,
                        maximum_display: r.get(12)?,
                        summary_display: r.get(13)?,
                        course_module_id: r.get(14)?,
                    })
                },
            )
            .map_err(storage_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?
    } else {
        vec![]
    };
    Ok(AcademicPage {
        context: authority.context.clone(),
        course_id,
        coverage,
        records,
    })
}
#[cfg(test)]
impl AssignmentObservation {
    pub(crate) fn synthetic(id: &str, title: &str) -> Self {
        Self {
            source: AcademicSource {
                source_id: id.into(),
                source_url: format!(
                    "{}/mod/assign/view.php?id=13",
                    crate::quanta::client::QUANTA_ORIGIN
                ),
                observed_at: "2026-11-21T00:00:00Z".into(),
                visibility: Visibility::Visible,
            },
            title: title.into(),
            course_module_id: Some(13),
            activity_instance_id: Some(29),
            resource_id: None,
            due: AcademicDate::Unknown,
            due_display: None,
            submission_display: None,
            calendar_event_id: None,
            submission_status: SubmissionStatus::Draft,
            attempt_number: Some(1),
            details: None,
        }
    }
}

/// Explicit internal operation only: no Tauri request command or scheduler calls
/// it. Reuses reset admission/draining and cancels in-flight old-generation reads.
pub async fn read_student_report(
    state: &AppState,
    generation: &str,
    report: crate::quanta::client::StudentReport,
) -> Result<crate::quanta::client::Fetched, crate::quanta::client::StudentReportError> {
    use crate::quanta::client::StudentReportError;
    use std::sync::atomic::Ordering;
    let _lease = state
        .sync
        .begin_preview()
        .ok_or(StudentReportError::SessionChanged)?;
    // Keep a narrow, fixed admission budget until V1 determines source volume.
    if state
        .sync
        .student_report_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(StudentReportError::Unavailable);
    }
    struct ReportAdmission<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for ReportAdmission<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _admission = ReportAdmission(&state.sync.student_report_active);
    let (client, cancelled) = {
        let authority = state.sync.academic.lock().unwrap();
        authority
            .check(generation)
            .map_err(|_| StudentReportError::SessionChanged)?;
        if state.sync.auth_state() != "authenticated" {
            return Err(StudentReportError::AuthExpired);
        }
        (
            state.client().ok_or(StudentReportError::SessionChanged)?,
            authority.cancelled.clone(),
        )
    };
    let result = tokio::select! {
        result = client.read_student_report(report) => result,
        _ = async { loop { if cancelled.load(Ordering::SeqCst) { break; } tokio::time::sleep(std::time::Duration::from_millis(25)).await; } } => return Err(StudentReportError::SessionChanged),
    };
    let authority = state.sync.academic.lock().unwrap();
    authority
        .check(generation)
        .map_err(|_| StudentReportError::SessionChanged)?;
    if matches!(result, Err(StudentReportError::AuthExpired)) {
        state.sync.set_auth_state("expired");
    }
    result
}

fn normalize_date(date: &mut AcademicDate) -> Result<(), String> {
    match date {
        AcademicDate::Instant(value) => {
            *value = chrono::DateTime::parse_from_rfc3339(value)
                .map_err(|_| "Invalid academic instant")?
                .with_timezone(&chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        }
        AcademicDate::DateOnly(value) => {
            let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| "Invalid academic date")?;
            if date.to_string() != *value {
                return Err("Invalid academic date".into());
            }
        }
        _ => {}
    }
    Ok(())
}

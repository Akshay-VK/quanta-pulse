//! Durable resource reconciliation, independent of Tauri.
//! Inventory, diffs/events, baseline generations and missing-resource decisions
//! commit together. Only a committed result permits adapter delivery effects.

use crate::academic::{AcademicDate, AcademicOwner, SubmissionMode, SubmissionStatus};
use crate::db::{self, ResourceWrite};
use crate::quanta::{discover, DiscoveredResource};
use crate::sync::diff::{self, Detected};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

/// Two complete scans must miss a material before it becomes unavailable.
const MISS_THRESHOLD: i64 = 2;

/// Read only the stored facts used by the resource diff. Unlike UI convenience
/// reads, reconciliation must distinguish an absent row from a failed read.
fn previous_state(
    conn: &rusqlite::Connection,
    external_id: &str,
) -> rusqlite::Result<Option<diff::PreviousState>> {
    conn.query_row(
        "SELECT content_fingerprint, availability_status, due_at, uploaded_at, published_at, title
         FROM resources WHERE external_resource_id = ?1",
        [external_id],
        |row| {
            Ok(diff::PreviousState {
                fingerprint: row.get(0)?,
                availability: row.get(1)?,
                due_at: row.get(2)?,
                uploaded_at: row.get(3)?,
                published_at: row.get(4)?,
                title: row.get(5)?,
            })
        },
    )
    .optional()
}

fn read_setting(conn: &rusqlite::Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
}

/// Baseline decisions captured before collecting data. Legacy databases can
/// omit reset keys, but an unreadable or malformed key must stop the scan.
pub(crate) struct BaselineState {
    pub established: bool,
    pub generation: i64,
    pub global_generation: i64,
    pub rebaseline: HashSet<i64>,
}

impl BaselineState {
    pub(crate) fn capture(conn: &rusqlite::Connection) -> Result<Self, String> {
        let established = baseline_setting(conn, "baseline_established")?
            .map(|raw| {
                chrono::DateTime::parse_from_rfc3339(&raw)
                    .map_err(|error| format!("invalid baseline_established: {error}"))
            })
            .transpose()?
            .is_some();
        Ok(Self {
            established,
            generation: baseline_generation_value(conn, "baseline_reset_generation")?,
            global_generation: baseline_generation_value(conn, "baseline_global_reset_generation")?,
            rebaseline: rebaseline_courses(conn)?,
        })
    }
}

fn baseline_setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    read_setting(conn, key).map_err(|error| format!("could not read {key}: {error}"))
}

fn baseline_generation_value(conn: &rusqlite::Connection, key: &str) -> Result<i64, String> {
    baseline_setting(conn, key)?.map_or(Ok(0), |raw| {
        raw.parse::<u64>()
            .ok()
            .and_then(|generation| i64::try_from(generation).ok())
            .ok_or_else(|| format!("invalid {key}"))
    })
}

fn rebaseline_courses(conn: &rusqlite::Connection) -> Result<HashSet<i64>, String> {
    baseline_setting(conn, "rebaseline_courses")?.map_or_else(
        || Ok(HashSet::new()),
        |raw| {
            serde_json::from_str(&raw)
                .map_err(|error| format!("invalid rebaseline_courses: {error}"))
        },
    )
}

/// Remove only start-of-scan reset markers for courses that completed a full
/// discovery. The setting is re-read before writing to preserve requests added
/// by another command while the scan was in progress.
#[cfg(test)]
fn consume_completed_rebaseline_markers(
    conn: &mut rusqlite::Connection,
    markers_at_start: &HashSet<i64>,
    completed_course_ids: &HashSet<i64>,
    captured_generation: i64,
    cancelled: bool,
) -> Result<(), String> {
    if cancelled {
        return Ok(());
    }
    let consumed: HashSet<i64> = markers_at_start
        .intersection(completed_course_ids)
        .copied()
        .collect();
    if consumed.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    consume_rebaseline_markers(&tx, &consumed, captured_generation)?;
    tx.commit().map_err(|error| error.to_string())
}

fn consume_rebaseline_markers(
    conn: &rusqlite::Connection,
    consumed: &HashSet<i64>,
    captured_generation: i64,
) -> Result<(), String> {
    if consumed.is_empty() {
        return Ok(());
    }
    let current_generation = baseline_generation_value(conn, "baseline_reset_generation")?;
    if current_generation != captured_generation {
        return Ok(());
    }
    let current = rebaseline_courses(conn)?;
    let mut remaining: Vec<i64> = current.difference(&consumed).copied().collect();
    remaining.sort_unstable();
    if remaining.is_empty() {
        db::del_kv(conn, "rebaseline_courses").map_err(|error| error.to_string())?;
    } else {
        db::set_kv(
            conn,
            "rebaseline_courses",
            &serde_json::to_string(&remaining).expect("course IDs always serialize"),
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn course_is_baseline(
    global_baseline: bool,
    rebaseline: &HashSet<i64>,
    paused: &HashSet<i64>,
    course_id: Option<i64>,
) -> bool {
    global_baseline
        || course_id
            .map(|id| rebaseline.contains(&id) || paused.contains(&id))
            .unwrap_or(false)
}

fn event_copy(
    kind: &str,
    r: &crate::quanta::DiscoveredResource,
    detected: &Detected,
) -> (String, String) {
    match kind {
        "new" => (
            format!("{} added", r.title),
            format!("New material in {}: {}", course_label(r), r.title),
        ),
        "announcement" => (
            format!("Announcement: {}", r.title),
            format!("New announcement in {}", course_label(r)),
        ),
        "updated" => {
            let reason = match detected {
                Detected::Updated { reason } => reason.clone(),
                _ => "content updated".to_string(),
            };
            (
                format!("{} updated", r.title),
                format!("{} was updated ({reason})", r.title),
            )
        }
        "deadline" => (
            format!("Deadline: {}", r.title),
            format!("A deadline for {} changed", r.title),
        ),
        "unavailable" => (
            format!("{} is unavailable", r.title),
            format!(
                "{} no longer appears available in {}",
                r.title,
                course_label(r)
            ),
        ),
        "restored" => (
            format!("{} is available again", r.title),
            format!("{} is accessible again", r.title),
        ),
        _ => (r.title.clone(), String::new()),
    }
}

fn course_label(r: &crate::quanta::DiscoveredResource) -> String {
    r.section
        .clone()
        .unwrap_or_else(|| format!("course {}", r.course_external_id))
}

/// Interpret a stored `due_at` as a UTC instant, treating naive values as local.
fn due_instant(due: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    use chrono::TimeZone;
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(due) {
        return Some(dt.with_timezone(&chrono::Utc));
    }
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(due, "%Y-%m-%dT%H:%M") {
        return chrono::Local
            .from_local_datetime(&ndt)
            .single()
            .map(|l| l.with_timezone(&chrono::Utc));
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(due, "%Y-%m-%d") {
        let ndt = d.and_hms_opt(23, 59, 0)?;
        return chrono::Local
            .from_local_datetime(&ndt)
            .single()
            .map(|l| l.with_timezone(&chrono::Utc));
    }
    None
}

/// Result of reconciling one discovered scan into SQLite.
#[derive(Debug, Clone, Default)]
pub struct ReconcileResult {
    pub committed: bool,
    pub errors: Vec<String>,
    pub new: usize,
    pub updated: usize,
    pub unavailable: usize,
    pub missing_ids: Vec<String>,
}

/// Verified owner held by the caller under the academic authority lock.
pub struct AssignmentReminderScope<'a> {
    pub owner: &'a AcademicOwner,
    pub max_age: chrono::Duration,
}

struct AssignmentReminder {
    due: AcademicDate,
    attempt: Option<i64>,
    suppress: bool,
    current: bool,
}

fn assignment_reminder(
    conn: &rusqlite::Connection,
    scope: &AssignmentReminderScope<'_>,
    resource: &DiscoveredResource,
    course_id: i64,
    resource_id: i64,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<AssignmentReminder> {
    use crate::academic::AssignmentFacts;

    let module_id = crate::assignments::module_id(&resource.resource_type, &resource.url)?;
    let owner = scope.owner;
    let source_url = format!("{}/mod/assign/view.php?id={module_id}", owner.origin);
    // Academic storage is optional. Read errors take the original material
    // reminder path and never turn an otherwise valid material scan into failure.
    let mut stmt = conn.prepare_cached(
        "SELECT a.due_value, a.submission_status, a.attempt_number, a.details, a.observed_at, c.last_successful_at, c.coverage
         FROM academic_assignments a JOIN academic_coverage c
         ON c.origin=a.origin AND c.owner_id=a.owner_id AND c.course_id=a.course_id AND c.domain='assignments'
         WHERE a.origin=?1 AND a.owner_id=?2 AND a.course_id=?3 AND a.course_module_id=?4
         AND a.source_url=?5 AND (a.resource_id=?6 OR a.resource_id IS NULL)
         AND a.visibility='\"visible\"' AND c.permission='\"permitted\"'
         AND c.baseline=1 AND c.coverage NOT IN ('\"denied\"', '\"unsupported\"')",
    ).ok()?;
    let mut records = stmt
        .query(rusqlite::params![
            owner.origin,
            owner.moodle_user_id,
            course_id,
            module_id,
            source_url,
            resource_id,
        ])
        .ok()?;
    let row = records.next().ok()??;
    let due = serde_json::from_str::<AcademicDate>(&row.get::<_, String>(0).ok()?).ok()?;
    let status = serde_json::from_str::<SubmissionStatus>(&row.get::<_, String>(1).ok()?).ok()?;
    let attempt = row.get::<_, Option<i64>>(2).ok()?;
    let details = row
        .get::<_, Option<String>>(3)
        .ok()?
        .map(|json| serde_json::from_str::<AssignmentFacts>(&json))
        .transpose()
        .ok()?;
    let fresh = |raw: String| {
        chrono::DateTime::parse_from_rfc3339(&raw)
            .is_ok_and(|time| time <= now && now.signed_duration_since(time) <= scope.max_age)
    };
    let current = row.get::<_, String>(6).ok()? == "\"complete\""
        && fresh(row.get(4).ok()?)
        && fresh(row.get(5).ok()?);
    let suppress = current
        && status == SubmissionStatus::Submitted
        && details.is_some_and(|details| {
            details.mode == SubmissionMode::Individual
                || (details.mode == SubmissionMode::Team
                    && details.pending_team_confirmations == Some(0))
        });
    if records.next().ok()?.is_some() {
        return None;
    }
    Some(AssignmentReminder {
        due,
        attempt,
        suppress,
        current,
    })
}

fn reminder_deadline<'a>(
    material: Option<&'a str>,
    observation: Option<&'a AssignmentReminder>,
) -> Option<&'a str> {
    let Some(observation) = observation else {
        return material;
    };
    if observation.suppress {
        return None;
    }
    match &observation.due {
        AcademicDate::Unset if observation.current => None,
        AcademicDate::Instant(due) | AcademicDate::DateOnly(due)
            if observation.current || material.is_none() =>
        {
            Some(due)
        }
        _ => material,
    }
}

/// Small production collection-to-commit boundary used by `run_scan` and by
/// backend regressions driven through loopback HTTP and real SQLite.
pub fn commit_scan(
    conn: &rusqlite::Connection,
    scan_id: i64,
    discovery: &discover::Discovery,
    baseline: bool,
    baseline_generation: i64,
    global_generation: i64,
    rebaseline: &HashSet<i64>,
    reminder_hours: i64,
    now: &str,
    assignment_scope: Option<AssignmentReminderScope<'_>>,
) -> ReconcileResult {
    let mut result = ReconcileResult::default();
    let mut new_count = 0i64;
    let mut updated_count = 0i64;
    let mut unavailable_count = 0i64;
    let mut seen_ids: Vec<String> = Vec::new();
    let mut missing_ids: Vec<String> = Vec::new();
    let status = discovery_status(discovery);
    let complete = status == "ok";

    let tx = match conn.unchecked_transaction() {
        Ok(tx) => tx,
        Err(e) => {
            result.errors.push(format!("transaction failed: {e}"));
            return result;
        }
    };

    // Courses
    let mut course_ids: HashMap<String, i64> = HashMap::new();
    for course in &discovery.courses {
        match db::upsert_course(
            &tx,
            &course.external_id,
            &course.name,
            course.short_name.as_deref(),
            &course.url,
            now,
        ) {
            Ok(id) => {
                course_ids.insert(course.external_id.clone(), id);
            }
            Err(e) => result
                .errors
                .push(format!("course {}: {e}", course.external_id)),
        }
    }

    let paused = (|| -> rusqlite::Result<HashSet<i64>> {
        let mut stmt = tx.prepare("SELECT id FROM courses WHERE monitoring_status = 'paused'")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect()
    })();
    let paused = match paused {
        Ok(paused) => paused,
        Err(error) => {
            result
                .errors
                .push(format!("paused courses read failed: {error}"));
            return result;
        }
    };
    let mut resource_ids = HashMap::new();

    for r in &discovery.resources {
        let course_id = course_ids.get(&r.course_external_id).copied();
        let previous = match previous_state(&tx, &r.external_id) {
            Ok(previous) => previous,
            Err(error) => {
                result
                    .errors
                    .push(format!("resource {} prior state: {error}", r.external_id));
                continue;
            }
        };
        let availability = if r.available {
            "available"
        } else {
            "unavailable"
        };
        let section_path_json = if r.section_path.is_empty() {
            None
        } else {
            serde_json::to_string(&r.section_path).ok()
        };

        let write = ResourceWrite {
            external_id: &r.external_id,
            course_id,
            title: &r.title,
            url: &r.url,
            source_page_url: r.source_page_url.as_deref(),
            section_path: section_path_json.as_deref(),
            resource_type: &r.resource_type,
            uploaded_at: r.uploaded_at.as_deref(),
            published_at: r.published_at.as_deref(),
            modified_at: r.modified_at.as_deref(),
            due_at: r.due_at.as_deref(),
            fingerprint: &r.fingerprint(),
            size_bytes: r.size_bytes,
            section: r.section.as_deref(),
            is_external: r.is_external,
            availability,
        };

        let resource_id = match db::upsert_resource(&tx, &write, now) {
            Ok(id) => id,
            Err(e) => {
                result
                    .errors
                    .push(format!("resource {}: {e}", r.external_id));
                continue;
            }
        };
        resource_ids.insert(r.external_id.as_str(), resource_id);
        seen_ids.push(r.external_id.clone());

        let effective_baseline = course_is_baseline(baseline, rebaseline, &paused, course_id);
        let detected = diff::classify(previous.as_ref(), r, effective_baseline);
        let kind = if r.resource_type == "announcement" && detected == Detected::New {
            "announcement"
        } else {
            match &detected {
                Detected::New => "new",
                Detected::Updated { .. } => "updated",
                Detected::DeadlineChanged { .. } => "deadline",
                Detected::Unavailable => "unavailable",
                Detected::Restored => "restored",
                Detected::Unchanged => "",
            }
        };

        if kind.is_empty() {
            continue;
        }

        let (title, description) = event_copy(kind, r, &detected);
        let discriminator = match &detected {
            Detected::Updated { .. } => r.fingerprint(),
            Detected::DeadlineChanged { to, .. } => to.clone().unwrap_or_default(),
            Detected::Unavailable => "unavailable".to_string(),
            Detected::Restored => r.fingerprint(),
            _ => r.fingerprint(),
        };
        let key = diff::dedup_key(kind, &r.external_id, &discriminator);

        match db::insert_event(
            &tx,
            Some(resource_id),
            course_id,
            kind,
            &title,
            Some(&description),
            &key,
            now,
        ) {
            Ok(true) => match kind {
                "new" | "announcement" => new_count += 1,
                "updated" | "deadline" => updated_count += 1,
                "unavailable" | "restored" => unavailable_count += 1,
                _ => {}
            },
            Ok(false) => {}
            Err(e) => result.errors.push(format!("event {}: {e}", r.external_id)),
        }
    }

    if complete && result.errors.is_empty() {
        let seen: HashSet<&String> = seen_ids.iter().collect();
        match db::all_resource_external_ids(&tx) {
            Ok(ids) => missing_ids = ids.into_iter().filter(|id| !seen.contains(id)).collect(),
            Err(error) => result
                .errors
                .push(format!("inventory read failed: {error}")),
        }
        for id in &missing_ids {
            if let Err(error) = tx.execute(
                "UPDATE resources SET miss_streak = miss_streak + 1 WHERE external_resource_id = ?1",
                [id],
            ) {
                result.errors.push(format!("miss tracking failed: {error}"));
            }
        }
        if let Err(error) = tx.execute(
            "UPDATE resources SET availability_status = 'unavailable'
             WHERE miss_streak >= ?1 AND availability_status = 'available'",
            [MISS_THRESHOLD],
        ) {
            result.errors.push(format!("miss tracking failed: {error}"));
        }
    }

    if !baseline && result.errors.is_empty() {
        let now_utc = chrono::DateTime::parse_from_rfc3339(now)
            .map(|instant| instant.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());
        let window = chrono::Duration::hours(reminder_hours);
        for resource in &discovery.resources {
            let cid = course_ids
                .get(&resource.course_external_id)
                .copied()
                .unwrap_or(-1);
            if rebaseline.contains(&cid) || paused.contains(&cid) {
                continue;
            }
            let resource_id = resource_ids.get(resource.external_id.as_str()).copied();
            let academic = assignment_scope
                .as_ref()
                .zip(resource_id)
                .and_then(|(scope, id)| {
                    assignment_reminder(&tx, scope, resource, cid, id, now_utc)
                });
            let Some(due) = reminder_deadline(resource.due_at.as_deref(), academic.as_ref()) else {
                continue;
            };
            let Some(instant) = due_instant(due) else {
                continue;
            };
            if instant <= now_utc || instant > now_utc + window {
                continue;
            }
            let legacy = diff::dedup_key("deadline-reminder", &resource.external_id, due);
            let attempt = academic
                .as_ref()
                .and_then(|observation| observation.attempt);
            let legacy_equivalent =
                attempt.unwrap_or(0) == 0 && resource.due_at.as_deref() == Some(due);
            let key = if let Some(scope) = assignment_scope
                .as_ref()
                .filter(|_| academic.is_some() && !legacy_equivalent)
            {
                let identity = serde_json::to_vec(&(
                    scope.owner.origin.as_str(),
                    scope.owner.moodle_user_id,
                    &resource.external_id,
                    due,
                    attempt.unwrap_or(0),
                ))
                .expect("scalar reminder identity");
                format!(
                    "assignment-deadline-reminder:{:x}",
                    Sha256::digest(identity)
                )
            } else {
                legacy
            };
            let exists = match tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM change_events WHERE deduplication_key = ?1)",
                [&key],
                |row| row.get::<_, bool>(0),
            ) {
                Ok(exists) => exists,
                Err(error) => {
                    result
                        .errors
                        .push(format!("reminder dedup read failed: {error}"));
                    continue;
                }
            };
            if !exists {
                match db::insert_event(
                    &tx,
                    resource_id,
                    course_ids.get(&resource.course_external_id).copied(),
                    "deadline",
                    &format!("Deadline approaching: {}", resource.title),
                    Some("An upcoming deadline is within your reminder window."),
                    &key,
                    now,
                ) {
                    Ok(true) => updated_count += 1,
                    Ok(false) => {}
                    Err(error) => result
                        .errors
                        .push(format!("deadline reminder failed: {error}")),
                }
            }
        }
    }

    for course in &discovery.courses {
        if let Some(id) = course_ids.get(&course.external_id) {
            let partial_prefix = format!("course {} page:", course.external_id);
            let status = if discovery
                .errors
                .iter()
                .any(|e| e.starts_with(&partial_prefix))
            {
                "partial"
            } else {
                "ok"
            };
            if let Err(error) = db::mark_course_scanned(&tx, *id, now, status) {
                result.errors.push(format!("course status failed: {error}"));
            }
        }
    }

    if baseline && complete && result.errors.is_empty() {
        match baseline_generation_value(&tx, "baseline_global_reset_generation") {
            Ok(current_generation) if current_generation == global_generation => {
                if let Err(error) = db::set_kv(&tx, "baseline_established", now) {
                    result
                        .errors
                        .push(format!("baseline write failed: {error}"));
                }
            }
            Ok(_) => {}
            Err(error) => result.errors.push(error),
        }
    }

    if !discovery.cancelled && result.errors.is_empty() {
        let completed: HashSet<i64> = discovery
            .courses
            .iter()
            .filter(|course| discovery.successful_courses.contains(&course.external_id))
            .filter_map(|course| course_ids.get(&course.external_id).copied())
            .collect();
        let consumed = rebaseline.intersection(&completed).copied().collect();
        if let Err(error) = consume_rebaseline_markers(&tx, &consumed, baseline_generation) {
            result
                .errors
                .push(format!("course baseline markers failed: {error}"));
        }
    }

    if !result.errors.is_empty() {
        return result;
    }

    let summary = (!discovery.errors.is_empty()).then(|| discovery.errors.join("; "));
    if let Err(error) = db::finish_scan(
        &tx,
        scan_id,
        status,
        discovery.resources.len() as i64,
        new_count,
        updated_count,
        unavailable_count,
        discovery.courses_scanned as i64,
        discovery.courses_failed as i64,
        summary.as_deref(),
        baseline,
        now,
    ) {
        result.errors.push(format!("scan finish failed: {error}"));
        return result;
    }

    if let Err(error) = tx.commit() {
        result.errors.push(format!("commit failed: {error}"));
        return result;
    }

    result.committed = true;
    result.new = new_count as usize;
    result.updated = updated_count as usize;
    result.unavailable = unavailable_count as usize;
    result.missing_ids = missing_ids;
    result
}

fn discovery_status(discovery: &discover::Discovery) -> &'static str {
    if discovery.cancelled {
        "cancelled"
    } else if discovery.courses_failed > 0 || !discovery.errors.is_empty() {
        "partial"
    } else {
        "ok"
    }
}

#[cfg(test)]
#[path = "../../../tests/scan_reconciliation_r1a.rs"]
mod scan_reconciliation_r1a_tests;

#[cfg(test)]
mod tests {
    use super::{consume_completed_rebaseline_markers, course_is_baseline, due_instant};
    use crate::{db, sync::diff};
    use rusqlite::Connection;
    use std::collections::HashSet;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn parses_rfc3339_deadline() {
        assert!(due_instant("2026-11-01T23:59:00+05:30").is_some());
    }

    #[test]
    fn parses_date_only_deadline_as_end_of_day() {
        let d = due_instant("2026-11-01").unwrap();
        assert_eq!(d.date_naive().to_string(), "2026-11-01");
    }

    #[test]
    fn rejects_garbage() {
        assert!(due_instant("soon").is_none());
    }

    #[test]
    fn reset_markers_consume_only_start_snapshot_successes_and_merge_new_requests() {
        let mut conn = mem();
        let scan_snapshot = HashSet::from([10, 20]);
        db::set_kv(&conn, "rebaseline_courses", "[10,20,30]").unwrap();

        consume_completed_rebaseline_markers(
            &mut conn,
            &scan_snapshot,
            &HashSet::from([10]),
            0,
            false,
        )
        .unwrap();

        assert_eq!(
            db::get_kv(&conn, "rebaseline_courses").as_deref(),
            Some("[20,30]")
        );
    }

    #[test]
    fn repeated_same_course_reset_waits_for_a_fresh_successful_scan() {
        let mut conn = mem();
        let captured_generation = db::request_baseline_reset(&mut conn, Some(10)).unwrap();
        let snapshot = HashSet::from([10]);

        db::request_baseline_reset(&mut conn, Some(10)).unwrap();
        consume_completed_rebaseline_markers(
            &mut conn,
            &snapshot,
            &HashSet::from([10]),
            captured_generation,
            false,
        )
        .unwrap();
        assert_eq!(
            db::get_kv(&conn, "rebaseline_courses").as_deref(),
            Some("[10]")
        );

        let next_generation = db::get_kv(&conn, "baseline_reset_generation")
            .unwrap()
            .parse()
            .unwrap();
        consume_completed_rebaseline_markers(
            &mut conn,
            &snapshot,
            &HashSet::from([10]),
            next_generation,
            false,
        )
        .unwrap();
        assert_eq!(db::get_kv(&conn, "rebaseline_courses"), None);
    }

    #[test]
    fn different_course_request_preserves_all_markers_until_next_scan() {
        let mut conn = mem();
        let captured_generation = db::request_baseline_reset(&mut conn, Some(10)).unwrap();
        let snapshot = HashSet::from([10]);

        db::request_baseline_reset(&mut conn, Some(20)).unwrap();
        consume_completed_rebaseline_markers(
            &mut conn,
            &snapshot,
            &HashSet::from([10]),
            captured_generation,
            false,
        )
        .unwrap();
        assert_eq!(
            db::get_kv(&conn, "rebaseline_courses").as_deref(),
            Some("[10,20]")
        );

        let next_generation = db::get_kv(&conn, "baseline_reset_generation")
            .unwrap()
            .parse()
            .unwrap();
        consume_completed_rebaseline_markers(
            &mut conn,
            &HashSet::from([10, 20]),
            &HashSet::from([10, 20]),
            next_generation,
            false,
        )
        .unwrap();
        assert_eq!(db::get_kv(&conn, "rebaseline_courses"), None);
    }

    #[test]
    fn repeated_global_reset_during_baseline_keeps_next_scan_silent() {
        let mut conn = mem();
        let first_generation = db::request_baseline_reset(&mut conn, None).unwrap();
        assert!(
            !db::establish_baseline_if_generation(&mut conn, 0, "2026-11-16T00:00:00Z").unwrap()
        );

        let second_generation = db::request_baseline_reset(&mut conn, None).unwrap();
        assert!(!db::establish_baseline_if_generation(
            &mut conn,
            first_generation,
            "2026-11-16T00:01:00Z"
        )
        .unwrap());
        assert_eq!(db::get_kv(&conn, "baseline_established"), None);

        assert!(db::establish_baseline_if_generation(
            &mut conn,
            second_generation,
            "2026-11-16T00:02:00Z"
        )
        .unwrap());
        assert!(db::get_kv(&conn, "baseline_established").is_some());
    }

    #[test]
    fn course_reset_does_not_prolong_complete_global_baseline() {
        for explicit_reset in [false, true] {
            let mut conn = mem();
            let global_generation = if explicit_reset {
                db::request_baseline_reset(&mut conn, None).unwrap()
            } else {
                0
            };
            db::request_baseline_reset(&mut conn, Some(10)).unwrap();
            assert!(
                db::establish_baseline_if_generation(
                    &mut conn,
                    global_generation,
                    "2026-11-16T00:02:00Z"
                )
                .unwrap(),
                "a newer course-only reset must not silence unrelated courses globally"
            );
            assert_eq!(
                db::get_kv(&conn, "rebaseline_courses").as_deref(),
                Some("[10]")
            );
            assert!(!course_is_baseline(
                false,
                &HashSet::from([10]),
                &HashSet::new(),
                Some(20)
            ));
        }
    }

    #[test]
    fn legacy_array_marker_without_generation_remains_consumable() {
        let mut conn = mem();
        db::set_kv(&conn, "rebaseline_courses", "[10]").unwrap();
        assert_eq!(db::get_kv(&conn, "baseline_reset_generation"), None);

        consume_completed_rebaseline_markers(
            &mut conn,
            &HashSet::from([10]),
            &HashSet::from([10]),
            0,
            false,
        )
        .unwrap();
        assert_eq!(db::get_kv(&conn, "rebaseline_courses"), None);
    }

    #[test]
    fn reset_markers_survive_restart_until_course_succeeds_and_preserve_history_and_mirrors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reset.db");
        let mut conn = Connection::open(&path).unwrap();
        db::migrate(&conn).unwrap();
        db::set_kv(&conn, "rebaseline_courses", "[10,20]").unwrap();
        db::set_kv(&conn, "baseline_established", "2026-11-15T00:00:00Z").unwrap();
        conn.execute(
            "INSERT INTO scan_runs(started_at, status) VALUES('2026-11-16T00:00:00Z','ok')",
            [],
        )
        .unwrap();
        let course_id = db::upsert_course(
            &conn,
            "10",
            "Course Ten",
            None,
            "https://quanta.bits-pilani.ac.in/course/view.php?id=10",
            "2026-11-16T00:00:00Z",
        )
        .unwrap();
        let resource_id = db::upsert_resource(
            &conn,
            &db::ResourceWrite {
                external_id: "resource-1",
                course_id: Some(course_id),
                title: "Lecture 1",
                url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
                source_page_url: None,
                resource_type: "pdf",
                uploaded_at: None,
                published_at: None,
                modified_at: None,
                due_at: None,
                fingerprint: "fingerprint",
                size_bytes: None,
                section: None,
                section_path: None,
                is_external: false,
                availability: "available",
            },
            "2026-11-16T00:00:00Z",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO change_events(resource_id, course_id, change_type, title, detected_at, deduplication_key) VALUES(?1,?2,'new','Kept','2026-11-16T00:00:00Z','kept')",
            rusqlite::params![resource_id, course_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO local_files(resource_id, rel_path, status) VALUES(?1,'kept.pdf','kept')",
            [resource_id],
        )
        .unwrap();
        consume_completed_rebaseline_markers(
            &mut conn,
            &HashSet::from([10, 20]),
            &HashSet::new(),
            0,
            false,
        )
        .unwrap();
        assert_eq!(
            db::get_kv(&conn, "rebaseline_courses").as_deref(),
            Some("[10,20]")
        );
        drop(conn);

        let mut reopened = Connection::open(&path).unwrap();
        db::migrate(&reopened).unwrap();
        let snapshot = HashSet::from([10, 20]);
        consume_completed_rebaseline_markers(
            &mut reopened,
            &snapshot,
            &HashSet::from([10]),
            0,
            false,
        )
        .unwrap();
        assert_eq!(
            db::get_kv(&reopened, "rebaseline_courses").as_deref(),
            Some("[20]")
        );
        assert_eq!(
            db::get_kv(&reopened, "baseline_established").as_deref(),
            Some("2026-11-15T00:00:00Z")
        );
        consume_completed_rebaseline_markers(
            &mut reopened,
            &HashSet::from([20]),
            &HashSet::from([20]),
            0,
            false,
        )
        .unwrap();
        assert_eq!(db::get_kv(&reopened, "rebaseline_courses"), None);
        assert_eq!(
            reopened
                .query_row("SELECT COUNT(*) FROM resources", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            reopened
                .query_row("SELECT COUNT(*) FROM change_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            reopened
                .query_row("SELECT COUNT(*) FROM local_files", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn cancelled_scan_keeps_all_pending_course_markers() {
        let mut conn = mem();
        db::set_kv(&conn, "rebaseline_courses", "[10,20]").unwrap();
        consume_completed_rebaseline_markers(
            &mut conn,
            &HashSet::from([10, 20]),
            &HashSet::from([10, 20]),
            0,
            true,
        )
        .unwrap();
        assert_eq!(
            db::get_kv(&conn, "rebaseline_courses").as_deref(),
            Some("[10,20]")
        );
    }

    #[test]
    fn baseline_classification_stays_silent_during_reset_then_resumes_normal_diffing() {
        let current = crate::quanta::DiscoveredResource {
            external_id: "resource-1".into(),
            course_external_id: "10".into(),
            title: "Lecture 1".into(),
            url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1".into(),
            source_page_url: None,
            resource_type: "pdf".into(),
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            size_bytes: None,
            section: None,
            section_path: Vec::new(),
            is_external: false,
            available: true,
        };
        let reset = HashSet::from([10]);
        let no_pauses = HashSet::new();
        let during_course_reset = course_is_baseline(false, &reset, &no_pauses, Some(10));
        assert_eq!(
            diff::classify(None, &current, during_course_reset),
            diff::Detected::Unchanged
        );
        assert!(course_is_baseline(
            true,
            &HashSet::new(),
            &no_pauses,
            Some(20)
        ));

        let mut conn = mem();
        db::set_kv(&conn, "rebaseline_courses", "[10]").unwrap();
        consume_completed_rebaseline_markers(&mut conn, &reset, &reset, 0, false).unwrap();
        let after_course_reset = db::get_kv(&conn, "rebaseline_courses")
            .and_then(|raw| serde_json::from_str::<Vec<i64>>(&raw).ok())
            .map(|ids| ids.into_iter().collect())
            .unwrap_or_default();
        let after_success = course_is_baseline(false, &after_course_reset, &no_pauses, Some(10));
        assert_eq!(
            diff::classify(None, &current, after_success),
            diff::Detected::New
        );
    }
}

#[cfg(test)]
#[path = "../../../tests/collection_reconciliation_r2.rs"]
mod collection_reconciliation_r2_tests;

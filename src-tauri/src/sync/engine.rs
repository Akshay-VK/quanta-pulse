//! The scan engine: run discovery, persist results, detect changes, notify.
//!
//! A scan is guarded by a single "running" flag so two scans can never overlap,
//! and it is cooperatively cancellable. All database mutation for a scan occurs
//! inside one transaction, so an interrupted scan cannot corrupt the inventory.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, ResourceWrite};
use crate::models::{ScanDetails, ScanOutcome};
use crate::notify;
use crate::quanta::discover::{self, CrawlLimits, Progress, ProgressFn};
use crate::state::AppState;
use crate::sync::diagnostics::Collector;
use crate::sync::diff::{self, Detected};

/// How many consecutive misses before a resource is considered unavailable.
const MISS_THRESHOLD: i64 = 2;

/// Run a full scan. Returns immediately (with an empty outcome) if one is
/// already in progress.
pub async fn run_scan(app: AppHandle, reason: &str) -> ScanOutcome {
    let sync = { app.state::<AppState>().sync.clone() };
    if sync.auth_resetting.load(Ordering::SeqCst) {
        return ScanOutcome::default();
    }
    if sync.running.swap(true, Ordering::SeqCst) {
        return ScanOutcome::default();
    }

    // Recheck after acquiring the scan slot so a reset cannot race a new scan
    // and have that scan clear the reset's cancellation request.
    if sync.auth_resetting.load(Ordering::SeqCst) {
        sync.cancel.store(true, Ordering::SeqCst);
        sync.running.store(false, Ordering::SeqCst);
        sync.set_phase("Idle", 0, 0);
        return ScanOutcome::default();
    }
    sync.cancel.store(false, Ordering::SeqCst);
    if sync.auth_resetting.load(Ordering::SeqCst) {
        sync.cancel.store(true, Ordering::SeqCst);
        sync.running.store(false, Ordering::SeqCst);
        sync.set_phase("Idle", 0, 0);
        return ScanOutcome::default();
    }
    sync.set_phase("Starting", 0, 0);
    emit_status(&app);

    tracing::info!(reason, "starting synchronisation scan");
    let outcome = scan_inner(&app, reason).await;

    sync.running.store(false, Ordering::SeqCst);
    sync.set_phase("Idle", 0, 0);

    // Schedule the next run and publish the new state to the UI.
    {
        let state = app.state::<AppState>();
        let interval = state.settings().sync_interval_minutes as i64;
        let next = (chrono::Utc::now() + chrono::Duration::minutes(interval))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let conn = state.conn();
        let _ = db::set_kv(&conn, "next_scan_at", &next);
        let _ = db::set_kv(&conn, "last_scan_at", &db::now_rfc3339());
    }

    emit_status(&app);
    let _ = app.emit("sync:done", &outcome);
    crate::tray::refresh(&app);
    outcome
}

async fn scan_inner(app: &AppHandle, _reason: &str) -> ScanOutcome {
    let mut outcome = ScanOutcome::default();

    let (limits, baseline, baseline_generation, global_generation, reminder_hours, rebaseline) = {
        let state = app.state::<AppState>();
        let s = state.settings();
        let conn = state.conn();
        let baseline = db::get_kv(&conn, "baseline_established").is_none();
        let baseline_generation = db::get_kv(&conn, "baseline_reset_generation")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let global_generation = db::get_kv(&conn, "baseline_global_reset_generation")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let rebaseline: HashSet<i64> = db::get_kv(&conn, "rebaseline_courses")
            .and_then(|raw| serde_json::from_str::<Vec<i64>>(&raw).ok())
            .map(|v| v.into_iter().collect())
            .unwrap_or_default();
        (
            CrawlLimits {
                max_courses: s.max_courses,
                max_resources_per_course: s.max_resources_per_course,
                max_detail_fetches: s.max_detail_fetches,
                concurrency: s.concurrency,
            },
            baseline,
            baseline_generation,
            global_generation,
            s.deadline_reminder_hours,
            rebaseline,
        )
    };

    let Some(client) = app.state::<AppState>().client() else {
        let state = app.state::<AppState>();
        state.sync.set_auth_state("unauthenticated");
        state
            .sync
            .last_error
            .lock()
            .unwrap()
            .replace("Not signed in.".into());
        return outcome;
    };

    let scan_id = {
        let state = app.state::<AppState>();
        let conn = state.conn();
        db::start_scan(&conn, &db::now_rfc3339()).unwrap_or(0)
    };

    // Progress reporting.
    let progress: ProgressFn = {
        let app = app.clone();
        Arc::new(move |p: Progress| {
            {
                let state = app.state::<AppState>();
                state.sync.set_phase(&p.phase, p.done, p.total);
            }
            let _ = app.emit("sync:progress", &p);
        })
    };

    let cancel = { app.state::<AppState>().sync.cancel.clone() };
    let collector = Collector::default();
    let discovery =
        discover::discover_all(client, limits, cancel, progress, collector.observer()).await;

    outcome.auth_expired = discovery.auth_expired;
    outcome.courses_scanned = discovery.courses_scanned;
    outcome.courses_failed = discovery.courses_failed;
    outcome.errors = discovery.errors.clone();
    outcome.discovered = discovery.resources.len();
    outcome.cancelled = discovery.cancelled;

    if discovery.auth_expired {
        let state = app.state::<AppState>();
        state.sync.set_auth_state("expired");
        *state.sync.last_error.lock().unwrap() =
            Some("Quanta session expired. Sign in again to resume monitoring.".into());
        {
            let conn = state.conn();
            let now = db::now_rfc3339();
            let _ = db::finish_scan(
                &conn,
                scan_id,
                "auth_expired",
                0,
                0,
                0,
                0,
                0,
                0,
                Some("Session expired"),
                false,
                &now,
            );
        }
        persist_diagnostics(
            app,
            &collector,
            scan_id,
            &HashMap::new(),
            false,
            true,
            &mut outcome,
        );
        if state.sync.note_auth_expired() {
            notify::notify_auth_expired(app);
        }
        emit_status(app);
        return outcome;
    }

    // A reset cancels discovery because its partial result is not a reliable
    // inventory snapshot. Record the cancelled run without changing resources
    // or generating events from an interrupted traversal.
    if discovery.cancelled
        && app
            .state::<AppState>()
            .sync
            .auth_resetting
            .load(Ordering::SeqCst)
    {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let now = db::now_rfc3339();
        let _ = db::finish_scan(
            &conn,
            scan_id,
            "cancelled",
            0,
            0,
            0,
            0,
            discovery.courses_scanned as i64,
            discovery.courses_failed as i64,
            Some("Cancelled for Quanta session reset"),
            false,
            &now,
        );
        outcome.cancelled = true;
        persist_diagnostics(
            app,
            &collector,
            scan_id,
            &HashMap::new(),
            true,
            false,
            &mut outcome,
        );
        return outcome;
    }

    // Only successful discovery can clear expiry and re-arm its notification.
    // A failed manual scan (e.g. offline) does not verify the stale session.
    if !discovery.cancelled && (discovery.errors.is_empty() || discovery.courses_scanned > 0) {
        app.state::<AppState>().sync.set_auth_state("authenticated");
    }

    let now = db::now_rfc3339();
    let mut new_count = 0i64;
    let mut updated_count = 0i64;
    let mut unavailable_count = 0i64;
    let mut seen_ids: Vec<String> = Vec::new();
    let mut missing_ids: Vec<String> = Vec::new();

    {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let tx = match conn.unchecked_transaction() {
            Ok(tx) => tx,
            Err(e) => {
                outcome.errors.push(format!("transaction failed: {e}"));
                return outcome;
            }
        };

        // Courses
        let mut course_ids: HashMap<String, i64> = HashMap::new();
        for course in &discovery.courses {
            match db::upsert_course(
                &conn,
                &course.external_id,
                &course.name,
                course.short_name.as_deref(),
                &course.url,
                &now,
            ) {
                Ok(id) => {
                    course_ids.insert(course.external_id.clone(), id);
                }
                Err(e) => outcome
                    .errors
                    .push(format!("course {}: {e}", course.external_id)),
            }
        }

        // Paused courses are still recorded but never report changes.
        let paused: HashSet<i64> = db::paused_course_ids(&conn).into_iter().collect();

        // Resources + change detection
        for r in &discovery.resources {
            let course_id = course_ids.get(&r.course_external_id).copied();
            let previous = db::get_resource(&conn, &r.external_id);
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

            let resource_id = match db::upsert_resource(&conn, &write, &now) {
                Ok(id) => id,
                Err(e) => {
                    outcome
                        .errors
                        .push(format!("resource {}: {e}", r.external_id));
                    continue;
                }
            };
            seen_ids.push(r.external_id.clone());

            let effective_baseline = course_is_baseline(baseline, &rebaseline, &paused, course_id);
            let prev_state = previous.as_ref().map(Into::into);
            let detected = diff::classify(prev_state.as_ref(), r, effective_baseline);
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
                &conn,
                Some(resource_id),
                course_id,
                kind,
                &title,
                Some(&description),
                &key,
                &now,
            ) {
                Ok(true) => match kind {
                    "new" | "announcement" => new_count += 1,
                    "updated" | "deadline" => updated_count += 1,
                    "unavailable" | "restored" => unavailable_count += 1,
                    _ => {}
                },
                Ok(false) => {}
                Err(e) => outcome.errors.push(format!("event {}: {e}", r.external_id)),
            }
        }

        // Missing resources: never deleted, only marked after repeated misses.
        // Computed here but applied after commit (a nested transaction would
        // fail while this one is open).
        if discovery.errors.is_empty() && !discovery.cancelled {
            let seen: HashSet<&String> = seen_ids.iter().collect();
            missing_ids = db::all_resource_external_ids(&conn)
                .unwrap_or_default()
                .into_iter()
                .filter(|id| !seen.contains(id))
                .collect();
        }

        // Upcoming deadline reminders (one notification per deadline).
        if !baseline {
            for r in &discovery.resources {
                let cid = course_ids.get(&r.course_external_id).copied().unwrap_or(-1);
                if rebaseline.contains(&cid) || paused.contains(&cid) {
                    continue;
                }
                if let Some(due) = r.due_at.as_deref() {
                    if let Some(instant) = due_instant(due) {
                        let now_utc = chrono::Utc::now();
                        let window = chrono::Duration::hours(reminder_hours);
                        if instant > now_utc && instant <= now_utc + window {
                            let key = diff::dedup_key("deadline-reminder", &r.external_id, due);
                            if !db::event_exists(&conn, &key) {
                                let course_id = course_ids.get(&r.course_external_id).copied();
                                let resource_id =
                                    db::get_resource(&conn, &r.external_id).map(|x| x.id);
                                let _ = db::insert_event(
                                    &conn,
                                    resource_id,
                                    course_id,
                                    "deadline",
                                    &format!("Deadline approaching: {}", r.title),
                                    Some("An upcoming deadline is within your reminder window."),
                                    &key,
                                    &now,
                                );
                                updated_count += 1;
                            }
                        }
                    }
                }
            }
        }

        // Mark course scan status.
        for course in &discovery.courses {
            if let Some(id) = course_ids.get(&course.external_id) {
                let partial_prefix = format!("course {} page:", course.external_id);
                let status = if discovery
                    .errors
                    .iter()
                    .any(|error| error.starts_with(&partial_prefix))
                {
                    "partial"
                } else {
                    "ok"
                };
                let _ = db::mark_course_scanned(&conn, *id, &now, status);
            }
        }

        if let Err(e) = tx.commit() {
            outcome.errors.push(format!("commit failed: {e}"));
        }
    }

    // Apply miss-streak bumps after the inventory transaction has committed.
    if !missing_ids.is_empty() {
        let state = app.state::<AppState>();
        let conn = state.conn();
        if let Err(e) = db::bump_miss_streak(&conn, &missing_ids, MISS_THRESHOLD) {
            outcome.errors.push(format!("miss tracking failed: {e}"));
        }
        // A resource Quanta keeps hiding keeps whatever it has, labelled: the
        // local copy is exactly what should outlive the listing.
        let _ = state.mirror.mark_unavailable_kept(&conn);
    }

    // Hand the scan's findings to the mirror. Only when the scan completed:
    // a cancelled half-scan must not push the backfill ahead of a full one.
    if !discovery.cancelled {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let queued = state.mirror.enqueue_all(&conn);
        if queued > 0 {
            tracing::info!(queued, "scan enqueued for the local mirror");
        }
    }

    // Persist the baseline marker after a successful, complete first scan.
    if baseline && !discovery.cancelled && discovery.errors.is_empty() {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let mut conn = conn;
        let _ = db::establish_baseline_if_generation(&mut conn, global_generation, &now);
    }
    // Consume only courses that were pending at scan start and whose complete
    // page plus detail traversal reached success. Re-read the setting so a
    // reset queued while discovery was running remains pending.
    if !rebaseline.is_empty() {
        let state = app.state::<AppState>();
        let mut conn = state.conn();
        let completed_course_ids: HashSet<i64> = discovery
            .courses
            .iter()
            .filter(|course| discovery.successful_courses.contains(&course.external_id))
            .filter_map(|course| db::course_id_for_external(&conn, &course.external_id))
            .collect();
        if let Err(error) = consume_completed_rebaseline_markers(
            &mut conn,
            &rebaseline,
            &completed_course_ids,
            baseline_generation,
            discovery.cancelled,
        ) {
            outcome
                .errors
                .push(format!("could not update course baseline markers: {error}"));
        }
    }

    // Finalise the scan run.
    {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let status = if discovery.cancelled {
            "cancelled"
        } else if discovery.courses_failed > 0 || !discovery.errors.is_empty() {
            "partial"
        } else {
            "ok"
        };
        let summary = if outcome.errors.is_empty() {
            None
        } else {
            Some(outcome.errors.join("; "))
        };
        let _ = db::finish_scan(
            &conn,
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
            &now,
        );
        *state.sync.last_error.lock().unwrap() = if status == "ok" { None } else { summary };
    }

    let observed_course_ids: HashMap<String, i64> = {
        let state = app.state::<AppState>();
        let conn = state.conn();
        discovery
            .courses
            .iter()
            .filter_map(|course| {
                db::course_id_for_external(&conn, &course.external_id)
                    .map(|id| (course.external_id.clone(), id))
            })
            .collect()
    };
    persist_diagnostics(
        app,
        &collector,
        scan_id,
        &observed_course_ids,
        discovery.cancelled,
        false,
        &mut outcome,
    );

    outcome.new = new_count as usize;
    outcome.updated = updated_count as usize;
    outcome.unavailable = unavailable_count as usize;

    // Native notifications for genuinely new changes.
    notify::dispatch(app);

    outcome
}

/// Remove only start-of-scan reset markers for courses that completed a full
/// discovery. The setting is re-read before writing to preserve requests added
/// by another command while the scan was in progress.
fn consume_completed_rebaseline_markers(
    conn: &mut rusqlite::Connection,
    markers_at_start: &HashSet<i64>,
    completed_course_ids: &HashSet<i64>,
    captured_generation: i64,
    cancelled: bool,
) -> rusqlite::Result<()> {
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

    let tx = conn.transaction()?;
    let current_generation = db::get_kv(&tx, "baseline_reset_generation")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    if current_generation != captured_generation {
        tx.rollback()?;
        return Ok(());
    }
    let current: HashSet<i64> = db::get_kv(&tx, "rebaseline_courses")
        .and_then(|raw| serde_json::from_str::<Vec<i64>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .collect();
    let mut remaining: Vec<i64> = current.difference(&consumed).copied().collect();
    remaining.sort_unstable();
    if remaining.is_empty() {
        db::del_kv(&tx, "rebaseline_courses")?;
    } else {
        db::set_kv(
            &tx,
            "rebaseline_courses",
            &serde_json::to_string(&remaining).expect("course IDs always serialize"),
        )?;
    }
    tx.commit()
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

/// Persist observed diagnostics after aggregate scan history has been finalized.
/// The callback/collector never touches SQLite and failures do not rewrite the
/// aggregate row; they are surfaced to the caller and redacted in logs.
fn persist_diagnostics(
    app: &AppHandle,
    collector: &Collector,
    scan_id: i64,
    course_ids: &HashMap<String, i64>,
    cancelled: bool,
    auth_expired: bool,
    outcome: &mut ScanOutcome,
) {
    let interrupted_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let details: ScanDetails = collector.finish(
        scan_id,
        cancelled,
        auth_expired,
        &interrupted_at,
        course_ids,
    );
    if details.courses.is_empty() {
        return;
    }
    let state = app.state::<AppState>();
    let conn = state.conn();
    if let Err(error) = crate::sync::diagnostics::persist(&conn, &details) {
        let redacted = crate::logging::redact(&error.to_string());
        let message = format!("scan diagnostics persistence failed: {redacted}");
        tracing::warn!(error = %message, "could not persist observed scan diagnostics");
        outcome.errors.push(message.clone());
        *state.sync.last_error.lock().unwrap() = Some(message);
    }
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
pub fn due_instant(due: &str) -> Option<chrono::DateTime<chrono::Utc>> {
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

fn emit_status(app: &AppHandle) {
    let status = app.state::<AppState>().sync_status();
    let _ = app.emit("sync:status", status);
}

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

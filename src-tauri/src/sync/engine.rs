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
use crate::models::ScanOutcome;
use crate::notify;
use crate::quanta::discover::{self, CrawlLimits, Progress, ProgressFn};
use crate::state::AppState;
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

    let (limits, baseline, reminder_hours, rebaseline) = {
        let state = app.state::<AppState>();
        let s = state.settings();
        let conn = state.conn();
        let baseline = db::get_kv(&conn, "baseline_established").is_none();
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
            s.deadline_reminder_hours,
            rebaseline,
        )
    };

    let Some(client) = app.state::<AppState>().client() else {
        let state = app.state::<AppState>();
        state.sync.set_auth_state("unauthenticated");
        state.sync.last_error.lock().unwrap().replace("Not signed in.".into());
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
    let discovery = discover::discover_all(client, limits, cancel, progress).await;

    outcome.auth_expired = discovery.auth_expired;
    outcome.courses_scanned = discovery.courses_scanned;
    outcome.courses_failed = discovery.courses_failed;
    outcome.errors = discovery.errors.clone();
    outcome.discovered = discovery.resources.len();
    outcome.cancelled = discovery.cancelled;

    if discovery.auth_expired {
        let state = app.state::<AppState>();
        state.sync.set_auth_state("expired");
        {
            let conn = state.conn();
            let now = db::now_rfc3339();
            let _ = db::finish_scan(&conn, scan_id, "auth_expired", 0, 0, 0, 0, 0, 0, Some("Session expired"), false, &now);
        }
        notify::notify_auth_expired(app);
        emit_status(app);
        return outcome;
    }

    // A reset cancels discovery because its partial result is not a reliable
    // inventory snapshot. Record the cancelled run without changing resources
    // or generating events from an interrupted traversal.
    if discovery.cancelled && app.state::<AppState>().sync.auth_resetting.load(Ordering::SeqCst) {
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
        return outcome;
    }

    // Discovery completed without an authentication redirect, so the current
    // session has been verified. Do not clear an expired state at scan start.
    app.state::<AppState>().sync.set_auth_state("authenticated");

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
                Err(e) => outcome.errors.push(format!("course {}: {e}", course.external_id)),
            }
        }

        // Paused courses are still recorded but never report changes.
        let paused: HashSet<i64> = db::paused_course_ids(&conn).into_iter().collect();

        // Resources + change detection
        for r in &discovery.resources {
            let course_id = course_ids.get(&r.course_external_id).copied();
            let previous = db::get_resource(&conn, &r.external_id);
            let availability = if r.available { "available" } else { "unavailable" };
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
                    outcome.errors.push(format!("resource {}: {e}", r.external_id));
                    continue;
                }
            };
            seen_ids.push(r.external_id.clone());

            let effective_baseline = baseline
                || course_id
                    .map(|c| rebaseline.contains(&c) || paused.contains(&c))
                    .unwrap_or(false);
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

            match db::insert_event(&conn, Some(resource_id), course_id, kind, &title, Some(&description), &key, &now) {
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
                                let resource_id = db::get_resource(&conn, &r.external_id).map(|x| x.id);
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
                let status = if discovery.errors.iter().any(|error| error.starts_with(&partial_prefix)) {
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
        let _ = db::set_kv(&conn, "baseline_established", &now);
    }
    // One-shot per-course re-baseline markers are consumed by this scan.
    if !discovery.cancelled && !rebaseline.is_empty() {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let _ = db::del_kv(&conn, "rebaseline_courses");
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
        *state.sync.last_error.lock().unwrap() = if status == "ok" {
            None
        } else {
            summary
        };
    }

    outcome.new = new_count as usize;
    outcome.updated = updated_count as usize;
    outcome.unavailable = unavailable_count as usize;

    // Native notifications for genuinely new changes.
    notify::dispatch(app);

    outcome
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
            format!("{} no longer appears available in {}", r.title, course_label(r)),
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
    use super::due_instant;

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
}

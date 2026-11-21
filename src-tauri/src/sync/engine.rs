//! The scan engine: run discovery, persist results, detect changes, notify.
//!
//! A scan is guarded by a single "running" flag so two scans can never overlap,
//! and it is cooperatively cancellable. All database mutation for a scan occurs
//! inside one transaction, so an interrupted scan cannot corrupt the inventory.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::db;
use crate::models::{ScanDetails, ScanOutcome};
use crate::notify;
use crate::quanta::discover::{self, CrawlLimits, Progress, ProgressFn};
use crate::state::AppState;
use crate::sync::diagnostics::Collector;
use crate::sync::reconcile::commit_scan;

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
        match db::start_scan(&conn, &db::now_rfc3339()) {
            Ok(id) => id,
            Err(e) => {
                outcome.errors.push(format!("scan start failed: {e}"));
                0
            }
        }
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
    let reconcile_result = {
        let state = app.state::<AppState>();
        let conn = state.conn();
        commit_scan(
            &conn,
            &discovery,
            baseline,
            baseline_generation,
            global_generation,
            &rebaseline,
            reminder_hours,
            &now,
        )
    };
    outcome.errors.extend(reconcile_result.errors);
    let commit_ok = reconcile_result.committed;
    let new_count = reconcile_result.new as i64;
    let updated_count = reconcile_result.updated as i64;
    let unavailable_count = reconcile_result.unavailable as i64;
    let missing_ids = reconcile_result.missing_ids;

    // Reconciliation has committed availability before mirror labeling runs.
    if commit_ok && !missing_ids.is_empty() {
        let state = app.state::<AppState>();
        let conn = state.conn();
        // A resource Quanta keeps hiding keeps whatever it has, labelled: the
        // local copy is exactly what should outlive the listing.
        let _ = state.mirror.mark_unavailable_kept(&conn);
    }

    // Hand the scan's findings to the mirror. Only when the scan completed:
    // a cancelled half-scan must not push the backfill ahead of a full one.
    if commit_ok && !discovery.cancelled {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let queued = state.mirror.enqueue_all(&conn);
        if queued > 0 {
            tracing::info!(queued, "scan enqueued for the local mirror");
        }
    }

    // Finalise the scan run.
    {
        let state = app.state::<AppState>();
        let conn = state.conn();
        let status = if discovery.cancelled {
            "cancelled"
        } else if !commit_ok
            || discovery.courses_failed > 0
            || !discovery.errors.is_empty()
            || !outcome.errors.is_empty()
        {
            "partial"
        } else {
            "ok"
        };
        let summary = if outcome.errors.is_empty() {
            None
        } else {
            Some(outcome.errors.join("; "))
        };
        if let Err(e) = db::finish_scan(
            &conn,
            scan_id,
            status,
            discovery.resources.len() as i64,
            if commit_ok { new_count } else { 0 },
            if commit_ok { updated_count } else { 0 },
            if commit_ok { unavailable_count } else { 0 },
            discovery.courses_scanned as i64,
            discovery.courses_failed as i64,
            summary.as_deref(),
            baseline,
            &now,
        ) {
            outcome.errors.push(format!("scan finish failed: {e}"));
        }
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

    // This helper claims the durable scan row before making a native attempt.
    notify::notify_scan_failure(app, scan_id);

    if commit_ok {
        outcome.new = new_count as usize;
        outcome.updated = updated_count as usize;
        outcome.unavailable = unavailable_count as usize;
    } else {
        outcome.new = 0;
        outcome.updated = 0;
        outcome.unavailable = 0;
    }
    outcome.committed = commit_ok;

    // Native notifications for genuinely new changes.
    if commit_ok {
        notify::dispatch(app);
    }

    outcome
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

fn emit_status(app: &AppHandle) {
    let status = app.state::<AppState>().sync_status();
    let _ = app.emit("sync:status", status);
}

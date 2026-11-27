//! The scan engine: run discovery, persist results, detect changes, notify.
//!
//! A scan is guarded by a single "running" flag so two scans can never overlap,
//! and it is cooperatively cancellable. All database mutation for a scan occurs
//! inside one transaction, so an interrupted scan cannot corrupt the inventory.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::db;
use crate::models::{ScanDetails, ScanOutcome};
use crate::notify;
use crate::quanta::discover::{self, CrawlLimits, Progress, ProgressFn};
use crate::state::AppState;
use crate::sync::diagnostics::Collector;
use crate::sync::reconcile::{commit_scan, AssignmentReminderScope, BaselineState};

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

    let state = app.state::<AppState>();
    let s = state.settings();
    let limits = CrawlLimits {
        max_courses: s.max_courses,
        max_resources_per_course: s.max_resources_per_course,
        max_detail_fetches: s.max_detail_fetches,
        concurrency: s.concurrency,
    };

    let academic_generation = crate::academic::context(&state).generation;
    let Some(client) = state.client() else {
        state.sync.set_auth_state("unauthenticated");
        state
            .sync
            .last_error
            .lock()
            .unwrap()
            .replace("Not signed in.".into());
        return outcome;
    };

    let Some((scan_id, captured)) = start_scan(&state, &mut outcome) else {
        return outcome;
    };
    let baseline = !captured.established;

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

    let cancel = state.sync.cancel.clone();
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
        state.sync.set_auth_state("expired");
        *state.sync.last_error.lock().unwrap() =
            Some("Quanta session expired. Sign in again to resume monitoring.".into());
        {
            let conn = state.conn();
            let now = db::now_rfc3339();
            if let Err(error) = db::finish_scan(
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
            ) {
                outcome.errors.push(format!("scan finish failed: {error}"));
            }
        }
        persist_diagnostics(
            &state,
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
    if discovery.cancelled && state.sync.auth_resetting.load(Ordering::SeqCst) {
        record_reset_cancellation(&state, &collector, scan_id, &mut outcome);
        return outcome;
    }

    // Only successful discovery can clear expiry and re-arm its notification.
    // A failed manual scan (e.g. offline) does not verify the stale session.
    if !discovery.cancelled && (discovery.errors.is_empty() || discovery.courses_scanned > 0) {
        state.sync.set_auth_state("authenticated");
    }

    let now = db::now_rfc3339();
    let reconcile_result = {
        let max_age =
            chrono::Duration::minutes(state.settings().sync_interval_minutes.min(60) as i64);
        // Lock order matches academic reads/commits. An auth change during
        // collection gives this scan the ordinary material reminder policy.
        let authority = state.sync.academic.lock().unwrap();
        let assignment_scope = authority
            .reminder_owner(&academic_generation)
            .filter(|_| {
                state.sync.auth_state() == "authenticated"
                    && !state.sync.auth_resetting.load(Ordering::SeqCst)
            })
            .map(|owner| AssignmentReminderScope { owner, max_age });
        let conn = state.conn();
        commit_scan(
            &conn,
            scan_id,
            &discovery,
            baseline,
            captured.generation,
            captured.global_generation,
            &captured.rebaseline,
            s.deadline_reminder_hours,
            &now,
            assignment_scope,
        )
    };
    outcome.errors.extend(reconcile_result.errors);
    let commit_ok = reconcile_result.committed;
    if !commit_ok {
        let status = if discovery.cancelled {
            "cancelled"
        } else {
            "partial"
        };
        let summary = outcome.errors.join("; ");
        let finish = db::finish_scan(
            &state.conn(),
            scan_id,
            status,
            outcome.discovered as i64,
            0,
            0,
            0,
            outcome.courses_scanned as i64,
            outcome.courses_failed as i64,
            Some(&summary),
            baseline,
            &now,
        );
        if let Err(error) = finish {
            outcome
                .errors
                .push(format!("failure History write failed: {error}"));
        }
    }
    *state.sync.last_error.lock().unwrap() =
        (!outcome.errors.is_empty()).then(|| outcome.errors.join("; "));

    // Reconciliation has committed availability before mirror labeling runs.
    if commit_ok && !reconcile_result.missing_ids.is_empty() {
        let conn = state.conn();
        // A resource Quanta keeps hiding keeps whatever it has, labelled: the
        // local copy is exactly what should outlive the listing.
        let _ = state.mirror.mark_unavailable_kept(&conn);
    }

    // Hand the scan's findings to the mirror. Only when the scan completed:
    // a cancelled half-scan must not push the backfill ahead of a full one.
    if commit_ok && !discovery.cancelled {
        let conn = state.conn();
        let queued = state.mirror.enqueue_all(&conn);
        if queued > 0 {
            tracing::info!(queued, "scan enqueued for the local mirror");
        }
    }

    let observed_course_ids: HashMap<String, i64> = {
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
        &state,
        &collector,
        scan_id,
        &observed_course_ids,
        discovery.cancelled,
        false,
        &mut outcome,
    );

    // This helper claims the durable scan row before making a native attempt.
    notify::notify_scan_failure(app, scan_id);

    outcome.new = reconcile_result.new;
    outcome.updated = reconcile_result.updated;
    outcome.unavailable = reconcile_result.unavailable;
    outcome.committed = commit_ok;

    // Native notifications for genuinely new changes.
    if commit_ok {
        notify::dispatch(app);
    }

    outcome
}

/// Reserve a History row and capture baseline state before discovery. If
/// capture fails, retain an unsuccessful run when History is still writable.
fn start_scan(state: &AppState, outcome: &mut ScanOutcome) -> Option<(i64, BaselineState)> {
    let conn = state.conn();
    let now = db::now_rfc3339();
    match db::start_scan(&conn, &now) {
        Ok(scan_id) => match BaselineState::capture(&conn) {
            Ok(baseline) => return Some((scan_id, baseline)),
            Err(error) => {
                outcome.errors.push(error.clone());
                if let Err(error) = db::finish_scan(
                    &conn,
                    scan_id,
                    "failed",
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    Some(&error),
                    false,
                    &now,
                ) {
                    outcome
                        .errors
                        .push(format!("failure History write failed: {error}"));
                }
            }
        },
        Err(error) => outcome.errors.push(format!("scan start failed: {error}")),
    }
    *state.sync.last_error.lock().unwrap() = Some(outcome.errors.join("; "));
    None
}

fn record_reset_cancellation(
    state: &AppState,
    collector: &Collector,
    scan_id: i64,
    outcome: &mut ScanOutcome,
) {
    // Finish the History write and release the connection before diagnostics
    // takes the same mutex.
    let finish = db::finish_scan(
        &state.conn(),
        scan_id,
        "cancelled",
        0,
        0,
        0,
        0,
        outcome.courses_scanned as i64,
        outcome.courses_failed as i64,
        Some("Cancelled for Quanta session reset"),
        false,
        &db::now_rfc3339(),
    );
    if let Err(error) = finish {
        outcome.errors.push(format!("scan finish failed: {error}"));
    }
    outcome.cancelled = true;
    persist_diagnostics(
        state,
        collector,
        scan_id,
        &HashMap::new(),
        true,
        false,
        outcome,
    );
}

/// Persist observed diagnostics after aggregate scan history has been finalized.
/// The callback/collector never touches SQLite and failures do not rewrite the
/// aggregate row; they are surfaced to the caller and redacted in logs.
fn persist_diagnostics(
    state: &AppState,
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

#[cfg(test)]
#[path = "../../../tests/scan_engine_review.rs"]
mod review_tests;

# B09A native contract handoff

## Settings

Rust `Settings` adds `notify_scan_failures: bool`, serialized as `notifyScanFailures`. Its field-level serde default and fresh-install default are `true`. Old JSON without the key retains all other stored values.

## Notification helper

`notify::notify_scan_failure(app: &AppHandle, scan_id: i64)` is the production entry point. It reads settings and local `HH:MM`, then uses the focused generic helper, checks `notifications_enabled`, `notify_scan_failures`, and `!in_quiet_hours`, and atomically claims the scan before invoking the OS sink. The generic copy is fixed and native-only. A failed sink does not release the claim. The DB lock is released before the OS sink call.

## Database claim

Migration 0008 adds nullable `scan_runs.failure_notified_at`. `db::claim_scan_failure_notification(conn, id, notified_at) -> rusqlite::Result<bool>` atomically returns true only for an existing completed unclaimed row whose status is `partial` or `failed`, or whose status is otherwise eligible and `courses_failed > 0`. It rejects running, cancelled, auth-expired, successful, missing, and already-claimed rows. The marker is part of the scan row, so deleting scan History removes it. Migration is guarded for idempotence and does not rewrite existing scan data.

## Engine use and limits

`sync::engine` calls the production helper after normal terminal persistence. Existing `auth_expired` and reset-cancellation early finalizations intentionally do not call it: auth remains on its existing reminder path and cancellation is ineligible. No-client and rejected/racing scans have no durable scan ID and do not notify. B09B consumes the serialized field and the existing `setSettings(Settings)` path; no new command/API contract is needed.

# B04B implementation handoff

**Base:** `d36911747e5de8ece0a9117ba843ef0ac45d530c`

**Status:** implementation patch pending Windows verification and coordinator acceptance.

## Observer API

`quanta::discover::Observation` contains `course_external_id`, `course_name`, `at` (RFC 3339 UTC captured with millisecond precision), and an `ObservationBoundary`. `ObservationBoundary` is one of `CourseStarted`, `CoursePagesTerminal { status, error }`, `DetailStarted`, or `DetailTerminal { status, error }`; status is the frozen `ScanCourseStatus`. `ObserverFn` is an `Arc<dyn Fn(Observation) + Send + Sync>` passed as the fifth argument to `discover_all`, alongside the existing `ProgressFn`. Course work starts after its semaphore permit is acquired and before its first course fetch. Detail work starts after its permit is acquired and before its material fetch. Terminal records are emitted at the task result boundary. Dashboard listing remains scan-global.

`sync::diagnostics::Collector` is the production-used in-memory aggregation seam. Its observer callback only updates a mutex-protected vector; it does not touch SQLite. It preserves first-observed course order and stores at most two steps per course: `Course pages` and aggregate `Material details`. It retains no per-resource event trace. `finish(scan_id, cancelled, auth_expired, interrupted_at, course_ids)` produces frozen `ScanDetails`, closes only active observed work, uses DB-mapped course IDs where available, and excludes never-started courses. `sync::diagnostics::persist(conn, details)` is the production persistence seam; it delegates to B04A's `db::save_scan_details` and returns its `rusqlite::Result` unchanged.

The engine writes details with `db::save_scan_details` only after aggregate scan history is finalized (including auth-expiry and reset-cancellation terminal branches). A write failure adds a redacted error to the returned outcome and sync error state and emits a redacted warning; aggregate scan columns are left intact.

## Proof added

- `quanta::discover::tests::observer_reports_real_course_and_detail_http_boundaries` exercises the actual callback path using `QuantaClient::fixture_client` and a local HTTP server; no live Quanta or production origin override is used.
- `sync::diagnostics::tests::observed_success_partial_and_cancelled_work_persists_across_reopen` checks exact supplied times/order, partial outcome, course ID mapping, secret redaction, and persistence after reopening temporary SQLite.
- `sync::diagnostics::tests::unstarted_courses_are_absent_and_completed_course_survives_later_cancellation` checks cancellation does not overwrite completed work.
- `sync::diagnostics::tests::failed_page_observation_is_terminal` checks failed terminal status and safe error retention.
- The reopen test calls the same persistence seam as production, proves an invalid scan ID leaves the aggregate row unchanged, and verifies sanitized payload persistence.

`cargo check --target x86_64-pc-windows-gnu`, `cargo check --tests --target x86_64-pc-windows-gnu`, and Windows-target `cargo test --lib --no-run` passed. The focused tests and full `cargo test --lib` were not executed: this Linux session has no PowerShell runner or Windows runtime. A native Linux test attempt stops before project compilation because `dbus-1` development files are unavailable.

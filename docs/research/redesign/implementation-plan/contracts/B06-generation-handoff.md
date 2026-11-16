# B06 baseline reset generation handoff

Issue: [#32](https://github.com/Akshay-VK/quanta-pulse/issues/32).

## Generation semantics

- `baseline_reset_generation` is a private SQLite settings key. A missing or
  malformed value reads as generation `0`, preserving compatibility with
  databases that contain only the legacy `rebaseline_courses` JSON array.
- Every call to `rebuild_baseline` increments the generation. The increment and
  its reset effect are committed in one transaction: course resets merge the
  ID into `rebaseline_courses`; global resets remove `baseline_established`.
- A scan captures the generation with its baseline and course-marker snapshots.
  It establishes the global baseline or consumes successful start-of-scan
  course markers only inside a transaction that confirms the generation still
  matches. A mismatch leaves all current course markers intact for a fresh scan.
- Cancelled scans still consume nothing. Existing discovery success checks,
  marker array format, command signature, diff behavior, history and mirror rows
  are unchanged.

## Proof

Native Windows PowerShell with `CARGO_INCREMENTAL=0` and
`CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`:

- `cargo test --lib sync::engine::tests -- --nocapture`: 11 passed.
- `cargo check`: passed.
- `cargo test --lib`: 227 passed.

Regression coverage uses the production reset request and reconciliation
helpers. It checks repeated same-course and global resets, a different course
added during a scan, fresh-scan consumption, the legacy marker without a
generation, cancellation, reopen persistence, and normal diffing after marker
consumption. It does not construct a Tauri `AppHandle` or drive `run_scan` end
to end; discovery and scan reconciliation remain covered at their existing
seams.

## Coordinator scope correction — 2026-11-16

The independent review identified that a course-only reset could prolong an otherwise complete global baseline. Global completion now compares the separate private `baseline_global_reset_generation`, updated only by global resets in the same request transaction. Course-marker consumption still compares `baseline_reset_generation`, updated by every reset. Thus a course request can preserve its pending marker without suppressing unrelated courses globally. A repeated global request still prevents old global completion. Missing legacy generation keys read as zero. The coordinator regression failed before the correction and passed after it for both first baseline and explicit global reset.

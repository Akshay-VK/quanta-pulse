# B06 review

## Finding

- **Medium — Per-course reset can prolong a complete global baseline.** `request_baseline_reset(Some(id))` increments the same `baseline_reset_generation` used by `establish_baseline_if_generation` ([db.rs](/mnt/d/dev/web/projects/quanta-app/quanta-pulse/src-tauri/src/db.rs:395), [engine.rs](/mnt/d/dev/web/projects/quanta-app/quanta-pulse/src-tauri/src/sync/engine.rs:461)). If a per-course reset arrives while the first/global baseline scan is running, that otherwise complete scan's captured generation no longer matches. The scan has already classified all resources silently because `baseline` was true, but it does not establish `baseline_established`; the next scan therefore treats every course as globally baseline again. This extends first-run silence across unrelated courses. Consider separating global-reset identity from course-marker request identity, or explicitly accounting for the scope of generation changes.

## Reviewed behavior

The discovery success set excludes page errors, traversal/detail limits, failed details, join failures, and cancellation. The engine intersects successes with the start snapshot and re-reads pending markers before consumption. Reset request effects and generation writes share a transaction; generation mismatch leaves markers/global baseline state untouched. Legacy missing/malformed generation reads as zero. Reset operations shown here do not delete history or mirror rows. Initial baseline establishment is gated on discovery completion without cancellation/errors.

## Limits

The supplied handoff reports Windows `cargo check`, 11 focused engine tests, and 227 library tests passing; I did not rerun broad tests. As documented, tests do not drive `run_scan` through a Tauri `AppHandle`, so end-to-end transaction/scan behavior remains unproven. Transaction helper failures propagate to callers, while `scan_inner` intentionally ignores a global-baseline helper error; no injected SQLite commit-failure proof was present. Settings UI / 04B policy was out of scope.

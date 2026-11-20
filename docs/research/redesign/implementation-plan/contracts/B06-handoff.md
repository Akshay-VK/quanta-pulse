# B06 implementation handoff

Issue: [#32](https://github.com/Akshay-VK/quanta-pulse/issues/32) in `Akshay-VK/quanta-pulse`.

## Behavior

- Discovery reports an external course ID in `Discovery.successful_courses` only when its course pages completed without page errors and every required detail request emitted a successful terminal result.
- A detail cap, detail failure, interrupted detail work, or incomplete page traversal excludes that course. Cancellation prevents reset-marker consumption for the whole scan.
- Engine maps successful external IDs through its existing course rows, intersects them with the per-course reset IDs read at scan start, then re-reads `rebaseline_courses` before removing only those IDs. The existing JSON array key and reset command contract remain unchanged.
- Global `baseline_established` behavior is unchanged. Reset reconciliation does not touch history or mirror rows.

## Proof

- Discovery HTTP-fixture tests cover successful details, one course's failed detail with an unrelated course succeeding, successful retry, and the detail limit.
- Engine tests cover partial-course marker retention alongside unrelated success, a concurrently persisted different course ID, restart persistence, cancellation retention, normal diff classification resuming after reset, and preserved history/mirror rows.
- Native Windows PowerShell runner, with `CARGO_INCREMENTAL=0` and `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`: `cargo check` passed; `cargo test --lib sync::engine::tests -- --nocapture` passed (7/7); `cargo test --lib` passed (223/223).

## Limits

- Tests exercise discovery and the production marker reconciliation seam separately; they do not construct a Tauri `AppHandle` to drive `run_scan` end to end.
- The compatible array setting is idempotent by course ID. A repeated reset for the same ID while that ID is already pending cannot be distinguished from the earlier request without changing the command's persisted representation; this lease keeps command/settings semantics unchanged. A different course reset added during the scan is preserved by the persisted-set merge.

# 2026-11-21 R1A/R1B integration evidence

On 2026-11-21, integration work on `feat/search-academic-expansion` in `Akshay-VK/quanta-pulse` serially merged the R1B and R1A implementation branches into the shared integration root. This record captures integration evidence only; it does not close tickets or claim final acceptance.

## Integration head

- Integration branch: `feat/search-academic-expansion`
- Code integration head after R1A merge: `7d5abcadf05e3be374b5513e041bb8a8002c6a2d` (`chore: merge R1A scan truthfulness fixes (#60)`)
- Final recorded head includes this wiki evidence commit on top of `7d5abca`.
- Prior integration tip before this merge sequence: `d2592058c1e83d63e93d7279a97f47ad2e5d0f9b`
- Worktree state after integration: clean (`git status --short` empty)

## R1B — #61 Publish verified session facts and guarantee migration backups

- Issue: [#61](https://github.com/Akshay-VK/quanta-pulse/issues/61) (open, `enhancement`, `ready-for-agent`)
- Implementer branch: `t3/publish-auth-upgrades`
- Code commit: [`e82ac7e21a6b41f729f1101fdcc8cdf439d42a01`](https://github.com/Akshay-VK/quanta-pulse/commit/e82ac7e21a6b41f729f1101fdcc8cdf439d42a01) (`fix: publish verified session facts and gate migration backups`)
- Integration merge commit: [`ecb7369c04e078dcd945bb4523ccd14a200a6b8f`](https://github.com/Akshay-VK/quanta-pulse/commit/ecb7369c04e078dcd945bb4523ccd14a200a6b8f) (`chore: merge R1B verified session and migration backup fixes (#61)`)
- Files changed by R1B code: `src-tauri/src/auth.rs`, `src-tauri/src/db.rs`
- Scoped review: diff limited to `auth.rs`/`db.rs`; no unexpected files; no search/engine/discover/academic feature files edited.

### R1B checks / evidence

Inherited from implementer result (`/tmp/quanta-57-r1b-result.md`) on the same code commit `e82ac7e` (clean merge into `d259205`; merge commit amended only to remove a trailing blank line at EOF in `src-tauri/src/db.rs`, no behavioral change):

- `cargo check --all-targets --target x86_64-pc-windows-msvc`: passed.
- `cargo test --target x86_64-pc-windows-msvc --lib auth`: 14 passed, 1 ignored.
- `cargo test --target x86_64-pc-windows-msvc --lib upgrade`: 13 passed.

Limits: Linux GTK/WebKit unavailable in this environment; canonical full native Windows runner not rerun here (R1A held shared target lease during implementer run; separate proof agent holds exclusive full native runner lease during this integration). No live Quanta credentials/access. Frontend untouched, so lint/build not rerun. Final acceptance/code review remains pending.

## R1A — #60 Make scan persistence and collection completeness truthful

- Issue: [#60](https://github.com/Akshay-VK/quanta-pulse/issues/60) (open, `enhancement`, `ready-for-agent`)
- Implementer branch: `t3/atomic-scan-reconciliation`
- Code commit: [`e8c9bbddd3f2f5f923e0c4fdfc4ebae40e15daa9`](https://github.com/Akshay-VK/quanta-pulse/commit/e8c9bbddd3f2f5f923e0c4fdfc4ebae40e15daa9) (`fix: make scan persistence and collection completeness truthful`)
- Integration merge commit: [`7d5abcadf05e3be374b5513e041bb8a8002c6a2d`](https://github.com/Akshay-VK/quanta-pulse/commit/7d5abcadf05e3be374b5513e041bb8a8002c6a2d) (`chore: merge R1A scan truthfulness fixes (#60)`)
- Files changed by R1A code: `src-tauri/src/models.rs`, `src-tauri/src/quanta/discover.rs`, `src-tauri/src/sync/engine.rs`, `src/lib/types.ts`
- Scoped review: no unexpected files; adds `ScanOutcome.committed` in Rust/TS and reconciliation/collection changes in engine/discover. No auth/db/search/academic feature files edited.

### R1A checks / evidence

Reported by implementer (`/tmp/quanta-57-r1a-result.md`) on code commit `e8c9bbd`; not rerun by this integration agent:

- Windows native runner (`scripts/test-windows-lib.ps1`, fixed TEMP/quanta-native-test-target): 262 passed, 1 ignored.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test`: 869+ passed with default timeout; full 877 suite reported passing with increased timeout for `appCoursesKeyboard` (environment timing, not claimed as code failure).

### R1A proof gap / limits

- **No new tests were added by the R1A diff.** Regression coverage for production commit failure/truncation and the new `committed` scan outcome was not present in the integrated code at merge time. Test count unchanged from baseline is a proof gap, not proof of acceptance.
- A separate proof implementer owns R1A regression proof/minimal fixes and holds the exclusive full native runner lease; expected result at `/tmp/quanta-57-r1a-proof-result.md` on completion. That agent should merge the latest integration before reporting.
- This integration does **not** claim R1A complete or fully accepted. #60 remains open pending proof/final acceptance.
- No full duplicate test runs were performed by this integration agent. No live Quanta access, no packaged app run.

## Integration checks

- `git diff --check d259205..7d5abca`: passed.
- `git status --short`: clean after both merges.
- Merge strategy: `--no-ff` merge commits with conventional messages; no reset/rebase/destructive cleanup; no conflict resolution required.
- Combined integration contains R1B auth/db changes and R1A committed ScanOutcome/engine/discover changes.

## 2026-11-21 superseding note — R1A regression proof merged (pending final acceptance)

This note supersedes the earlier "R1A proof gap / limits" section only to the extent that regression-proof tests were merged; it does **not** claim R1A fully accepted or close #60/#62.

- Integration branch head after proof merge: `12391a302b6090ecbb011d58ccf1b61188a53498` (`test: merge R1A scan reconciliation regression proof (#60, #62)`)
- Proof source commit: [`ecfc5bf1ce225a140c4081bd338c2f6b3c606467`](https://github.com/Akshay-VK/quanta-pulse/commit/ecfc5bf1ce225a140c4081bd338c2f6b3c606467) (`test: add R1A scan reconciliation and completeness regressions`, branch `t3/atomic-scan-regressions`)
- Proof commit scope verified: `src-tauri/src/sync/engine.rs` (test module include only), `src-tauri/src/quanta/discover.rs` (4 tests), `tests/scan_reconciliation_r1a.rs` (5 tests). No production behavior changes.
- Base includes latest integration before merge: proof branch based on `f9c7311` (then integration head); `git diff --stat f9c7311..ecfc5bf` matches merged delta. `git diff --check f9c7311..HEAD` passed; worktree clean.

### Regression tests merged

`tests/scan_reconciliation_r1a.rs` (included by `src-tauri/src/sync/engine.rs` under `#[cfg(test)]`):
- `failed_resource_statement_rolls_back` — SQLite trigger aborts resource insert; asserts `commit_scan` not committed, errors reported, no resources/courses persisted, no baseline established.
- `failed_event_statement_rolls_back` — trigger aborts event insert with baseline already established; asserts rollback, no resources/events persisted.
- `commit_failure_via_deferred_fk_preserves_state` — deferred FK violation causes commit failure after statements succeed; asserts existing inventory/miss streak/events/baseline/reset markers preserved, committed=false, zero counts/missing IDs.
- `complete_success_commits_and_preserves_quiet_baseline` — healthy loopback discovery; asserts committed, new/updated/unavailable zero, baseline established, resource persisted.
- `reset_during_collection_retains_newer_generation` — global reset generation advances to 5 during collection; stale-generation scan commits resources but does not establish baseline and retains newer generation.

`src-tauri/src/quanta/discover.rs` tests:
- `exact_resource_cap_page_remains_healthy` — exact cap page treated as complete/successful.
- `resource_cap_truncation_is_partial` — cap+1 resources marks course unsuccessful with partial error.
- `cancelled_discovery_is_not_successful` — cancellation yields `cancelled=true`, no successful courses.
- `fallback_course_listing_failure_is_not_empty_success` — failed fallback listing reports errors, empty courses, not successful empty inventory.

### Boundary/proof strength

- Tests exercise production boundaries: real temporary SQLite (`db::open` + tempdir), loopback HTTP fixtures via `QuantaClient::fixture_client` and `discover::discover_all` for collection, and `engine::commit_scan` production reconciliation boundary. SQLite triggers/deferred FK provide failure injection.
- Proof result (`/tmp/quanta-57-r1a-proof-result.md`) reports Windows native runner `scripts/test-windows-lib.ps1`: 278 passed, 0 failed, 1 ignored on `ecfc5bf`.

### Unresolved acceptance/proof limits

- No red-before-green baseline/mutation evidence documented for these regressions; they were added as proof tests on already-integrated R1A code. This merger did not rerun the full suite.
- Coverage does not directly exercise every R1A acceptance case: `run_scan` dispatch gating (notifications/mirror/miss/baseline consumption) is covered indirectly by `commit_scan` committed contract, not end-to-end through `run_scan`; detail-task JoinSet failure injection, partial nested page, genuine complete empty course, and the two-complete-scan `MISS_THRESHOLD=2` absence case are not directly covered by these added tests. Detail join failure remains a documented code-path limit in proof result.
- No live Quanta access, no packaged app run. Full native suite not rerun by this merger; shared canonical full runner lease constraints apply.
- #60 and #62 remain **open** pending final acceptance/parent review. R2 may proceed on local behavior acceptance where R1A contracts are satisfied, but final parent review remains required.
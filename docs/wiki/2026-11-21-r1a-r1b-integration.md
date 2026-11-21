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

## 2026-11-21 superseding note — R1B identity proof integrated

This note supersedes the earlier R1B identity-proof status and integration-head checkpoint. Historical checks above retain their original scope. It does not add migration/backup proof, close #61, or claim final acceptance of #57.

- Prior integration head: `5756e70f5d087791aaea3e6fa988d3e6f5d7e809`.
- Identity proof source: [`dd0d1646a600ce112167070da7c28ed2a1526167`](https://github.com/Akshay-VK/quanta-pulse/commit/dd0d1646a600ce112167070da7c28ed2a1526167) (`test: prove verified session identity publication (#61)`).
- Code integration merge: [`ce9ee1e91374d2355d2de571c93406e3f245f7cd`](https://github.com/Akshay-VK/quanta-pulse/commit/ce9ee1e91374d2355d2de571c93406e3f245f7cd) (`test: merge R1B session identity publication proof (#61)`). Conventional `--no-ff` merge, no conflicts or source edits by the merger.
- Entire merged tree equals the proof source tree: `f8d6eaca6e4957dde287edc49fce5442c24a5e2b`. `git diff --exit-code dd0d164 HEAD` and `git diff --check 5756e70 HEAD` passed at this code checkpoint; worktree clean.
- Delta is limited to `src-tauri/src/auth.rs`, test-only fixture support in `src-tauri/src/quanta/client.rs`, and `tests/auth_session_publication.rs`. R1A engine/discovery/reset regression files and `src-tauri/src/db.rs` are byte-identical to `5756e70`, preserving the R1B schema revision gate and earlier migration proof.

### Production contract and six tests

Both real password and SSO finalization call the extracted `verify_and_install_session` operation. It performs the actual `/my/` fetch, parses verified facts, updates session metadata on the same client/jar, and installs state through the existing synchronous `commit_sso_if_current` fence. The Tauri adapter still emits `auth:changed` before reading status. The operation is private; tests access the real implementation from its test module. This is production-operation coverage, not a claim that a new public command was added.

The six regressions use loopback HTTP, real reqwest cookies, real AppState and temporary file-backed SQLite:

1. Password publication replaces stale user ID/name/sesskey, preserves explicit label/method/acquisition time, updates AuthStatus/SQLite/auth state, clears the previous error, and leaves an unrelated SSO slot intact.
2. Current SSO publishes verified identity and preserves the existing `quanta-account` fullname fallback.
3. Current SSO preserves an explicit account label.
4. Cancellation while `/my/` is paused rejects installation after the response, preserving the prior client, persisted label, expiry and error.
5. A delayed old SSO response cannot replace identity or consume/complete its successor.
6. HTTP 401 verification leaves prior identity/state untouched.

All three success paths assert exactly the original cookie on `/my/`, rotated session metadata, and exactly the rotated cookie on a subsequent authenticated `/next` request. The active origin is checked before that request. No second stale transport is constructed after verification.

### Check provenance and mutation limits

The merger inspected the actual six tests and retained logs from `/tmp/quanta-57-r1b-proof-result.md`; it did not execute the mutations or rerun Cargo. The implementer used distinct `%TEMP%\quanta-r1b-session-proof-target`, preserving canonical runner manifest flags and avoiding R2's canonical target lease.

- Identity mutation: omit only `client.session = session.clone()`; auth run exit 101, 14 passed / 1 failed / 1 ignored, stale fullname observed. Restored assignment: identical auth filter exit 0, 15 passed / 1 ignored.
- Fence mutation: bypass only `commit_sso_if_current` ownership checking; six-test run exit 101, 4 passed / 2 failed, cancelled/stale responses unexpectedly published. Restored fence and final adapter ordering: auth run exit 0, 20 passed / 1 ignored.
- These are staged mutation regressions on the already repaired production operation, not a checkout-and-run reproduction of every historical pre-fix tree. Fence RED preceded the final unit-return/emit-before-status extraction adjustment; final full GREEN includes that adjustment and stricter cookie/origin assertions. No independent cookie-loss mutation is documented.
- Final `cargo test --target x86_64-pc-windows-msvc --lib`: **284 passed, 0 failed, 1 ignored**, 8.53 seconds (`/tmp/quanta-r1b-full-tests.log`).
- Final `cargo check --all-targets --target x86_64-pc-windows-msvc`: passed (`/tmp/quanta-r1b-check.log`). The implementer also recorded passing `git diff --check` and fixture rustfmt check.
- Integration verification is same-tree equality and whitespace checks. No duplicate full suite or frontend gates: no frontend change, unchanged tested Rust tree, canonical runner reserved for R2 until the assembled gate.

### A0 prerequisite and remaining limits

The verified-identity publication prerequisite is satisfied for **local synthetic A0 work**, alongside the previously integrated migration revision gate. It supplies verified Moodle ID/current metadata when `/my/` exposes them. It does not make email/fullname an ownership key, guarantee every page exposes a verified ID, or implement academic isolation. A0 must require official origin plus verified Moodle user ID, reject absent/unverified ownership, partition reads/storage/baselines, advance work generations on logout/reset/replacement, and reject late persistence/events/frontend results. R2 remains a separate prerequisite.

No native credential acquisition/WebView lifecycle, Tauri event delivery, live Quanta/SSO, deployed Moodle layout, TLS/Secure-cookie behavior, or real student identity was proved. HTTP fixture cookies deliberately omit Secure; the production HTTPS origin and Secure-cookie constructor are unchanged. The ignored interactive blank-window test remains ignored. Linux GTK/WebKit and minimum Rust 1.77 execution remain unproved. The separate migration/backup acceptance matrix is not newly proved here. V1 continues to gate unattended academic collection. #61 and #57 remain open; no final parent acceptance claim.

## 2026-11-21 superseding note — R2 integrated with assembled proof

The [R2 integration record](2026-11-21-r2-integration.md) supersedes the earlier pending R2 prerequisite and assembled-run status: source `c0559f58f209015c8a605ebe2d6408bbf2fb14c0` merged at `b4f08a68d4aea8b06fe9ce41d3413559dbe90b33`. All nine R1A and six auth proofs remain in the assembled Windows result (292 passed, 1 ignored; all-targets check passed). R2 adds production HTTP/SQLite proof for partial nested pages, genuinely empty courses, two-complete-scan absence and atomic miss/baseline failures, closing those specific earlier R1A proof gaps. Reconciliation now resides in `sync/reconcile.rs`; historical engine references describe their original revision. AppHandle dispatch and detail-panic injection limits remain. Local synthetic A0 may proceed on the integrated seams; academic isolation/generation fencing, the remaining migration/restore matrix, V1 and final ticket/parent acceptance are separate obligations. Historical results above retain their original scope.


## 2026-11-21: Prerelease backup ordering corrected

On 2026-11-21, `Akshay-VK/quanta-pulse@4ed4b79882c78237d8082b75da72e046637bcab6` corrected the inherited prerelease comparison identified during R2 integration. This supersedes that specific pending-defect claim: dotted numeric identifiers compare numerically, numeric identifiers precede text, shorter equal prefixes precede longer ones, and build metadata does not affect precedence. Existing schema-revision and backup-before-migration gates were preserved.

The public SQLite upgrade regression for `0.2.0-rc.2` to `0.2.0-rc.10` first failed with no backup, then passed after the fix. Fifteen Windows upgrade tests passed, including eight literal ordering/metadata cases; Windows all-targets `cargo check` passed using the distinct R1B target, without the canonical academic-foundation runner. Evidence: `/tmp/quanta-57-prerelease-red.log`, `/tmp/quanta-57-prerelease-green.log`, `/tmp/quanta-57-prerelease-upgrade-tests.log`, and `/tmp/quanta-57-prerelease-check.log`. Broader A0 migration/restore proof and final parent acceptance remain separate requirements under [#57](https://github.com/Akshay-VK/quanta-pulse/issues/57) and [#61](https://github.com/Akshay-VK/quanta-pulse/issues/61).

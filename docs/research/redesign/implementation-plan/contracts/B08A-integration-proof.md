# B08A acceptance proof

Task B08A / issue #45 / shared dirty HEAD `84c20eb` / proof only; no source edits.

## Acceptance

- **PASS — completion promise, duplicate starts, unique IDs/labels, cancellation, stale completion, and verified-session fence.** Windows focused auth suite: 8 passed. Existing deterministic unit coverage exercises shared completion, A cancellation followed by B, stale focus/close target selection, one-shot terminal results, and current-attempt commit fencing. The implementation captures A's label/attempt while holding the lifecycle mutex before it releases the lock for native close; delayed native close is therefore addressed to A's unique label.
- **PASS — reset/start serialization by lock inspection; concurrency proof limited.** `start_sso_login` reads `auth_resetting` and claims/joins the attempt under `sso_lifecycle`; reset raises the flag before acquiring that same mutex to inspect/cancel the active ID. Thus a start that reads false completes its slot claim before reset can inspect; a start after reset raises the flag rejects. Existing tests do not use deterministic barriers to force both interleavings, so this is code-order evidence, not a barrier test.
- **PASS — Windows compilation and library tests.** Commands below all passed.
- **BLOCKED — native-window focus/cancel delivery.** No blank native-window harness or existing native test seam was available; the existing lifecycle tests use labels and fake operation selection and cannot prove OS focus/close delivery. No app or SSO URL was opened. Requires an interactive Windows native window smoke by the integrator; production login URL/credentials remain out of scope.

## Commands and evidence

External script: `C:\Temp\b08a-proof.ps1` (outside repository). It prints `CARGO_INCREMENTAL=0` and `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`, then runs from the requested `src-tauri` directory:

- `cargo check` — passed.
- `cargo test --lib auth::tests -- --nocapture` — 8 passed.
- `cargo test --lib` — 255 passed.

No `cargo fmt` or source formatting was run. No live Quanta requests, credentials, or packaged app were used. Focused fake-window tests are deterministic without viewport/theme/density (native UI is not rendered).

## Changed files / contract

Only this proof artifact. No exported interface or behavior change; no source patch. Root remains sole integrator. Native smoke is the remaining B08A acceptance item.

## Race regression proof update

The missing deterministic race tests are now implemented in `src-tauri/src/auth.rs`. Production `start_sso_login` calls `claim_sso_attempt` while holding the lifecycle mutex; the helper checks the reset gate and claims/joins the slot in that same critical section. This narrow extraction preserves the existing error text, owner/join behavior, generated IDs/labels, and active-flag update. Tests drive the helper used by production.

- **PASS — start claims after observing a false gate before reset:** a thread holds the lifecycle mutex through the claim, signals the reset thread to raise its gate, then releases the mutex. Reset blocks on that mutex, observes/cancels claimed A, and publishes cancellation to its waiter. Channel synchronization forces the order; no sleeps.
- **PASS — reset gate raised before start claim:** the production claim helper rejects and leaves the slot empty.
- **PASS — delayed close:** test captures A at cancellation, installs B, then delivers A's captured label to a fake sink. Only `quanta-login-A` is closed; B remains in the slot with unfinished completion and untouched terminal state.
- **BLOCKED — native OS focus/cancel delivery** remains unproved; these are deterministic fake-sink tests, not an interactive native-window smoke.

Updated Windows proof: `C:\Temp\b08a-proof.ps1` printed `CARGO_INCREMENTAL=0` and `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`; `cargo check` passed, focused auth tests **11 passed**, full `cargo test --lib` **258 passed**. Exact-file `rustfmt --edition 2021 --config skip_children=true src-tauri/src/auth.rs` completed before the successful run. No state.rs change, command registration, packaged app, live Quanta request, credentials, or git operation.

Changed files: `src-tauri/src/auth.rs` (claim helper + 3 regression tests; helper refactor makes tests exercise production gate/claim logic) and this proof document (append only). The previous “proof only / no source patch” statement above records the prior worker's result and is superseded here for race coverage; native smoke remains outstanding.

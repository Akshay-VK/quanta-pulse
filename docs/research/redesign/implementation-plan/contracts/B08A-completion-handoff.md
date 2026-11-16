# B08A native SSO completion handoff

Base: `e5b43f3` (accepted HEAD). This is an implementation patch only; issue #45 remains unaccepted.

## Native interface

- `auth::start_sso_login(AppHandle) -> Result<AuthStatus, String>` remains a completion promise. Duplicate starts subscribe to the same active attempt completion and window.
- `auth::active_sso_attempt_id(&AppState) -> Option<String>` remains crate-private and reports only the current attempt.
- `auth::focus_sso_login(&AppHandle, &str) -> Result<(), String>` snapshots the matching unique label under the lifecycle mutex, then performs show/unminimize/focus after unlocking. Stale IDs are no-ops.
- `auth::cancel_sso_login(&AppHandle, &str) -> Result<(), String>` removes and completes only the matching attempt while locked, then closes that attempt's uniquely labelled window after unlocking. Stale/repeated IDs are no-ops.

Attempt completion is one-shot. The owner publishes only if its ID still owns the active slot. Cancellation wakes duplicate callers immediately; a late verification result cannot publish or install a session. Reset checks are serialized with starts at the lifecycle lock, cancels the old attempt, and publishes its reset-flow result to any shared start callers. Session installation checks currentness immediately after remote verification and holds the lifecycle mutex through the synchronous commit. Lock order is lifecycle then DB connection then other state locks; no lifecycle/connection lock spans an await or window callback.

## Evidence

Windows native commands used the configured temporary target directory and `CARGO_INCREMENTAL=0`:

- `cargo check` — passed.
- `cargo test --lib auth::tests -- --nocapture` — passed (6 focused tests before adding install-fence and stale-window coverage).
- `cargo test --lib -q` — passed, 255 tests.
- Direct `rustfmt --edition 2021 --config skip_children=true src/auth.rs src/state.rs` — completed.

Deterministic tests cover duplicate shared completion, cancel A/start B/late A completion, stale focus/close target isolation, one-shot timeout/window-close/reset terminal completion, and a fake verified-session install callback fenced against stale A. No credentials, Quanta HTTP, or production SSO URL were used. Actual OS focus delivery remains unproven; a blank local native-window smoke is still required. No packaged app was run.

## Acceptance status

Lifecycle implementation and deterministic/native compilation proof are ready for coordinator review. Native-window delivery is unproven, so B08A and issue #45 remain unaccepted; do not close the issue or mark readiness. B08B may use the interface above. Existing password sign-in continues to use the unfenced shared session finalizer.

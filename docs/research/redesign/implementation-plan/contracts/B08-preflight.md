# B08 SSO lifecycle preflight

The frozen B08 row in `docs/research/redesign/implementation-plan/contracts/00.md` keeps `AuthStatus`, `api.startSsoLogin()`, and `api.authStatus()`; it adds `attemptId:string|null` for active SSO plus `api.focusSsoLogin(attemptId)` and `api.cancelSsoLogin(attemptId)`. `worker-contract.md` requires exact leases and serialized B-task command/API/type work. B08 names `auth.rs`, `commands.rs`, `lib.rs`, and `api.ts`; separate 04C0 owns common command/API/registration, so confirm ownership before edits.

## Existing flow and surfaces

- `auth::start_sso_login(AppHandle) -> Result<AuthStatus, String>` owns an `AtomicFlagReset` on `AppState.sync.sso_login_active`, rejects overlap, then awaits `run_sso_login_inner`. The guard prevents duplicate concurrent windows but has no identity and no focus behavior.
- `run_sso_login_inner` uses `SSO_WINDOW_LABEL = "quanta-login"`, builds a webview at the fixed SSO URL, polling URL and cookies every 750 ms up to `SSO_TIMEOUT` (300s). Missing window maps to cancelled `LoginRequired`; timeout also returns login-required. It closes the window after cookie detection then calls `finalize_session`.
- `finalize_session` verifies `/my/` before storing. A successful older future can therefore still store after a later flow unless commit is fenced by attempt identity. `restart_quanta_session` also closes the fixed-label window and runs the same inner flow under the same guard; coordinate this cancellation path.
- Commands currently expose `commands::start_sso_login`, `auth_status`; `lib.rs::run` registers them. `src/lib/api.ts` wraps them; `AuthStatus` in `src/lib/types.ts` has no attempt field. No SSO focus/cancel/status event exists.
- `LoginScreen.sso()` awaits the command; its pending copy says “Waiting for BITS SSO.” Preserve password sign-in as `login_with_password` / `api.login`; do not imply OAuth/account-server behavior.

## Minimal seam and isolation

Keep start as the existing completion promise for compatibility, with an additive active-attempt status/event carrying nullable `attemptId`; add attempt-ID focus and cancel commands. Start should return/reuse the current attempt instead of opening another. Focus shows, unminimizes, and focuses only the matching live window. Cancel marks only the matching attempt terminal, closes its window once, and is a no-op for stale/finished IDs. Give each attempt an identity captured by its polling/completion task and check it again before commit; terminal transition is one-shot. A stale callback may close only its own window and must not clear or overwrite newer active state. Exact event name, start return shape, status enum, and whether cancel awaits completion are unspecified by the frozen row; settle with the contract owner before implementation.

## Proof and leases

Existing focused evidence: `auth.rs` unit test `concurrent_sso_attempts_cannot_open_overlapping_windows` and `tests/sessionRefresh.test.tsx` (reset waiting/cancel/retry UI), but neither proves per-attempt stale-callback isolation or native focus. Add pure Rust lifecycle tests with controlled attempt IDs/completion ordering: cancel A, start B, deliver A late, assert B remains active and session unchanged; repeat cancel/focus to prove idempotence. Use temporary state/DB and no credentials. Pure-state proof does not prove Tauri native window delivery/focus. Smallest native dev-window check: run `npm run app:dev`, invoke start once in the app, verify one `quanta-login` window, invoke focus twice and observe it restored/focused, cancel twice and observe it closes, then start B and confirm late A completion cannot affect B without entering credentials. No live sign-in is needed; if navigation itself contacts Quanta, that is external traffic and should be avoided for this smoke test. Local/mock native-window support is not established.

Narrow leases: lifecycle state/window work in `auth.rs` (coordinate `state.rs` if fields change); command wrappers in `commands.rs`, registration/API/types in the single common-surface owner; UI copy/controls only under an explicit component lease. No broad auth-history or gallery inspection was performed.

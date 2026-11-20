# B08B implementation handoff

Task B08B / issue #46 / base `f4fce8d` / patch only.

## Acceptance

- `AuthStatus.attemptId` is nullable and camelCase; Rust populates it through `active_sso_attempt_id`. PASS.
- Matching-ID focus and cancel commands delegate to the accepted auth lifecycle functions and are registered with Tauri. PASS.
- Typed API wrappers pass `{ attemptId }`; `startSsoLogin()` and `authStatus()` retain their existing behavior. PASS.
- API tests cover command names, arguments, and native error propagation. PASS.
- Full lint passed. The initial full Vitest run had 603 passing tests and one failed suite due to Vitest mock hoisting; the mock was corrected and its focused suite passed. Full Vitest rerun remains pending.
- Production build started after the fix but had not completed at handoff. Windows `cargo check` and Rust tests remain pending.

## Changed files

`src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/models.rs`, `src-tauri/src/auth.rs`, `src/lib/api.ts`, `src/lib/types.ts`, `tests/ssoLifecycle-api.test.ts`, and typed status fixtures in `tests/axeViews.test.tsx`, `tests/helpers/renderApp.tsx`, and `tests/settingsAbout.test.tsx`.

## Contract

`api.focusSsoLogin(attemptId: string)` and `api.cancelSsoLogin(attemptId: string)` return `Promise<void>` and propagate command failures. Stale or repeated IDs retain the native no-op semantics. `AuthStatus.attemptId` is `string | null`.

No frontend SSO UI, lifecycle logic, Settings, Agenda, or CSS changes were made. Native OS delivery is covered by the B08A proof; this task did not rerun it.

# B08A native SSO handoff

Base: `34cbe7dee8d111b2c1e055665a9204f838714baa`.

## Consumer seam

- `auth::active_sso_attempt_id(&AppState) -> Option<String>` is private to the crate and returns the current opaque attempt ID, or `None` after terminal completion.
- `auth::focus_sso_login(&AppHandle, attempt_id: &str) -> Result<(), String>` targets only the matching active attempt; stale/finished IDs are successful no-ops.
- `auth::cancel_sso_login(&AppHandle, attempt_id: &str) -> Result<(), String>` terminally cancels only the matching attempt, closes its unique window, and wakes all start callers with the existing login-required error. Stale/repeated IDs are no-ops.
- `auth::start_sso_login(AppHandle) -> Result<AuthStatus, String>` remains a completion promise. Concurrent duplicate calls focus and await the same attempt result.

B08B should add the frozen `AuthStatus.attemptId` DTO field and command/API wrappers. Query `active_sso_attempt_id` when assembling auth status. Focus/cancel wrappers should call these native functions and preserve their idempotent semantics.

## Invariants and proof limits

Each attempt has a UUID-derived unique webview label. The active lifecycle mutex fences the verified SSO session install and remains held across the synchronous state/DB commit, making cancellation and commit mutually exclusive. The shared non-reentrant DB connection guard is not held across async work. No SSO lifecycle mutex is held across an await. Completion state exists only for the active attempt; old senders cannot mutate successor state. Restart removes and cancels the active attempt before beginning its own attempt and clears the active flag only when the ID still matches.

No production SSO URL or credentials were used. Native focus delivery needs a blank/test-window runtime smoke after integration. The task still needs deterministic lifecycle regressions and Windows-native cargo gates before acceptance.

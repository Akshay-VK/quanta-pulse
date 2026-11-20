# B01 independent review

Reviewed fixed diff `3c705400..9efa82e480b75fb5633a4881a2b0384f028f07c4`; ignored uncommitted appearance work.

## Findings (severity order)

- **P2 — reset can reveal a stale alias.** `set_course_display_name(..., None)` clears the SQLite column, but `displayName()` then falls through to `loadAliases()` (`src/lib/courseName.ts:43-49, 132-143`). A previously saved `quanta-pulse-course-aliases` entry therefore remains the displayed name after reset, rather than returning to the derived Quanta label. Define reset semantics for legacy aliases and either migrate/clear the matching alias or retain that behavior explicitly; add a regression covering set → reset with an existing alias.
- **P3 — legacy migration lacks a direct regression.** Migration 0006 conditionally adds `courses.display_name` (`src-tauri/src/db.rs:184-192`), but the added DB tests initialize via current `migrate()` and do not construct a pre-0006 populated schema. Add a legacy-schema migration test that preserves course identity and yields `display_name = NULL`. Implementation is simple and idempotent; this is a coverage gap, not an observed migration failure.

## Acceptance evidence

- Durable save/reopen, scrape upsert preserving override while updating source name, explicit DB reset, source identity, Unicode trim, empty/overlength/unknown-ID validation: **PASS** by code inspection and the two focused Rust tests below.
- Migration: **PARTIAL**; conditional additive migration inspected, no legacy-schema fixture regression.
- Name registry and DTO/API parity: **PASS**; durable override precedes aliases, registry uses the resulting label, Rust `Course` serializes camelCase `displayName`, TS `Course` matches, command is registered and has the sole `api.ts` invoke wrapper. Existing duplicate-label disambiguation remains active.
- Reported by coordinator: focused frontend 17 tests and lint **PASS**. Full frontend suite/build **not used** because they overlapped appearance work.
- Linux Rust check had the reported environment failure (`dbus-1.pc` unavailable). Windows-native verification **PASS** on this worktree: PowerShell `cargo check` and `cargo test --lib db::tests::course_display_name -- --nocapture`; both display-name DB tests passed (2/2), with `CARGO_INCREMENTAL=0` and target at `%TEMP%\quanta-pulse-b01-review-target`. No app or installer ran.
- `git diff --check 3c705400..9efa82e480b75fb5633a4881a2b0384f028f07c4`: **PASS**.

**Recommendation: conditional accept.** Core B01 storage, rediscovery, validation, command wiring, and Windows Rust gates pass. Resolve/document legacy-alias reset behavior and add a legacy migration fixture before treating migration/reset acceptance as complete. No observed Rust build/test blocker; no full frontend/build gate claimed.

# 2026-11-14: Attention and due collection data contracts

The backend/data slice of the [approved overhaul](../specs/2026-11-14-ui-themes-and-workflows.md) is implemented at code commit `452c2eee79c3c01040f1133e10124f587c0ef185` (`feat: add complete attention and due collection contracts`). This is an isolated implementation checkpoint, not acceptance of the assembled UI or completion of parent issue #12. Historical workspace and specification claims remain unchanged.

## Decisions and interface

At that commit, `src-tauri/src/attention.rs` is the deep module at the existing SQLite seam. A pure deterministic Inbox selector supplies the same grouped matches for paginated listing, unread totals, course counts, and complete bulk ID snapshots. One surviving resource is one item; missing resources fall back to individual recorded events. Type/search select whole attention groups, and dismissal removes only the captured events from attention. Baseline and incident-suppressed events stay out of Inbox. Source and detection timestamps retain their separate meanings.

Explicit desired-state read/unread mutations are idempotent and atomic; already-read rows retain their original acknowledgment timestamps. The separate event-keyed dismissal ledger has an idempotent initialization migration and explicit down migration. Later events for a dismissed resource reappear. Permanent history deletion is a separate command that cascades ledger cleanup and explicitly chooses whether scan diagnostics are also deleted. Legacy Dashboard/History clears, raw unread counts, and mark-read contracts retain their prior meanings until frontend migration.

The due collection reads the full resource inventory, independently of activity, baseline, dismissal, Dashboard clears, source availability, and saved-file state. It omits invalid dates, preserves original strings, distinguishes instants from date-only sources, and defaults to monitored courses while allowing explicitly selected paused courses. Separate calendar bounds let frontend timezone selectors handle date-only sources alongside instant ranges, including a 25-hour DST day. No submission/completion status is inferred.

The registered commands and matching TypeScript wrappers, full JSON payload examples, exact filter/count/snapshot semantics, and frontend integration instructions are published in [attention collection contracts](../contracts/attention-collections.md). No App, view, styling, theme, updater, production authentication, scraper, baseline, or MISS_THRESHOLD behavior is changed by this slice.

## Verification at the code commit

- Native Windows `cargo check --all-targets`: passed.
- Native Windows `cargo test --lib`: 182 passed, including 13 new attention/data tests.
- `npm run lint`: passed, zero warnings.
- `npm test -- --maxWorkers=2 --minWorkers=1`: 40 files / 335 tests passed, including three new bridge-contract tests.
- `npm run build`: passed; Vite retained its main-chunk size warning (500.59 kB).
- `git diff --check`: passed.

Native Cargo ran through `powershell.exe` directly in the prepared worktree at `\\wsl.localhost\Ubuntu\home\akshay-vk\.t3\worktrees\quanta-pulse\t3-4ea30e03\src-tauri`, with `CARGO_INCREMENTAL=0` because the first attempt encountered unsupported UNC incremental lock creation. No source was copied over the parent checkout. The existing HTTP expiry fixture now explicitly makes accepted sockets blocking: this resolved six Windows nonblocking-read failures without changing production auth behavior or adding a network seam. The initial unconstrained frontend run failed in the Settings suite during cold concurrent compilation; that suite passed independently, and the complete bounded-concurrency run passed twice.

Temporary file-backed SQLite coverage includes inventories of 5,105 resources/items, stable ordering and pagination, matching counts, complete scope capture with later arrivals excluded, whole-group type filtering, orphan fallback, read/unread persistence, forced transactional failures, dismissal persistence and reappearance, reversible migration, deletion cleanup, baseline deadlines, paused courses, changed/invalid/date-only dates, and UTC/offset/DST range contracts. Serialization tests verify camelCase payloads and defaults.

## Limits and integration status

The implementation materializes complete collections before pagination: O(n) memory and O(n log n) ordering. Offset pages are stable for an unchanged dataset; frontend refresh/request-generation handling is still required for changing datasets. Date grouping, configured IANA timezone resolution, stale/error presentation, confirmation copy, badges, and UI action wiring belong to the future frontend slice. New Inbox badges must use the new grouped collection counts rather than legacy raw-event counters.

No live signed-in Quanta flow, Tauri GUI/native smoke, packaged app, installer, main merge, push, or full-overhaul acceptance was performed. The bounded native compiler/test evidence does not establish those outcomes. Deferred discovery ideas were not implemented.

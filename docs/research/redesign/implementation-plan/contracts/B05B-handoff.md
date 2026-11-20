# B05B implementation handoff

## Frozen API

- `api.snapshotHistoryDeletion(includeScans: boolean): Promise<HistoryDeletionScope>` invokes `snapshot_history_deletion` with `{ includeScans }`.
- `HistoryDeletionScope` is `{ eventIds: number[]; scanIds: number[] }`.
- The snapshot contains every physically stored `change_events.id`, including calendar-suppressed and history-watermarked rows. When `includeScans` is true it also contains every `scan_runs.id`; otherwise `scanIds` is empty. Counts are the corresponding array lengths.
- `api.deleteHistorySnapshot(scope: HistoryDeletionScope): Promise<HistoryDeletionResult>` invokes `delete_history_snapshot` with `{ scope }`.
- `HistoryDeletionResult` is `{ eventsDeleted: number; scansDeleted: number }`; these counts equal the validated frozen ID array lengths.
- Both ID arrays must contain only positive, unique integers. Invalid arrays reject before mutation. Empty arrays are valid and delete nothing.
- The mutation validates all captured IDs inside one SQLite transaction before deleting any. A missing captured event or scan returns the stable error `HISTORY_SCOPE_CHANGED`; callers must capture a fresh scope and renew confirmation. Rows added after capture do not change scope validity and survive deletion.
- All deletion and scan diagnostic cleanup is transactional. Resources, mirror saved-file rows, baseline state/markers, history watermarks, and unrelated KV state are outside the deletion scope.

## Legacy caller

`api.deleteHistory(includeScans)` and `delete_history` remain registered for existing callers. They delete all event rows, and optionally all scan rows, at mutation time. This whole-table behavior is unsafe for a previously displayed confirmation because later arrivals can be deleted too. New confirmation flows must use the frozen snapshot API; UI conversion is outside B05B.

## Verification

Rust tests cover uncapped counts and hidden rows, `includeScans: false`, later arrivals, stale event and scan IDs, malformed IDs, trigger failure rollback, saved-resource/baseline/KV preservation, and scan diagnostic cleanup. `tests/historyDeletion-api.test.ts` covers both invoke payloads, returned shapes, error propagation, and legacy wrapper retention.

## Coordinator correction — 2026-11-16

An independent review reproduced successful SQLite no-op deletes via `RAISE(IGNORE)`. The mutation now accumulates actual affected row counts and requires each captured row’s delete to affect exactly one row. Otherwise it returns `HISTORY_DELETE_INCOMPLETE` and rolls back the whole transaction, including earlier event deletions. Consumers must show the failure and retain their view; this is distinct from `HISTORY_SCOPE_CHANGED`, which requires renewed confirmation. The focused regression covers ignored events and ignored scans and passed natively after failing against the original implementation. No success count is derived merely from the input array lengths.

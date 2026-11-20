# B05 preflight

## Current seams

- `commands::list_history_events` fixes History events at 1,000 via `db::list_history_events`; that query uses `HISTORY_CLEAR_EVENT_ID_KEY`, excludes `calendar_suppressed`, and clamps to 5,000. `commands::list_history_scans` and `db::list_history_scans` similarly apply the scan watermark, with a 50 default and 500 cap. `db::list_events_filtered(EventFilter)` already provides event filtering and offset/limit, but not the History watermark contract. Keep these History-specific rules explicit.
- `attention::matching_inbox` reads all eligible unsuppressed/non-dismissed events and `attention::snapshot_inbox` returns full matching event IDs, independent of page bounds. `attention::inbox` demonstrates complete-collection pagination/count semantics. `commands::snapshot_inbox_event_ids` exposes this seam.
- `commands::delete_history(include_scans)` delegates to `attention::delete_history`, which currently deletes whole tables in one transaction. That is unsuitable for a confirmation whose captured scope must remain stable.
- Resource unread state today comes from `db::unread_count` and `db::unread_new_count`, which return counts only. The existing attention snapshot is grouped-inbox scoped; it does not express all unread event IDs for one resource.

## Small sequential split

1. **B05a — complete History reads and resource unread snapshot.** Add offset/limit filtered History event and scan queries, preserving clear-watermark, suppression, stable ordering and legacy behavior. Add a complete resource-scoped unread-ID query; I01 requires **ALL resource-scoped unread IDs**, beyond existing event/list caps, excluding records that are not unread/eligible under the shared History attention rules. Wire through `commands.rs`, registration in `lib.rs`, and `src/lib/api.ts`/`types.ts`. Land and hand off the exact DTO/command before UI consumers.
2. **B05b — authoritative frozen deletion.** After the read contract is stable, add a snapshot/count operation and a delete operation that accepts that captured scope (or opaque snapshot token), revalidates it transactionally, and returns actual deleted counts. Changed scope must produce a renewed-confirmation error; never widen silently. Later arrivals survive. Keep events/scans deletion atomic and preserve resources, saved files, baselines, and unrelated markers.

This order gives History a complete read contract before confirmation UI depends on counts. The suggested seam is a small camelCase `HistoryPage<T> { items: T[]; total: number }` for each paginated query, and `HistoryDeleteScope { eventIds: number[]; scanIds: number[] }` plus `HistoryDeleteResult { eventsDeleted: number; scansDeleted: number }` for immutable scope and mutation result. If scope size warrants a token, keep token contents server-side/local DB and retain the same result semantics.

## Tests and ownership

- Rust: focused tests beside `db`/`attention` for watermark and suppressed rows, deterministic order, offsets, >1,000 events and >500 scans, all resource unread IDs past caps, frozen IDs with a later arrival, scope mismatch, and transaction rollback/failure. Assert resources, baseline state and mirror/save rows survive deletion.
- Frontend contract: `tests/attention-api.test.ts` verifies argument and DTO wire names. `tests/appHistoryInteractions.test.tsx` verifies paginated loading, authoritative confirmation counts, renewed confirmation after mismatch, and later arrivals surviving. Preserve existing `tests/historyActions.test.tsx` behavior.
- Lease in sequence: B05a owns the new DB/attention read helpers, command registration, API/type contract and focused tests. B05b then owns the deletion snapshot/mutation path and its tests. `HistoryView.tsx` and `App.tsx` remain coordinator-assigned UI/integration leases; do not edit them as part of this backend/API preflight. Serialize shared `commands.rs`, `lib.rs`, `api.ts`, and `types.ts` across workers. No production edits are part of this preflight.

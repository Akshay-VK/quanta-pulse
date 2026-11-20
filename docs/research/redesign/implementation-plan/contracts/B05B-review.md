# B05B review

## Finding

- **P1 — Reported delete counts can exceed rows actually deleted.** `src-tauri/src/attention.rs`, `delete_history_snapshot` returns `scope.event_ids.len()` and `scope.scan_ids.len()` after issuing one `DELETE` per ID, without checking each statement's affected-row count. SQLite `BEFORE DELETE ... RAISE(IGNORE)` triggers make a delete a successful no-op; the transaction commits and reports the ID as deleted although the row (and, for scans, its `scan_details`) remains. Accumulate `tx.execute(...)` results and return those actual counts (or fail and roll back when a confirmed row was ignored). Add a focused trigger test for ignored event and scan deletes.

## Reviewed contracts

- Snapshot reads all stored IDs with no page cap and includes suppressed events; `include_scans: false` returns no scan IDs. In production, both queries run while the command holds the shared connection mutex, so they cannot interleave with other app commands.
- Deletion validates malformed and missing IDs before mutation, inside one transaction. A later row is outside the frozen arrays and survives. The trigger-abort test exercises rollback; scan diagnostics cleanup is enforced by the existing scan deletion trigger and is checked by the tests.
- Resource, saved-file, baseline marker, and unrelated KV preservation are asserted. The test also confirms diagnostic removal after successful scan deletion.
- Rust/TypeScript fields use camelCase, both commands are registered in `lib.rs`, and `api.ts` uses the expected invoke names and payloads. The legacy `deleteHistory` wrapper remains explicitly documented and tested for later UI conversion.

## Proof limits

Reviewed the specified diff and focused API test source; no broad test suite was repeated. Existing Rust tests cover abort-trigger rollback, but not `IGNORE` affected-row accounting, which is the finding above. No Windows native run was needed for this source review.

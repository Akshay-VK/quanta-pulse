# B07 preflight

## Source evidence

- The worker contract says the coordinator owns the plan, workers use assigned leases, and shared Rust/API/type files are serialized. B07 names candidates `core/mirror.rs`, `commands.rs`, `api.ts`, `types.ts`, and `useMirror.tsx`; it does not assign final ownership. Root retains code and Git integration.
- `Mirror::delete_all(&Connection) -> usize` in `src-tauri/src/core/mirror.rs` reads `db::mirror_all`, resolves rows through `join_within`, counts only successful `remove_file`, then unconditionally calls `db::mirror_clear_all`. Missing files count as failures; failed removals lose index truth. `mirror_clear_all` also deletes all versions and queue rows.
- Index access is `db::mirror_all`, `mirror_get`, `mirror_bytes` (status `ok|kept`), `mirror_upsert`, and `mirror_delete` in `src-tauri/src/db.rs`. `Mirror::stats/statuses/local_file/verify` consume those queries. `commands::mirror_delete_all` currently returns `MirrorStats`; `src/lib/api.ts` wraps it as `api.mirrorDeleteAll(): Promise<MirrorStats>`. `src/lib/types.ts` has `LocalFile`, `LocalFileStatus`, and `MirrorStats`, no deletion scope/result types.
- `Mirror::begin_attempt`, `cancel_download`, and `retry_download` manage attempts. A download has `attempt_id`; `download_one` guards outcome application by `Arc::ptr_eq`. Publication in `Mirror::attempt` holds the SQLite connection lock, then checks attempt identity/cancellation before rename/index upsert. Cancel/retry use the same connection-before-attempt-map order. Stale cleanup uses `remove_part_if_current`. `paths::join_within` rejects absolute/traversal/empty/backslash paths.
- `lib.rs::run` registers `commands::mirror_delete_all`; any new snapshot command needs registration and an `api.ts` wrapper.

## Recommendation

Use the smallest frozen seam from `contracts/00.md`: `MirrorDeleteScope { scopeId, count }`, `snapshotMirrorDeleteScope()`, then `mirrorDeleteAll(scopeId)` returning `{ removed, failed: [{ resourceId, path, error }] }`. The backend scope must capture exact `(resourceId, relPath)` rows and the original root, not re-query “all” at execution. Bind it to a unique scope ID and retain that immutable membership for retries; a retry snapshot may contain only failed members from that original scope. Counts/paths in the result must describe attempted frozen entries. On success, remove only that matching index row; preserve rows when filesystem deletion fails. Treat `NotFound` as explicit idempotent success and clear its matching row. Invalid `join_within` paths become failures and never reach filesystem APIs.

Serialize deletion against publication using the existing connection-then-attempt lock order. Snapshot only confirmed saved rows (`ok|kept`); later publications are excluded. Before removing file/index, ensure the current row still matches captured path and saved identity. Confirm whether scopes survive restart; in-memory is smallest but not durable. Decide whether `removed` counts missing files (recommend yes, without claiming bytes were unlinked).

Suggested narrow lease: `core/mirror.rs` and its focused Rust tests; serialized `commands.rs` + `lib.rs` registration; serialized `models.rs`/`types.ts` and `api.ts`; `useMirror.tsx` only if a consumer needs a changed result. Consumer decision needed: whether UI shows per-path failures and offers retry, and how it keeps the same scope ID for that retry. No production path or UI behavior is changed by this preflight.

Deterministic proof: temp SQLite/root with two indexed files; force one removal to fail (permission denial where supported, otherwise injected filesystem operation), assert success plus retained failed row/path/error, then retry only that original failed scope. Remove a file before execution to prove missing semantics. Seed traversal rows; assert no outside path is touched. Gate publication before the existing barrier, snapshot, release, and verify the successor is excluded. Change a captured file before delete; verify identity checks preserve successor bytes/index. Check results against `mirror_get`, `mirror_bytes`, directory contents, and DB transaction failures.

## Unknowns

The contract does not specify scope expiration/restart durability, index identity beyond resource/path (there is no generation column), or exact UI retry presentation. Permission-denied behavior differs by platform; use an injected removal seam for deterministic coverage and retain a platform smoke test only if the assigned worker can support it.

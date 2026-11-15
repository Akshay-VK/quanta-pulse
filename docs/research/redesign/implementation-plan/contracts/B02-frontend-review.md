# B02 frontend and wire review

Reviewed fixed diff SHA-256 `c7eebe015d30259dd519830c6fcf5bcbcc706dd189f07431c0ab171b72c1abb3` at repository HEAD `83fbbc543002ad5334cbbf14a7d189999904a468`.

## Finding

- **P2 — [useMirror.tsx:157](/mnt/d/dev/web/projects/quanta-app/quanta-pulse/src/hooks/useMirror.tsx:157):** A progress event is accepted whenever `attempts.current` has no entry for that resource, and then establishes that event's attempt ID as current. At provider startup, retry state can be absent until `mirrorDownloadProgress()` resolves; an already queued old-attempt event delivered in that interval can therefore become authoritative. This is especially possible when registration and snapshot calls race. The existing test only sends a stale event after a newer event has already seeded the map, so it misses this startup/reconciliation case. Smallest fix: establish event listeners before taking the initial snapshot, and reconcile buffered events by attempt ID/revision; add a regression where an old event arrives before the snapshot identifies the newer attempt and assert the snapshot wins. If listeners must remain after snapshot, buffer progress events during snapshot acquisition and reconcile against the returned attempt identities before publishing.

## Contract checks

- **PASS:** Rust `MirrorDownloadProgress` has `resource_id`, `attempt_id`, `state`, `bytes_done`, `bytes_total: Option<u64>`, `error`; `#[serde(rename_all = "camelCase")]` yields `resourceId`, `attemptId`, `bytesDone`, `bytesTotal` (nullable), and `error`. TS matches those fields and enumerated lifecycle states.
- **PASS:** `mirror_download_progress`, `cancel_mirror_download`, and `retry_mirror_download` are registered in `lib.rs`; frontend `invoke` calls are confined to `src/lib/api.ts`, with matching command names and `{ resourceId }` arguments.
- **PASS:** Listener cleanup handles unmount while async registration is pending and removes all three listeners after registration.
- **PASS:** Per-file download progress does not overwrite `LocalFileStatus`; local-file lookup/ensure results remain separately sourced from backend disk truth, so failed/cancelled status cannot imply a usable local copy.
- **PASS:** Unknown length is represented as `bytesTotal: null`; no fabricated percent is introduced in the hook.
- **Coverage gap:** This test exercises only stale-event rejection after a current event. No hook-level regression covers snapshot/event ordering, cancellation/retry API rejection behavior, or retained terminal progress after a later refresh. API promise errors currently propagate to callers, and cancel does not optimistically mutate state.

## Recommendation

**Accept with one focused follow-up regression/fix** for startup snapshot versus early event ordering; otherwise the frontend/wire contract is aligned. No broad frontend gates rerun, per request.

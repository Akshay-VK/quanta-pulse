# B07B API exposure handoff — 2026-11-16

Implemented the saved-file deletion scope API against the corrected B07A contract. The legacy `mirror_delete_all` Tauri command remains available for current Settings consumers. The new `snapshot_mirror_delete_scope` and `mirror_delete_scope` commands pass directly to the core and keep the connection guard through each operation.

## TypeScript consumer examples

```ts
const scope = await api.snapshotMirrorDeleteScope();
// scope: { scopeId: string; count: number }
const result = await api.mirrorDeleteAll(scope.scopeId);
// result: { removed: number; failed: { resourceId: number; path: string; error: string }[] }
```

For retries, retain and pass the same ID so the core retries only outstanding entries:

```ts
if (result.failed.length > 0) {
  const retry = await api.mirrorDeleteAll(scope.scopeId);
}
```

The zero-argument `api.mirrorDeleteAll()` overload continues to invoke `mirror_delete_all` and returns `Promise<MirrorStats>` for old Settings consumers. The scoped overload returns `Promise<MirrorDeleteResult>`. Errors propagate from Tauri unchanged: `MIRROR_DELETE_SCOPE_EXPIRED` means a renewed snapshot and confirmation are required; `MIRROR_DELETE_RECOVERY_PENDING` means outstanding cleanup must be retried before another snapshot can be retained.

## Semantics and limits

`removed` counts captured entries fully processed by this invocation, including idempotent missing-file entries. Outstanding entries appear only in `failed`. Normal scopes expire after ten minutes; recovery-bearing scopes remain reachable until resolved and cannot be evicted. Frontend callers provide only the opaque scope ID, never file paths.

Recovery metadata is process-local. A process restart loses the registry, so an old scope then returns `MIRROR_DELETE_SCOPE_EXPIRED` and requires renewed confirmation. This handoff makes no crash/restart durability claim.

## Proof

- `tests/mirrorDeletion-api.test.ts`: exact invoke command names/arguments, camelCase `scopeId`, numeric IDs/counts, partial result propagation, renewal/recovery errors, and the legacy zero-argument return shape.
- Focused API test passed before implementation (expected missing API failures) and after implementation (4/4 passed).
- Full frontend lint, tests and build plus native Windows `cargo check` are reported in the implementation completion record.

Coordinator review on 2026-11-16 found no wrapper defect: both command registrations and camelCase scopeId/DTO parity match core; each command holds the shared connection through the operation; zero-argument legacy callers retain their Stats return and scoped callers receive the deletion result. Four API contract tests, full 580 frontend tests, lint/build, and native Windows cargo check passed. These wrapper tests do not establish live native WebView delivery or crash/restart recovery. Settings14B must consume the scoped overload and explicit error/partial-result semantics.

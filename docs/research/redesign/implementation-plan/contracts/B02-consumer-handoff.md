# B02 consumer handoff

This handoff describes the accepted implementation at [`b6bef8a`](https://github.com/Akshay-VK/quanta-pulse/commit/b6bef8aaa8430dce0c8fb537478e3adecb236a5f), as reconciled with current frontend ordering fixes at repository HEAD [`3b1a67e`](https://github.com/Akshay-VK/quanta-pulse/commit/3b1a67ebd33a37966d4a88026d761c778e770d4a). It is a consumer contract, not a promise of native event-delivery certification.

## TypeScript surface

`src/lib/types.ts` exports:

```ts
interface MirrorDownloadProgress {
  resourceId: number;
  attemptId: string;
  state: "queued" | "downloading" | "failed" | "cancelled" | "saved";
  bytesDone: number;
  bytesTotal: number | null;
  error: string | null;
}
```

`src/lib/api.ts` exposes `mirrorDownloadProgress(): Promise<MirrorDownloadProgress[]>`, `cancelMirrorDownload(resourceId: number): Promise<void>`, and `retryMirrorDownload(resourceId: number): Promise<MirrorDownloadProgress>`. `ensureLocal(resourceId)` remains the on-demand ensure/start path. All Tauri invokes remain centralized in `api.ts`.

The Rust command `mirror_download_progress` is registered in `src-tauri/src/lib.rs`; the progress event name is `mirror:file-progress` and its payload uses the matching camelCase DTO. `bytesTotal: null` means indeterminate; consumers must not invent a percentage. `attemptId` is opaque: compare for equality only, never parse or order it.

## Consumer invariants

- For each `resourceId`, only publish progress whose `attemptId` matches the current attempt identity established by an authoritative progress snapshot or a successful retry response.
- An unfamiliar event is a reconciliation signal, not authority to replace the current identity. Fetch the progress snapshot and accept its identity. This covers queued stale events arriving before initial snapshot resolution.
- When a snapshot resolves after events, retain same-attempt event progress that advanced during the request, and retain a successfully returned retry attempt that superseded the snapshot. The hook tracks revisions to enforce this ordering.
- A new attempt replaces the prior identity. Ignore later progress from the prior attempt even if its state looks terminal or its byte count is larger.
- Keep download progress separate from indexed `LocalFileStatus` / disk truth. `failed` or `cancelled` does not prove that no valid saved copy exists; `saved` progress is not a substitute for resolving the indexed local file.
- Cancellation and retry API rejections propagate to callers. Do not optimistically fabricate a terminal progress update on cancellation.

## Evidence and limits

The accepted handoff records Windows `cargo check`, 198 Rust library tests, 19 mirror tests, four relay helper tests, and six hook regressions. The relay helper tests verify event naming/serialization, lag recovery, closure, and shutdown behavior. They do not prove actual native `AppHandle` event delivery. Native authentication, PDF rendering, macOS behavior, and live Quanta behavior are outside this handoff.

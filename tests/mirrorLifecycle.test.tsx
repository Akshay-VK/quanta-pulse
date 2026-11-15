import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  }),
}));
vi.mock("../src/lib/api", () => ({
  api: {
    mirrorStats: vi.fn(async () => ({ queued: 0, downloading: 0, done: 0, failed: 0, skipped: 0, kept: 0, totalResources: 0, bytesDone: 0, bytesTotal: 0, state: "idle", root: "", freeBytes: 0 })),
    mirrorLocalFiles: vi.fn(async () => []),
    mirrorDownloadProgress: vi.fn(async () => []),
    mirrorLocalFile: vi.fn(), ensureLocal: vi.fn(),
    mirrorStartBackfill: vi.fn(), mirrorPause: vi.fn(), mirrorResume: vi.fn(),
    mirrorRetryFailed: vi.fn(), mirrorVerifyFiles: vi.fn(), mirrorDeleteAll: vi.fn(),
    cancelMirrorDownload: vi.fn(), retryMirrorDownload: vi.fn(),
  },
}));

import { MirrorProvider, useMirror } from "../src/hooks/useMirror";
import { api } from "../src/lib/api";
import type { MirrorDownloadProgress } from "../src/lib/types";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useMirror>;

function Consumer() {
  latest = useMirror();
  return null;
}

function update(item: MirrorDownloadProgress) {
  listeners.get("mirror:file-progress")?.({ payload: item });
}

beforeEach(() => {
  listeners.clear();
  vi.mocked(api.mirrorDownloadProgress).mockReset().mockResolvedValue([]);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

async function mount() {
  await act(async () => { root.render(<MirrorProvider><Consumer /></MirrorProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("per-file download lifecycle", () => {
  it("reports observed bytes and rejects late progress from a replaced attempt", async () => {
    await mount();
    const current: MirrorDownloadProgress = { resourceId: 9, attemptId: "9-2", state: "downloading", bytesDone: 17, bytesTotal: null, error: null };
    vi.mocked(api.mirrorDownloadProgress).mockResolvedValue([current]);
    await act(async () => update(current));
    expect(latest?.downloads.get(9)).toEqual(current);

    await act(async () => update({ ...current, attemptId: "9-1", state: "saved", bytesDone: 100, bytesTotal: 100 }));
    expect(latest?.downloads.get(9)).toEqual(current);
  });

  it("lets the initial snapshot identify the current attempt after an early stale event", async () => {
    let resolveSnapshot!: (items: MirrorDownloadProgress[]) => void;
    const snapshot = new Promise<MirrorDownloadProgress[]>((resolve) => { resolveSnapshot = resolve; });
    vi.mocked(api.mirrorDownloadProgress).mockReturnValue(snapshot);
    await mount();
    const current: MirrorDownloadProgress = { resourceId: 9, attemptId: "9-2", state: "downloading", bytesDone: 17, bytesTotal: null, error: null };
    await act(async () => update({ ...current, attemptId: "9-1", state: "saved" }));
    await act(async () => resolveSnapshot([current]));
    expect(latest?.downloads.get(9)).toEqual(current);
  });

  it("discovers a new automatic attempt without accepting a late event from its predecessor", async () => {
    const previous: MirrorDownloadProgress = { resourceId: 9, attemptId: "9-1", state: "saved", bytesDone: 10, bytesTotal: 10, error: null };
    vi.mocked(api.mirrorDownloadProgress).mockResolvedValue([previous]);
    await mount();
    const current: MirrorDownloadProgress = { ...previous, attemptId: "9-2", state: "downloading", bytesDone: 3, bytesTotal: null };
    vi.mocked(api.mirrorDownloadProgress).mockResolvedValue([current]);
    await act(async () => update(current));
    expect(latest?.downloads.get(9)).toEqual(current);
    await act(async () => update(previous));
    expect(latest?.downloads.get(9)).toEqual(current);
  });

  it("keeps newer progress for the same attempt while its snapshot was pending", async () => {
    const current: MirrorDownloadProgress = { resourceId: 9, attemptId: "9-2", state: "downloading", bytesDone: 1, bytesTotal: null, error: null };
    vi.mocked(api.mirrorDownloadProgress).mockResolvedValue([current]);
    await mount();
    let resolveSnapshot!: (items: MirrorDownloadProgress[]) => void;
    vi.mocked(api.mirrorDownloadProgress).mockReturnValueOnce(new Promise((resolve) => { resolveSnapshot = resolve; }));
    let refresh!: Promise<void>;
    act(() => { refresh = latest!.refresh(); });
    const newer = { ...current, bytesDone: 17 };
    await act(async () => update(newer));
    await act(async () => { resolveSnapshot([current]); await refresh; });
    expect(latest?.downloads.get(9)).toEqual(newer);
  });

  it("keeps a completed retry's identity when an older snapshot arrives afterward", async () => {
    const previous: MirrorDownloadProgress = { resourceId: 9, attemptId: "9-1", state: "failed", bytesDone: 1, bytesTotal: null, error: "network" };
    vi.mocked(api.mirrorDownloadProgress).mockResolvedValue([previous]);
    await mount();
    let resolveSnapshot!: (items: MirrorDownloadProgress[]) => void;
    vi.mocked(api.mirrorDownloadProgress).mockReturnValueOnce(new Promise((resolve) => { resolveSnapshot = resolve; }));
    let refresh!: Promise<void>;
    act(() => { refresh = latest!.refresh(); });
    const next: MirrorDownloadProgress = { ...previous, attemptId: "9-2", state: "queued", error: null };
    vi.mocked(api.retryMirrorDownload).mockResolvedValueOnce(next);
    await act(async () => { await latest!.retryDownload(9); });
    await act(async () => { resolveSnapshot([previous]); await refresh; });
    expect(latest?.downloads.get(9)).toEqual(next);
  });

  it("propagates failed cancel and retry requests without inventing progress", async () => {
    const current: MirrorDownloadProgress = { resourceId: 9, attemptId: "9-2", state: "downloading", bytesDone: 1, bytesTotal: null, error: null };
    vi.mocked(api.mirrorDownloadProgress).mockResolvedValue([current]);
    await mount();
    vi.mocked(api.cancelMirrorDownload).mockRejectedValueOnce(new Error("Cancel failed"));
    vi.mocked(api.retryMirrorDownload).mockRejectedValueOnce(new Error("Retry failed"));
    await expect(latest!.cancelDownload(9)).rejects.toThrow("Cancel failed");
    await expect(latest!.retryDownload(9)).rejects.toThrow("Retry failed");
    expect(latest?.downloads.get(9)).toEqual(current);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { api } from "../src/lib/api";
import type { MirrorStats } from "../src/lib/types";

describe("scoped mirror deletion command contracts", () => {
  beforeEach(() => invoke.mockReset());

  it("snapshots a frozen scope with a camelCase string ID and numeric count", async () => {
    const scope = { scopeId: "scope-123", count: 1205 };
    invoke.mockResolvedValueOnce(scope);

    const result = await api.snapshotMirrorDeleteScope();
    expect(result).toEqual(scope);
    expect(typeof result.scopeId).toBe("string");
    expect(typeof result.count).toBe("number");
    expect(invoke).toHaveBeenCalledWith("snapshot_mirror_delete_scope");
  });

  it("retries exactly the frozen ID and returns partial work with numeric resource IDs", async () => {
    const result = {
      removed: 2,
      failed: [{ resourceId: 1205, path: "course/file.pdf", error: "Access denied" }],
    };
    invoke.mockResolvedValueOnce(result);
    invoke.mockResolvedValueOnce({ removed: 1, failed: [] });

    const actual = await api.mirrorDeleteAll("scope-123");
    expect(actual).toEqual(result);
    expect(typeof actual.failed[0].resourceId).toBe("number");
    expect(invoke).toHaveBeenCalledWith("mirror_delete_scope", { scopeId: "scope-123" });

    await expect(api.mirrorDeleteAll("scope-123")).resolves.toEqual({ removed: 1, failed: [] });
    expect(invoke).toHaveBeenLastCalledWith("mirror_delete_scope", { scopeId: "scope-123" });
  });

  it("propagates expired-scope and pending-recovery errors for caller renewal/retry", async () => {
    invoke.mockRejectedValueOnce(new Error("MIRROR_DELETE_SCOPE_EXPIRED"));
    await expect(api.mirrorDeleteAll("expired-id")).rejects.toThrow("MIRROR_DELETE_SCOPE_EXPIRED");
    expect(invoke).toHaveBeenLastCalledWith("mirror_delete_scope", { scopeId: "expired-id" });

    invoke.mockRejectedValueOnce(new Error("MIRROR_DELETE_RECOVERY_PENDING"));
    await expect(api.snapshotMirrorDeleteScope()).rejects.toThrow("MIRROR_DELETE_RECOVERY_PENDING");
    expect(invoke).toHaveBeenLastCalledWith("snapshot_mirror_delete_scope");
  });

  it("preserves the zero-argument legacy command and its MirrorStats return shape", async () => {
    const stats: MirrorStats = {
      queued: 0, downloading: 0, done: 1, failed: 0, skipped: 0, kept: 0,
      totalResources: 1, bytesDone: 10, bytesTotal: 10, state: "idle", root: "mirror", freeBytes: 100,
    };
    invoke.mockResolvedValueOnce(stats);

    const actual: Promise<MirrorStats> = api.mirrorDeleteAll();
    await expect(actual).resolves.toEqual(stats);
    expect(invoke).toHaveBeenCalledWith("mirror_delete_all");
  });
});

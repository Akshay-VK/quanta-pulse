import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { api } from "../src/lib/api";

describe("frozen History deletion command contracts", () => {
  beforeEach(() => invoke.mockClear());

  it("captures the selected authoritative event and scan IDs", async () => {
    const scope = { eventIds: [1, 2, 1205], scanIds: [4, 1205] };
    invoke.mockResolvedValueOnce(scope);
    await expect(api.snapshotHistoryDeletion(true)).resolves.toEqual(scope);
    expect(invoke).toHaveBeenLastCalledWith("snapshot_history_deletion", { includeScans: true });
  });

  it("applies only the previously captured scope and returns actual counts", async () => {
    const scope = { eventIds: [1, 2], scanIds: [] };
    const result = { eventsDeleted: 2, scansDeleted: 0 };
    invoke.mockResolvedValueOnce(result);
    await expect(api.deleteHistorySnapshot(scope)).resolves.toEqual(result);
    expect(invoke).toHaveBeenLastCalledWith("delete_history_snapshot", { scope });
  });

  it("propagates renewed-confirmation errors without changing the legacy wrapper", async () => {
    invoke.mockRejectedValueOnce(new Error("HISTORY_SCOPE_CHANGED"));
    await expect(api.deleteHistorySnapshot({ eventIds: [1], scanIds: [] })).rejects.toThrow("HISTORY_SCOPE_CHANGED");
    await api.deleteHistory(true);
    expect(invoke).toHaveBeenLastCalledWith("delete_history", { includeScans: true });
  });
});

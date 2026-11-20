import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { api } from "../src/lib/api";

describe("History query command contracts", () => {
  beforeEach(() => invoke.mockClear());

  it("passes all History filters and explicit pagination unchanged", async () => {
    const filter = {
      changeType: "updated" as const,
      courseId: 4,
      since: "2026-11-01T00:00:00Z",
      until: "2026-12-01T00:00:00Z",
      search: "lecture",
      offset: 1000,
      limit: 100,
    };
    await api.queryHistoryEvents(filter);
    expect(invoke).toHaveBeenLastCalledWith("query_history_events", { filter });
  });

  it("passes explicit scan pagination and preserves the page DTO", async () => {
    const page = { items: [], total: 612 };
    const filter = { offset: 500, limit: 50 };
    invoke.mockResolvedValueOnce(page);
    await expect(api.queryHistoryScans(filter)).resolves.toEqual(page);
    expect(invoke).toHaveBeenLastCalledWith("query_history_scans", { filter });
  });

  it("requests the complete resource unread snapshot independently", async () => {
    invoke.mockResolvedValueOnce([8, 9, 1204]);
    await expect(api.snapshotResourceUnreadEventIds(23)).resolves.toEqual([8, 9, 1204]);
    expect(invoke).toHaveBeenLastCalledWith("snapshot_resource_unread_event_ids", { resourceId: 23 });
  });
});

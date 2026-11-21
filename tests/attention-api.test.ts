import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { api } from "../src/lib/api";

describe("attention command contracts", () => {
  beforeEach(() => invoke.mockClear());
  it("passes independent filters and complete-snapshot requests unchanged", async () => {
    const filter = { courseId: 3, attention: "unread" as const, changeType: "announcement" as const, search: "quiz", offset: 100, limit: 50 };
    await api.queryInbox(filter);
    expect(invoke).toHaveBeenLastCalledWith("query_inbox", { filter });
    await api.snapshotInboxEventIds(filter);
    expect(invoke).toHaveBeenLastCalledWith("snapshot_inbox_event_ids", { filter });
  });
  it("sends explicit desired read state and captured IDs; preserves legacy callers", async () => {
    await api.setEventReadState([12, 15], false);
    expect(invoke).toHaveBeenLastCalledWith("set_event_read_state", { eventIds: [12, 15], desiredRead: false });
    await api.markRead([12]);
    expect(invoke).toHaveBeenLastCalledWith("mark_read", { ids: [12] });
    await api.dismissInboxEvents([12, 15]);
    expect(invoke).toHaveBeenLastCalledWith("dismiss_inbox_events", { eventIds: [12, 15] });
    await api.deleteHistory(false);
    expect(invoke).toHaveBeenLastCalledWith("delete_history", { includeScans: false });
  });
  it("queries the due inventory and propagates failures", async () => {
    const filter = { from: "2026-11-15", until: "2026-11-22", courseId: 2, offset: 2000 };
    await api.queryDueResources(filter);
    expect(invoke).toHaveBeenLastCalledWith("query_due_resources", { filter });
    invoke.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(api.setEventReadState([12], true)).rejects.toThrow("database unavailable");
  });
});

it('requests the complete atomic desktop inventory without offsets or limits', async () => {
  const snapshot = { courses: [], resources: [], unreadResourceIds: [2501] };
  invoke.mockResolvedValueOnce(snapshot);
  await expect(api.listSearchInventory()).resolves.toBe(snapshot);
  expect(invoke).toHaveBeenLastCalledWith('list_search_inventory');
  invoke.mockRejectedValueOnce(new Error('snapshot failed'));
  await expect(api.listSearchInventory()).rejects.toThrow('snapshot failed');
});

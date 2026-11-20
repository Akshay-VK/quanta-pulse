import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { api } from "../src/lib/api";

describe("eventsRange paging wire contract", () => {
  beforeEach(() => invoke.mockReset());

  it("defaults omitted bounds, course, limit and offset", async () => {
    await api.eventsRange();
    expect(invoke).toHaveBeenLastCalledWith("events_range", {
      from: null, to: null, courseId: null, limit: 2000, offset: 0,
    });
  });

  it("keeps four-argument callers and custom limits compatible", async () => {
    await api.eventsRange("2026-11-01", "2026-11-16", 7, 123);
    expect(invoke).toHaveBeenLastCalledWith("events_range", {
      from: "2026-11-01", to: "2026-11-16", courseId: 7, limit: 123, offset: 0,
    });
  });

  it.each([0, 2000, -12])("forwards explicit offset %s without normalization", async (offset) => {
    await api.eventsRange(undefined, undefined, undefined, undefined, offset);
    expect(invoke).toHaveBeenLastCalledWith("events_range", {
      from: null, to: null, courseId: null, limit: 2000, offset,
    });
  });

  it("preserves explicit custom limit and returns the same vector", async () => {
    const rows = [{ id: 19 }, { id: 18 }];
    invoke.mockResolvedValueOnce(rows);
    await expect(api.eventsRange(undefined, "2026-11-16", 7, 5000, 5000)).resolves.toBe(rows);
    expect(invoke).toHaveBeenLastCalledWith("events_range", {
      from: null, to: "2026-11-16", courseId: 7, limit: 5000, offset: 5000,
    });
  });

  it("propagates the original string rejection", async () => {
    const error = "Invalid date (expected YYYY-MM-DD).";
    invoke.mockRejectedValueOnce(error);
    await expect(api.eventsRange("invalid")).rejects.toBe(error);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { queryHistoryInventory } from "../src/lib/historyInventory";
import type { HistoryPage } from "../src/lib/types";
import { change } from "./helpers/data";

afterEach(() => vi.restoreAllMocks());

function inventory(size: number) {
  return Array.from({ length: size }, (_, i) => change({ id: size - i }));
}

function serve(items: HistoryPage["items"]) {
  return vi.spyOn(api, "queryHistoryEvents").mockImplementation(async ({ offset, limit }) => ({
    items: items.slice(offset, offset + limit), total: items.length,
  }));
}

describe("queryHistoryInventory", () => {
  it("collects more than 1000 unfiltered events in backend order, including siblings, baseline and orphans", async () => {
    const items = inventory(1003);
    items[0] = change({ id: 1003, resourceId: null });
    items[1] = change({ id: 1002, changeType: "baseline" });
    // Treat the supplied backend order as authoritative, even across pages.
    [items[2], items[1002]] = [items[1002], items[2]];
    const query = serve(items);
    const legacy = vi.spyOn(api, "listHistoryEvents");
    await expect(queryHistoryInventory()).resolves.toEqual(items);
    expect(query.mock.calls).toEqual([[{ offset: 0, limit: 1000 }], [{ offset: 1000, limit: 1000 }]]);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("checks an extra empty page after an exact multiple", async () => {
    const items = inventory(2000);
    const query = serve(items);
    await expect(queryHistoryInventory()).resolves.toEqual(items);
    expect(query.mock.calls).toEqual([0, 1000, 2000].map(offset => [{ offset, limit: 1000 }]));
  });

  it("accepts an empty inventory", async () => {
    const query = serve([]);
    await expect(queryHistoryInventory()).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each(["within a page", "across pages"])("rejects duplicate IDs %s without publishing a partial scope", async location => {
    const items = inventory(1001);
    items[location === "within a page" ? 1 : 1000] = items[0];
    const query = serve(items);
    await expect(queryHistoryInventory()).rejects.toThrow(/History inventory incomplete.*duplicate/i);
    expect(query).toHaveBeenCalledTimes(location === "within a page" ? 1 : 2);
  });

  it("rejects total drift even on the terminal page", async () => {
    const query = vi.spyOn(api, "queryHistoryEvents")
      .mockResolvedValueOnce({ items: inventory(1000), total: 1000 })
      .mockResolvedValueOnce({ items: [], total: 1001 });
    await expect(queryHistoryInventory()).rejects.toThrow(/History inventory incomplete.*total changed/i);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1])("rejects a premature terminal page of %i items", async size => {
    const query = vi.spyOn(api, "queryHistoryEvents")
      .mockResolvedValueOnce({ items: inventory(1000), total: 1002 })
      .mockResolvedValueOnce({ items: size ? [change({ id: 1001 })] : [], total: 1002 });
    await expect(queryHistoryInventory()).rejects.toThrow(/History inventory incomplete.*before total/i);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid total %s", async total => {
    vi.spyOn(api, "queryHistoryEvents").mockResolvedValue({ items: [], total });
    await expect(queryHistoryInventory()).rejects.toThrow(/History inventory incomplete.*total/i);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid event ID %s", async id => {
    serve([change({ id })]);
    await expect(queryHistoryInventory()).rejects.toThrow(/History inventory incomplete.*ID/i);
  });

  it.each([
    null, { items: null, total: 0 }, { items: {}, total: 0 },
    { items: [null], total: 1 }, { items: inventory(1001), total: 1001 },
    { items: [change()], total: 0 },
  ])("rejects malformed or overflowing pages %#", async page => {
    vi.spyOn(api, "queryHistoryEvents").mockResolvedValue(page as HistoryPage);
    await expect(queryHistoryInventory()).rejects.toThrow(/History inventory incomplete/i);
  });

  it("rejects a later API failure without returning accumulated events or falling back", async () => {
    const failure = new Error("offline");
    vi.spyOn(api, "queryHistoryEvents")
      .mockResolvedValueOnce({ items: inventory(1000), total: 1001 })
      .mockRejectedValueOnce(failure);
    const legacy = vi.spyOn(api, "listHistoryEvents");
    await expect(queryHistoryInventory()).rejects.toBe(failure);
    expect(legacy).not.toHaveBeenCalled();
  });
});

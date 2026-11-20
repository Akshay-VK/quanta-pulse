import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { queryCourseActivityInventory } from "../src/lib/courseActivityInventory";
import type { ChangeEvent } from "../src/lib/types";
import { change } from "./helpers/data";

const rows = (size: number) => Array.from({ length: size }, (_, i) => change({ id: size - i, courseId: 7 }));
function serve(items: ChangeEvent[]) {
  return vi.spyOn(api, "eventsRange").mockImplementation(async (_from, _to, _course, limit, offset) => items.slice(offset, (offset ?? 0) + (limit ?? 2000)));
}
afterEach(() => vi.restoreAllMocks());

describe("course Activity range inventory", () => {
  it.each([2001, 6001, 4000, 0])("collects %i rows in raw backend order, including terminal empty pages", async size => {
    const items = rows(size);
    if (size) {
      items[0] = change({ id: size, courseId: 7, resourceId: null, changeType: "baseline", read: true });
      // Backend membership is authoritative: read/dismissed/History-cleared events
      // need no client filtering, and raw timestamp order need not be instant order.
      items[1] = change({ id: size - 1, courseId: 7, read: true, detectedAt: "2026-01-01T00:00:00.1Z" });
      [items[2], items[size - 1]] = [items[size - 1], items[2]];
    }
    const query = serve(items);
    const history = vi.spyOn(api, "queryHistoryEvents");
    const result = await queryCourseActivityInventory(7);
    expect(result).toEqual(items);
    result.forEach((event, i) => expect(event).toBe(items[i]));
    expect(query.mock.calls).toEqual(Array.from({ length: Math.floor(size / 2000) + 1 }, (_, i) => [undefined, undefined, 7, 2000, i * 2000]));
    expect(history).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects course %s without querying", async id => {
    const query = serve([]);
    await expect(queryCourseActivityInventory(id)).rejects.toThrow(/course/i);
    expect(query).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects event ID %s", async id => {
    serve([change({ id, courseId: 7 })]);
    await expect(queryCourseActivityInventory(7)).rejects.toThrow(/event ID/i);
  });
  it.each([null, 8, 0])("rejects cross-course identity %s", async courseId => {
    serve([change({ courseId })]);
    await expect(queryCourseActivityInventory(7)).rejects.toThrow(/course/i);
  });
  it.each([null, {}, [null], rows(2001)])("rejects malformed/oversized page %#", async page => {
    vi.spyOn(api, "eventsRange").mockResolvedValue(page as ChangeEvent[]);
    await expect(queryCourseActivityInventory(7)).rejects.toThrow(/invalid page|event ID/i);
  });
  it.each([1, 2000])("rejects duplicate IDs at index %i", async index => {
    const items = rows(2001);
    items[index] = items[0];
    serve(items);
    await expect(queryCourseActivityInventory(7)).rejects.toThrow(/duplicate/i);
  });
  it("rejects a later API failure without returning partial rows", async () => {
    const failure = new Error("offline");
    vi.spyOn(api, "eventsRange").mockResolvedValueOnce(rows(2000)).mockRejectedValueOnce(failure);
    await expect(queryCourseActivityInventory(7)).rejects.toBe(failure);
  });
});

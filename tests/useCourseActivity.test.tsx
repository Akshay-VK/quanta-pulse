import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import type { ChangeEvent } from "../src/lib/types";
import { useCourseActivity } from "../src/hooks/useCourseActivity";
import { change } from "./helpers/data";

function deferred() {
  let resolve!: (rows: ChangeEvent[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ChangeEvent[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root | undefined;
let container: HTMLDivElement;
let state: ReturnType<typeof useCourseActivity>;
function Harness({ courseId }: { courseId: number | null }) { state = useCourseActivity(courseId); return null; }
async function render(courseId: number | null) {
  if (!root) {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => { root!.render(<Harness courseId={courseId} />); });
}
async function settle(job: ReturnType<typeof deferred>, value: ChangeEvent[] | Error) {
  await act(async () => { if (value instanceof Error) job.reject(value); else job.resolve(value); });
}
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; container?.remove(); vi.restoreAllMocks(); });

describe("course Activity owner", () => {
  it("publishes only the completed actual multi-page traversal, and starts no query on ordinary rerender", async () => {
    const terminal = deferred();
    const items = Array.from({ length: 2000 }, (_, i) => change({ id: i + 1, courseId: 7 }));
    const query = vi.spyOn(api, "eventsRange").mockResolvedValueOnce(items).mockReturnValueOnce(terminal.promise);
    await render(7);
    expect(state).toMatchObject({ items: undefined, courseId: undefined, pending: true, error: null, scopeReady: false });
    await settle(terminal, []);
    expect(state).toMatchObject({ items, courseId: 7, pending: false, error: null, scopeReady: true });
    await render(7);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("retains rows/owner on refresh failure and rejects; retry clears error only on success", async () => {
    const items = [change({ courseId: 7 })];
    const query = vi.spyOn(api, "eventsRange").mockResolvedValueOnce(items);
    await render(7);
    const job = deferred(); query.mockReturnValueOnce(job.promise);
    let completion!: Promise<unknown>;
    act(() => { completion = state.refresh().catch(error => error); });
    expect(state).toMatchObject({ items, courseId: 7, pending: true, scopeReady: false });
    await settle(job, new Error("offline"));
    expect(await completion).toEqual(new Error("offline"));
    expect(state).toMatchObject({ items, courseId: 7, pending: false, error: "Error: offline", scopeReady: false });
    query.mockResolvedValueOnce([]);
    await act(async () => { await state.refresh(); });
    expect(state).toMatchObject({ items: [], courseId: 7, error: null, scopeReady: true });
  });
  it.each(["success", "error"])("ignores stale course %s and retains the previous owner while switching", async outcome => {
    const items = [change({ courseId: 7 })];
    const query = vi.spyOn(api, "eventsRange").mockResolvedValueOnce(items);
    await render(7);
    const old = deferred(); query.mockReturnValueOnce(old.promise);
    let completion!: Promise<unknown>;
    act(() => { completion = state.refresh().catch(error => error); });
    const next = deferred(); query.mockReturnValueOnce(next.promise);
    await render(8);
    expect(state).toMatchObject({ items, courseId: 7, pending: true, scopeReady: false });
    await settle(old, outcome === "success" ? [] : new Error("old error"));
    expect(await completion).toEqual(expect.objectContaining({ message: expect.stringMatching(/superseded/i) }));
    expect(state).toMatchObject({ items, courseId: 7, pending: true, error: null, scopeReady: false });
    await settle(next, new Error("course 8 failed"));
    expect(state).toMatchObject({ items, courseId: 7, pending: false, scopeReady: false });
  });
  it("rejects superseded refresh success without unlocking or overwriting the newer request", async () => {
    const query = vi.spyOn(api, "eventsRange").mockResolvedValueOnce([]);
    await render(7);
    const old = deferred(), next = deferred();
    query.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    let first!: Promise<unknown>, second!: Promise<void>;
    act(() => { first = state.refresh().catch(error => error); second = state.refresh(); });
    await settle(old, [change({ courseId: 7 })]);
    expect(await first).toEqual(expect.objectContaining({ message: expect.stringMatching(/superseded/i) }));
    expect(state.pending).toBe(true);
    await settle(next, []);
    await second;
    expect(state).toMatchObject({ items: [], pending: false, scopeReady: true });
  });
  it.each(["success", "error"])("keeps a newer publication when an obsolete initial load settles with %s", async outcome => {
    const old = deferred(), next = deferred();
    const query = vi.spyOn(api, "eventsRange").mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await render(7);
    await render(8);
    const items = [change({ id: 88, courseId: 8 })];
    await settle(next, items);
    expect(state).toMatchObject({ items, courseId: 8, pending: false, error: null, scopeReady: true });
    await settle(old, outcome === "success" ? [change({ courseId: 7 })] : new Error("old failure"));
    expect(state).toMatchObject({ items, courseId: 8, pending: false, error: null, scopeReady: true });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("inactive course never queries; deactivation retains rows but disables readiness and stale callbacks", async () => {
    const query = vi.spyOn(api, "eventsRange").mockResolvedValue([]);
    await render(null);
    expect(state.scopeReady).toBe(false);
    await expect(state.refresh()).rejects.toThrow(/inactive/i);
    expect(query).not.toHaveBeenCalled();
    await render(7);
    const oldRefresh = state.refresh;
    await render(null);
    expect(state).toMatchObject({ items: [], courseId: 7, pending: false, scopeReady: false });
    await expect(oldRefresh()).rejects.toThrow(/superseded/i);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each(["success", "error"])("rejects pending refresh %s after unmount", async outcome => {
    const query = vi.spyOn(api, "eventsRange").mockResolvedValueOnce([]);
    await render(7);
    const job = deferred(); query.mockReturnValueOnce(job.promise);
    let completion!: Promise<unknown>;
    act(() => { completion = state.refresh().catch(error => error); });
    act(() => root!.unmount()); root = undefined;
    await settle(job, outcome === "success" ? [] : new Error("offline"));
    expect(await completion).toEqual(expect.objectContaining({ message: expect.stringMatching(/superseded/i) }));
  });
});

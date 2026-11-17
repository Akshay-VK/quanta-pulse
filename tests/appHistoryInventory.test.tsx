import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryViewProps } from "../src/views/HistoryView";
import type { ChangeEvent, HistoryPage } from "../src/lib/types";
import { appApi, button, change, deferred, emitAppEvent, flushApp, renderApp, setupApp } from "./helpers/renderApp";

// The 1001-event pagination scenarios render the real App under jsdom; the
// default 5s limit trips on loaded CI even though the assertions pass alone.
vi.setConfig({ testTimeout: 30000 });

// Observe App's real boundary without replacing History rendering or behavior.
const history = vi.hoisted(() => ({ current: undefined as HistoryViewProps | undefined }));
vi.mock("../src/views/HistoryView", async (importOriginal) => {
  const { default: HistoryView } = await importOriginal<typeof import("../src/views/HistoryView")>();
  return { default: (props: HistoryViewProps) => {
    history.current = props;
    return <HistoryView {...props} />;
  } };
});

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => { setupApp(); history.current = undefined; });
afterEach(() => app?.unmount());

function props() {
  if (!history.current) throw new Error("History has not rendered");
  return history.current;
}
function rows(count: number, start = 100) {
  return Array.from({ length: count }, (_, index) => change({
    id: start + index, resourceId: null, resourceTitle: `Recorded event ${start + index}`,
  }));
}
function page(items: ChangeEvent[], total = items.length) { return { items, total }; }
async function openHistory() {
  app = await renderApp();
  await emitAppEvent("ui:navigate", "history");
}
async function requiredRefresh() {
  await act(async () => { await props().onChanged!(); });
  await flushApp();
}

// Legacy listing is fixture input only in renderApp. These overrides exercise
// App -> production queryHistoryInventory -> paged API, never that fixture path.
describe("App History inventory publication", () => {
  it.each([1001, 1000])("publishes all %i events in backend order, including the terminal page", async (count) => {
    const inventory = rows(count).reverse();
    appApi.queryHistoryEvents.mockImplementation(async ({ offset, limit }) => page(inventory.slice(offset, offset + limit), count));
    await openHistory();
    expect(props().events).toEqual(inventory);
    expect(props().eventScopeReady).toBe(true);
    expect(button(`Show details for ${inventory[inventory.length - 1].resourceTitle}`).isConnected).toBe(true);
    expect(appApi.queryHistoryEvents.mock.calls).toEqual([
      [{ offset: 0, limit: 1000 }], [{ offset: 1000, limit: 1000 }],
    ]);
    expect(appApi.listHistoryEvents).not.toHaveBeenCalled();
  });

  it("retains previous rows and clears readiness until the final page completes", async () => {
    await openHistory();
    const previous = props().events;
    const inventory = rows(1001);
    const last = deferred<HistoryPage>();
    appApi.queryHistoryEvents.mockResolvedValueOnce(page(inventory.slice(0, 1000), 1001)).mockReturnValueOnce(last.promise);
    await emitAppEvent("sync:done", {});
    expect(props().events).toBe(previous);
    expect(props().eventScopeReady).toBe(false);
    expect(props().loading).toBe(true);
    expect(button("Show details for Lecture 4").isConnected).toBe(true);
    expect(document.body.textContent).not.toContain("Recorded event 100");
    await act(async () => { last.resolve(page(inventory.slice(1000), 1001)); });
    await flushApp();
    expect(props().events).toEqual(inventory);
    expect(props().eventScopeReady).toBe(true);
    expect(props().loading).toBe(false);
  });

  it("waits for collection refresh before publishing a completed History inventory", async () => {
    await openHistory();
    const previous = props().events;
    const pending = deferred<Awaited<ReturnType<typeof appApi.queryInbox>>>();
    appApi.queryInbox.mockReturnValueOnce(pending.promise);
    appApi.queryHistoryEvents.mockResolvedValue(page(rows(1)));
    await emitAppEvent("sync:done", {});
    expect(props().events).toBe(previous);
    expect(props().eventScopeReady).toBe(false);
    await act(async () => { pending.resolve({ items: [], total: 0, unreadTotal: 0, courseCounts: [] }); });
    await flushApp();
    expect(props().events).toEqual(rows(1));
    expect(props().eventScopeReady).toBe(true);
  });

  it.each(["failure", "malformed", "duplicate"] as const)("rejects a later-page %s, retains rows and recovers on retry", async (kind) => {
    await openHistory();
    const previous = props().events;
    const inventory = rows(1001);
    appApi.queryHistoryEvents.mockResolvedValueOnce(page(inventory.slice(0, 1000), 1001));
    if (kind === "failure") appApi.queryHistoryEvents.mockRejectedValueOnce(new Error("second page unavailable"));
    else if (kind === "malformed") appApi.queryHistoryEvents.mockResolvedValueOnce({ items: null, total: 1001 } as unknown as HistoryPage);
    else appApi.queryHistoryEvents.mockResolvedValueOnce(page([inventory[0]], 1001));
    await emitAppEvent("sync:done", {});
    expect(props().events).toBe(previous);
    expect(props().eventScopeReady).toBe(false);
    expect(props().loading).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(kind === "failure" ? "second page unavailable" : "History inventory incomplete");
    expect(button("Show details for Lecture 4").isConnected).toBe(true);
    appApi.queryHistoryEvents.mockResolvedValue(page(rows(1)));
    await requiredRefresh();
    expect(props().error).toBeNull();
    expect(props().eventScopeReady).toBe(true);
    expect(props().events).toEqual(rows(1));
    expect(appApi.listHistoryEvents).toHaveBeenCalledTimes(1); // Initial fixture only.
  });

  it.each(["success", "failure"] as const)("ignores stale %s after the latest generation publishes", async (outcome) => {
    await openHistory();
    const stale = deferred<HistoryPage>();
    appApi.queryHistoryEvents.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page(rows(1, 9000)));
    await emitAppEvent("sync:done", {});
    expect(props().eventScopeReady).toBe(false);
    await emitAppEvent("sync:done", {});
    expect(props().events).toEqual(rows(1, 9000));
    expect(props().eventScopeReady).toBe(true);
    await act(async () => {
      if (outcome === "success") stale.resolve(page(rows(1, 8000)));
      else stale.reject(new Error("obsolete failure"));
    });
    await flushApp();
    expect(props().events).toEqual(rows(1, 9000));
    expect(props().eventScopeReady).toBe(true);
    expect(props().error).toBeNull();
    expect(props().loading).toBe(false);
  });

  it("keeps readiness false when an older completion arrives during the current request", async () => {
    await openHistory();
    const previous = props().events;
    const older = deferred<HistoryPage>();
    const current = deferred<HistoryPage>();
    appApi.queryHistoryEvents.mockReturnValueOnce(older.promise).mockReturnValueOnce(current.promise);
    await emitAppEvent("sync:done", {});
    await emitAppEvent("sync:done", {});
    await act(async () => { older.resolve(page(rows(1, 8000))); });
    await flushApp();
    expect(props().events).toBe(previous);
    expect(props().eventScopeReady).toBe(false);
    expect(props().loading).toBe(true);
    await act(async () => { current.resolve(page(rows(1, 9000))); });
    await flushApp();
    expect(props().events).toEqual(rows(1, 9000));
    expect(props().eventScopeReady).toBe(true);
  });
});

describe("App History executor and required-refresh contracts", () => {
  it.each([true, false])("passes exact IDs and read=%s using a cloned array", async (read) => {
    await openHistory();
    const ids = [31, 7, 404];
    await props().onSetEventReadState!(ids, read);
    expect(appApi.setEventReadState.mock.calls).toEqual([[ids, read]]);
    expect(appApi.setEventReadState.mock.calls[0][0]).not.toBe(ids);
    expect(appApi.queryHistoryEvents).toHaveBeenCalledTimes(1);
  });

  it("passes exact dismiss IDs using a cloned array", async () => {
    await openHistory();
    const ids = [31, 7, 404];
    await props().onDismissEvents!(ids);
    expect(appApi.dismissInboxEvents.mock.calls).toEqual([[ids]]);
    expect(appApi.dismissInboxEvents.mock.calls[0][0]).not.toBe(ids);
    expect(appApi.queryHistoryEvents).toHaveBeenCalledTimes(1);
  });

  it.each(["read", "dismiss"] as const)("propagates the original %s API rejection", async (kind) => {
    await openHistory();
    const failure = new Error("write refused");
    if (kind === "read") appApi.setEventReadState.mockRejectedValueOnce(failure);
    else appApi.dismissInboxEvents.mockRejectedValueOnce(failure);
    await expect(kind === "read" ? props().onSetEventReadState!([10], true) : props().onDismissEvents!([10])).rejects.toBe(failure);
    expect(appApi.queryHistoryEvents).toHaveBeenCalledTimes(1);
  });

  it.each(["history", "resources", "courses", "scans", "database"] as const)("rejects required refresh on %s load failure", async (source) => {
    await openHistory();
    const previous = props().events;
    const failure = new Error(`${source} unavailable`);
    const query = { history: appApi.queryHistoryEvents, resources: appApi.listResources, courses: appApi.listCourses, scans: appApi.listHistoryScans, database: appApi.dbInfo }[source];
    query.mockRejectedValueOnce(failure);
    await act(async () => { await expect(props().onChanged!()).rejects.toBe(failure); });
    expect(props().events).toBe(previous);
    expect(props().eventScopeReady).toBe(false);
    expect(props().error).toContain(`${source} unavailable`);
  });

  it("rejects superseded required refresh without disturbing the latest published state", async () => {
    await openHistory();
    const older = deferred<HistoryPage>();
    appApi.queryHistoryEvents.mockReturnValueOnce(older.promise).mockResolvedValueOnce(page(rows(1, 9000)));
    let result!: Promise<unknown>;
    await act(async () => { result = props().onChanged!().then(() => "resolved", (error: unknown) => error); });
    await emitAppEvent("sync:done", {});
    await act(async () => { older.resolve(page(rows(1, 8000))); });
    expect(await result).toEqual(new Error("History refresh superseded; retry refresh."));
    expect(props().events).toEqual(rows(1, 9000));
    expect(props().eventScopeReady).toBe(true);
    expect(props().error).toBeNull();
  });

  it.each(["read", "dismiss"] as const)("does not replay a successful %s write when refresh fails then retries", async (kind) => {
    await openHistory();
    if (kind === "read") await props().onSetEventReadState!([10], true);
    else await props().onDismissEvents!([10]);
    appApi.queryHistoryEvents.mockRejectedValueOnce(new Error("reload failed"));
    await act(async () => { await expect(props().onChanged!()).rejects.toThrow("reload failed"); });
    await requiredRefresh();
    expect(appApi.setEventReadState).toHaveBeenCalledTimes(kind === "read" ? 1 : 0);
    expect(appApi.dismissInboxEvents).toHaveBeenCalledTimes(kind === "dismiss" ? 1 : 0);
    expect(props().eventScopeReady).toBe(true);
  });
});

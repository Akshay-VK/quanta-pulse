import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, change, click, deferred, emitAppEvent, escape, flushApp, renderApp, setupApp } from "./helpers/renderApp";
import type { ChangeEvent } from "../src/lib/types";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());
let inventory: ChangeEvent[];
async function open(events = [change()]) {
  inventory = events;
  appApi.queryHistoryEvents.mockImplementation(async ({ offset, limit }) => ({ items: inventory.slice(offset, offset + limit), total: inventory.length }));
  app = await renderApp();
  await emitAppEvent("ui:navigate", "history");
}
async function key(key: string, target: HTMLElement = document.activeElement as HTMLElement, options: KeyboardEventInit = {}) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key === "/" ? "Slash" : key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...options })); });
  await flushApp();
}
function row(title = "Lecture 4") { return button(`Show details for ${title}`); }
function focus(title = "Lecture 4") { act(() => row(title).focus()); }

describe("actual App History Changes keyboard", () => {
  it("focuses the primary read confirmation action", async () => {
    await open(); focus(); await key("A", undefined, { shiftKey: true });
    expect(document.activeElement).toBe(button("Mark captured changes read"));
  });

  it("returns focus to the destination heading after History unmounts", async () => {
    await open(); focus(); await key("Enter");
    expect(document.querySelector(".peek")).not.toBeNull();
    await click(button("Inbox"));
    const heading = document.querySelector("main h1");
    expect(heading?.textContent).toBe("Inbox");
    expect(document.activeElement).toBe(heading);
  });

  it("separates event focus, selection and inspection without acknowledgement", async () => {
    await open([change(), change({ id: 2, title: "Sibling", resourceTitle: "Sibling" })]);
    focus(); await key("x"); await key("j");
    expect(document.activeElement).toBe(row("Sibling"));
    expect(row().closest(".resource-row")?.classList.contains("multi-selected")).toBe(true);
    expect(document.querySelector(".peek")).toBeNull();
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    await key("Enter");
    expect(document.querySelector(".peek-title")?.textContent).toBe("Sibling");
    await escape(); expect(document.activeElement).toBe(row("Sibling"));
  });

  it("captures selected event IDs independently of resource siblings, baseline and already-read state", async () => {
    await open([change({ id: 10, read: true }), change({ id: 11, resourceTitle: "Sibling" }), change({ id: 12, resourceId: null, resourceTitle: "Orphan" }), change({ id: 13, changeType: "baseline", resourceTitle: "Baseline" })]);
    focus(); await key("x"); focus("Orphan"); await key("x"); await key("u");
    expect(appApi.setEventReadState.mock.calls).toEqual([[[10, 12], false]]);
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
    focus(); await key("x"); focus("Orphan"); await key("x"); focus("Baseline"); await key("x"); focus("Sibling"); await key("e");
    expect(appApi.setEventReadState).toHaveBeenCalledTimes(1);
  });

  it.each([1000, 1001, 2000])("Shift+A captures complete %i-event paged inventory, excluding baseline", async (size) => {
    await open(Array.from({ length: size }, (_, i) => change({ id: i + 1, resourceTitle: `Event ${i}`, changeType: i === 0 ? "baseline" : "new" })));
    focus("Event 1"); await key("A", undefined, { shiftKey: true });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(`${size - 1} captured changes`);
    inventory = [...inventory, change({ id: size + 1 })]; await emitAppEvent("sync:done", {});
    await click(button("Mark captured changes read"));
    expect(appApi.setEventReadState.mock.calls).toEqual([[Array.from({ length: size - 1 }, (_, i) => i + 2), true]]);
    expect(appApi.queryHistoryEvents.mock.calls.some(([f]) => f.offset === Math.floor(size / 1000) * 1000)).toBe(true);
    expect(appApi.listHistoryEvents).not.toHaveBeenCalled();
  }, 120000);

  it("Delete confirms Inbox-only dismissal, Cancel returns event identity and retained History stays", async () => {
    await open(); focus(); await key("Delete");
    expect(document.activeElement).toBe(button("Cancel"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("History, resources, saved files and your baseline are kept.");
    await click(button("Cancel")); expect(document.activeElement).toBe(row());
    expect(appApi.dismissInboxEvents).not.toHaveBeenCalled();
    await key("Delete"); await click(button("Dismiss from Inbox"));
    expect(appApi.dismissInboxEvents.mock.calls).toEqual([[[10]]]);
    expect(row().isConnected).toBe(true);
    expect(appApi.deleteHistorySnapshot).not.toHaveBeenCalled();
    expect(appApi.clearHistoryActivity).not.toHaveBeenCalled();
    expect(appApi.mirrorDeleteAll).not.toHaveBeenCalled();
  });

  it("retries a failed mutation with original IDs and refresh failure with refresh only", async () => {
    await open(); appApi.setEventReadState.mockRejectedValueOnce(new Error("write failed"));
    focus(); await key("e");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("write failed");
    inventory.push(change({ id: 2, resourceTitle: "Arrival" })); await emitAppEvent("sync:done", {});
    appApi.queryHistoryEvents.mockRejectedValueOnce(new Error("refresh failed"));
    await click(button("Retry captured action"));
    expect(appApi.setEventReadState.mock.calls).toEqual([[[10], true], [[10], true]]);
    await click(button("Retry refresh"));
    expect(appApi.setEventReadState).toHaveBeenCalledTimes(2);
  });

  it("blocks duplicates and invalidates late rejection on tab change", async () => {
    await open(); const pending = deferred<void>(); appApi.setEventReadState.mockReturnValueOnce(pending.promise);
    focus(); await key("e"); await key("u"); expect(appApi.setEventReadState).toHaveBeenCalledTimes(1);
    await click(button("Scan history")); await act(async () => pending.reject(new Error("stale")));
    await click(button("Activity")); expect(document.body.textContent).not.toContain("stale");
    focus(); await key("u"); expect(appApi.setEventReadState).toHaveBeenCalledTimes(2);
  });

  it("retains inspection/navigation but blocks mutations during unavailable or pending complete scope", async () => {
    await open(); const pending = deferred<{ items: ChangeEvent[]; total: number }>();
    appApi.queryHistoryEvents.mockReturnValueOnce(pending.promise); await emitAppEvent("sync:done", {});
    focus(); await key("e"); await key("Delete"); await key("Enter");
    expect(document.querySelector(".peek")).toBeTruthy(); expect(appApi.setEventReadState).not.toHaveBeenCalled();
    await escape(); await act(async () => pending.reject(new Error("unavailable"))); focus(); await key("u");
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });

  it("respects nested controls, modifiers, IME, repeat, menus and global search ownership", async () => {
    await open(); focus();
    for (const options of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) await key("e", undefined, options);
    await key("e", button("Preview"));
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    await key(" ", row()); expect(appApi.previewResource).toHaveBeenCalledTimes(1); await escape();
    focus(); await key("/"); expect(document.activeElement?.getAttribute("aria-label")).toBe("Search changes");
    await key("k", row(), { ctrlKey: true }); expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await key("e", row()); expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });

  it("does not widen a captured dismissal for arrivals or History-hidden/missing IDs", async () => {
    await open([change({ id: 21 }), change({ id: 22, resourceTitle: "Sibling" })]);
    focus(); await key("x"); focus("Sibling"); await key("x"); await key("Delete");
    inventory = [change({ id: 23, resourceTitle: "Arrival" })];
    await emitAppEvent("sync:done", {});
    await click(button("Dismiss from Inbox"));
    expect(appApi.dismissInboxEvents.mock.calls).toEqual([[[21, 22]]]);
    expect(row("Arrival").isConnected).toBe(true);
    expect(appApi.snapshotHistoryDeletion).not.toHaveBeenCalled();
  });

  it("invalidates confirmation and stale mutation on filter edits without stealing editor focus", async () => {
    await open(); focus(); await key("Delete"); await click(button("Cancel"));
    const pending = deferred<void>(); appApi.setEventReadState.mockReturnValueOnce(pending.promise);
    focus(); await key("e");
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search changes"]')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Lecture");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 180));
    });
    await act(async () => pending.reject(new Error("old failure")));
    expect(document.body.textContent).not.toContain("old failure");
    expect(document.activeElement).toBe(input);
    focus(); await key("u"); expect(appApi.setEventReadState).toHaveBeenCalledTimes(2);
  });

  it("invalidates pending success on route unmount and does not refresh or resurrect errors", async () => {
    await open(); const pending = deferred<void>(); appApi.dismissInboxEvents.mockReturnValueOnce(pending.promise);
    focus(); await key("Delete"); await click(button("Dismiss from Inbox"));
    await emitAppEvent("ui:navigate", "library");
    const requests = appApi.queryHistoryEvents.mock.calls.length;
    await act(async () => pending.resolve());
    expect(appApi.queryHistoryEvents).toHaveBeenCalledTimes(requests);
    await emitAppEvent("ui:navigate", "history");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    focus(); await key("e"); expect(appApi.setEventReadState).toHaveBeenCalledTimes(1);
  });

  it("reports refresh supersession and retries only refresh after the confirmed write", async () => {
    await open(); const pending = deferred<{ items: ChangeEvent[]; total: number }>();
    appApi.queryHistoryEvents.mockReturnValueOnce(pending.promise);
    focus(); await key("e");
    await emitAppEvent("sync:done", {});
    await act(async () => pending.resolve({ items: inventory, total: inventory.length }));
    expect(document.body.textContent).toContain("superseded");
    await click(button("Retry refresh"));
    expect(appApi.setEventReadState.mock.calls).toEqual([[[10], true]]);
  });

  it("prunes selection to current matching events and preserves filter focus on refresh", async () => {
    await open([change(), change({ id: 11, resourceTitle: "Sibling" })]);
    focus(); await key("x");
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search changes"]')!;
    act(() => input.focus()); inventory = [inventory[1]]; await emitAppEvent("sync:done", {});
    expect(document.activeElement).toBe(input);
    focus("Sibling"); await key("e"); expect(appApi.setEventReadState.mock.calls).toEqual([[[11], true]]);
  });

  it("keeps duplicate confirmation inert, exposes dismissal failure, and preserves counts on Cancel", async () => {
    await open(); const before = document.querySelector('.sidebar')?.textContent;
    focus(); await key("Delete"); await key("Delete", row()); await click(button("Cancel"));
    expect(document.querySelector('.sidebar')?.textContent).toBe(before);
    expect(appApi.dismissInboxEvents).not.toHaveBeenCalled();
    appApi.dismissInboxEvents.mockRejectedValueOnce(new Error("dismiss failed"));
    focus(); await key("Delete"); await click(button("Dismiss from Inbox"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("dismiss failed");
    await click(button("Dismiss from Inbox")); expect(appApi.dismissInboxEvents.mock.calls).toEqual([[[10]], [[10]]]);
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
  });


  it("keeps the newer duplicate lock when an invalidated request finally settles", async () => {
    await open(); const old = deferred<void>(); const fresh = deferred<void>();
    appApi.setEventReadState.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    focus(); await key("e"); await click(button("Scan history")); await click(button("Activity"));
    focus(); await key("u"); await act(async () => old.resolve());
    await key("e"); expect(appApi.setEventReadState).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve());
  });

  it("inspects orphan and baseline metadata with Enter while navigation and X never read", async () => {
    await open([change({ id: 40, resourceId: null, resourceTitle: "Orphan" }), change({ id: 41, changeType: "baseline", resourceTitle: "Baseline" })]);
    focus("Orphan"); await key("Enter"); expect(document.querySelectorAll('.peek')).toHaveLength(1);
    expect(document.querySelector('.peek-title')?.textContent).toBe("Orphan"); await escape();
    await key("j"); await key("x"); await key("Enter");
    expect(document.querySelector('.peek-title')?.textContent).toBe("Baseline");
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    expect(appApi.markAllRead).not.toHaveBeenCalled();
  });

  it("Shift+A captures only matching events and filter edits invalidate open confirmation", async () => {
    await open([change(), change({ id: 11, resourceTitle: "Other" })]);
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search changes"]')!;
    await act(async () => {
      input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Lecture");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    focus(); await key("A", undefined, { shiftKey: true });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("1 captured changes");
    await click(button("Cancel"));
    focus(); await key("A", undefined, { shiftKey: true }); await click(button("Mark captured changes read"));
    expect(appApi.setEventReadState.mock.calls).toEqual([[[10], true]]);
    expect(appApi.queryInbox.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not handle row action keys on the inactive Scans tab or native filter controls", async () => {
    await open();
    await key("e", document.querySelector<HTMLElement>('[aria-label="Filter by change type"]')!);
    await click(button("Scan history")); await key("A", button("Activity"), { shiftKey: true });
    await key("Delete", button("Activity"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(appApi.dismissInboxEvents).not.toHaveBeenCalled(); expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });

});

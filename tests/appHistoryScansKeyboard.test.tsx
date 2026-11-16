import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appApi, button, click, deferred, emitAppEvent, escape, flushApp, renderApp, setupApp } from "./helpers/renderApp";
import HistoryView, { type HistoryViewProps } from "../src/views/HistoryView";
import type { ScanRun } from "../src/lib/types";

const scan = (id: number): ScanRun => ({ id, startedAt: `2026-11-16T${String(Math.floor(id / 60) % 24).padStart(2, "0")}:${String(id % 60).padStart(2, "0")}:00Z`, completedAt: null, status: "success", discoveredCount: id, newCount: 0, updatedCount: 0, unavailableCount: 0, coursesScanned: 1, coursesFailed: 0, errorSummary: null, isBaseline: false });
let app: Awaited<ReturnType<typeof renderApp>> | undefined;
let root: Root | undefined;
let host: HTMLDivElement;
const row = (id: number) => document.querySelector<HTMLTableRowElement>(`tr[data-row-key="${id}"]`)!;
async function key(key: string, target: HTMLElement = document.activeElement as HTMLElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...options });
  await act(async () => { target.dispatchEvent(event); });
  await flushApp();
  return event;
}
async function open(scans = [scan(1), scan(2), scan(3)]) {
  appApi.listHistoryScans.mockResolvedValue(scans);
  app = await renderApp();
  await emitAppEvent("ui:navigate", "history");
  await click(button("Scan history"));
}
beforeEach(() => setupApp());
afterEach(() => {
  if (root) { act(() => root!.unmount()); root = undefined; host.remove(); }
  app?.unmount(); app = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("actual App History Scans keyboard", () => {
  it("moves/clamps one row tab stop without inspection, then inspects and returns independently", async () => {
    await open();
    expect(document.querySelectorAll('tbody tr[tabindex="0"]')).toHaveLength(1);
    act(() => row(1).focus()); await key("k"); expect(document.activeElement).toBe(row(1));
    await key("j"); expect(document.activeElement).toBe(row(2));
    expect(document.querySelector('.peek')).toBeNull();
    await key("Enter"); expect(document.querySelectorAll('.peek')).toHaveLength(1);
    act(() => row(2).focus()); await key("ArrowDown"); await key("j");
    expect(document.activeElement).toBe(row(3)); expect(row(2).classList.contains("selected")).toBe(true);
    expect(row(3).classList.contains("selected")).toBe(false);
    await escape(); expect(document.activeElement).toBe(row(2));
    await key("ArrowUp"); expect(document.activeElement).toBe(row(1));
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });

  it("never gives scan rows material, selection, dismissal or deletion actions, even inspected", async () => {
    await open(); act(() => row(1).focus()); await key("Enter");
    for (const inspected of [true, false]) {
      if (!inspected) await escape();
      act(() => row(1).focus());
      for (const name of ["x", "e", "u", "Delete", " ", "A"]) {
        expect((await key(name, row(1), { shiftKey: name === "A" })).defaultPrevented).toBe(false);
      }
    }
    for (const name of ["setEventReadState", "dismissInboxEvents", "markAllRead", "snapshotHistoryDeletion", "deleteHistorySnapshot", "clearHistoryActivity", "snapshotResourceEventIds", "previewResource", "openLocalFile", "revealLocalFile", "mirrorDeleteAll"] as const) expect(appApi[name]).not.toHaveBeenCalled();
    expect(document.querySelector('.multi-selected, [role="alertdialog"]')).toBeNull();
  });

  it("yields nested/header controls and all guards, while keeping Started click native", async () => {
    await open(); act(() => row(1).focus());
    for (const options of [{ repeat: true }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) expect((await key("j", row(1), options)).defaultPrevented).toBe(false);
    const prevented = new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }); prevented.preventDefault();
    act(() => row(1).dispatchEvent(prevented)); expect(document.activeElement).toBe(row(1));
    const nested = row(1).querySelector<HTMLButtonElement>('button')!;
    act(() => nested.focus()); expect((await key("Enter", nested)).defaultPrevented).toBe(false);
    expect((await key("j", document.querySelector('th')!)).defaultPrevented).toBe(false);
    for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
      const overlay = document.createElement('div'); overlay.setAttribute('role', role); document.body.append(overlay);
      expect((await key("j", row(1))).defaultPrevented).toBe(false); overlay.remove();
    }
    await click(nested); expect(document.querySelectorAll('.peek')).toHaveLength(1);
    await escape(); expect(document.activeElement).toBe(nested);
    await click(button("Activity")); expect((await key("j", button("Scan history"))).defaultPrevented).toBe(false);
  });

  it("retains rows during refresh/error, recovers stable identity and preserves external focus", async () => {
    await open(); act(() => row(2).focus());
    const pending = deferred<ScanRun[]>(); appApi.listHistoryScans.mockReturnValueOnce(pending.promise);
    await emitAppEvent("sync:done", {}); await key("j"); expect(document.activeElement).toBe(row(3));
    await act(async () => pending.reject(new Error("offline"))); expect(row(3)).toBeTruthy();
    appApi.listHistoryScans.mockResolvedValue([scan(1), scan(2)]); await emitAppEvent("sync:done", {});
    expect(document.activeElement).toBe(row(2));
    act(() => button("Scan history").focus()); appApi.listHistoryScans.mockResolvedValue([scan(1)]);
    await emitAppEvent("sync:done", {}); expect(document.activeElement).toBe(button("Scan history"));
    expect(row(1).tabIndex).toBe(0);
  });

  it("clears stale inspection on removal and tab/route exits without stealing the destination", async () => {
    await open(); act(() => row(2).focus()); await key("Enter");
    appApi.listHistoryScans.mockResolvedValue([scan(1), scan(3)]); await emitAppEvent("sync:done", {});
    expect(document.querySelector('.peek')).toBeNull(); expect(document.activeElement).toBe(row(3));
    await key("Enter"); await click(button("Activity")); expect(document.querySelector('.peek')).toBeNull();
    await click(button("Scan history")); act(() => row(1).focus()); await key("Enter");
    await click(button("Inbox")); expect(document.activeElement).toBe(document.querySelector('main h1'));
  });
});

const large = Array.from({ length: 320 }, (_, i) => scan(i + 1));
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); }); };
let props: HistoryViewProps;
let scrolls: number[];
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
async function direct(scans = large) {
  scrolls = [];
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains('table-scroll') ? 170 : 34; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(320 * 34);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(170);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions) {
    const previous = this.scrollTop; this.scrollTop = options.top ?? previous; scrolls.push(this.scrollTop);
    if (previous !== this.scrollTop) queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  } });
  props = { courses: [], events: [], resources: [], scans, loading: false, error: null, onRetry: vi.fn(), onOpen: vi.fn(), onMarkAllRead: vi.fn(), onClearAll: vi.fn(), onSyncNow: vi.fn(), details: { selected: null, selectScan: vi.fn(), selectChange: vi.fn(), selectResource: vi.fn(), clear: vi.fn() } };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root!.render(<HistoryView {...props} />)); await click(button('Scan history')); await settle();
}
function publish(scans: ScanRun[]) { props = { ...props, scans }; act(() => root!.render(<HistoryView {...props} />)); }
afterEach(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

describe("History Scans real virtualizer and restore lifecycle", () => {
  it("scrolls and mounts an offscreen next identity, and restores an unmounted inspector origin", async () => {
    await direct(); expect(document.querySelectorAll('tbody tr[data-row-key]').length).toBeLessThan(40);
    act(() => row(1).focus()); await key('Enter');
    const restore = vi.mocked(props.details.selectScan).mock.calls[0][2]!;
    // Reorder the next identity offscreen: policy still moves by published order.
    publish([large[0], large[279], ...large.slice(1, 279), ...large.slice(280)]);
    await key('j'); expect(document.activeElement).toBe(row(280));
    // Move the focused key to the far end without refresh-only scrolling.
    publish([...large.slice(1), large[0]]); await settle();
    act(() => { expect(restore()).toBe(true); }); await settle();
    expect(scrolls.some(top => top > 9000)).toBe(true); expect(document.activeElement).toBe(row(1));
    expect(row(1)).toBeTruthy(); expect(document.querySelectorAll('tbody tr[data-row-key]').length).toBeLessThan(40);
  });

  it("supersedes pending restoration and cancels removed targets, overlays and tab/unmount callbacks", async () => {
    await direct(); act(() => row(1).focus()); await key('Enter');
    const restore = vi.mocked(props.details.selectScan).mock.calls[0][2]!;
    publish([...large.slice(1), large[0]]);
    act(() => { restore(); row(2).focus(); }); await settle();
    expect(document.activeElement).toBe(row(2));
    act(() => { restore(); publish(large.slice(1)); }); await settle();
    expect(document.activeElement?.getAttribute('data-row-key')).not.toBe('1');
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); const input = document.createElement('input'); dialog.append(input); document.body.append(dialog);
    act(() => { input.focus(); restore(); }); await settle(); expect(document.activeElement).toBe(input);
    dialog.remove(); publish([...large.slice(1)]); await settle(); expect(document.activeElement).toBe(document.body);
    await click(button('Activity')); expect(restore()).toBe(false);
    await click(button('Scan history')); expect(restore()).toBe(false);
    act(() => root!.render(null)); expect(restore()).toBe(false);
  });

  it("restores a surviving neighbor or Scans control for empty rows, never on refresh alone", async () => {
    await direct(large.slice(0, 3)); act(() => row(2).focus()); await key('Enter');
    const restore = vi.mocked(props.details.selectScan).mock.calls[0][2]!;
    act(() => button('Scan history').focus()); publish([scan(3), scan(1)]);
    expect(document.activeElement).toBe(button('Scan history'));
    act(() => { restore(); }); expect(document.activeElement).toBe(row(3));
    publish([]); expect(document.activeElement).toBe(button('Scan history'));
    act(() => { restore(); }); expect(document.activeElement).toBe(button('Scan history'));
    expect(document.querySelector('table')).toBeNull();
  });
});

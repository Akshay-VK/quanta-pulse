import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DataTable, { type DataTableNavigationHandle } from "../src/components/DataTable";

type Row = { id: string };
const rows = Array.from({ length: 320 }, (_, i) => ({ id: `row-${i}` }));
const columns = [{ id: "title", header: "Title", cell: (row: Row) => <><span>{row.id}</span><button>Action {row.id}</button><a href={`#${row.id}`}>Link</a><input aria-label={`Edit ${row.id}`} /></> }];
let host: HTMLDivElement;
let root: Root;
let scrolls: number[];
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  scrolls = [];
  // Supply browser geometry and scrolling, leaving the real virtualizer enabled.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("table-scroll") ? 170 : 34; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(rows.length * 34);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(170);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object") {
      const previous = this.scrollTop;
      this.scrollTop = options.top ?? this.scrollTop;
      scrolls.push(this.scrollTop);
      // Browsers deliver scroll events asynchronously, after the current request.
      if (this.scrollTop !== previous) queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    }
  } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); };

describe("DataTable keyed navigation foundation", () => {
  it("scrolls a real windowed table to an offscreen stable key and focuses its mounted row", async () => {
    const ref = createRef<DataTableNavigationHandle>();
    act(() => root.render(<DataTable rows={rows} columns={columns} getKey={(row) => row.id} virtual height={170} navigationRef={ref} focusedKey="row-0" />));
    expect(host.querySelectorAll("tbody tr[data-row-key]").length).toBeLessThan(40);
    expect(ref.current!.getRowElement("row-280")).toBeNull();
    act(() => { expect(ref.current!.focusKey("row-280")).toBe(true); });
    await settle();
    expect(scrolls.some((top) => top > 8000)).toBe(true);
    expect(document.activeElement).toBe(ref.current!.getRowElement("row-280"));
    expect(document.activeElement?.getAttribute("data-row-key")).toBe("row-280");
    expect(host.querySelectorAll("tbody tr[data-row-key]").length).toBeLessThan(40);
  });

  it("uses current row indices after reordering and does not focus when a pending key disappears", async () => {
    const ref = createRef<DataTableNavigationHandle>();
    const reversed = [...rows].reverse();
    act(() => root.render(<DataTable rows={reversed} columns={columns} getKey={(row) => row.id} virtual height={170} navigationRef={ref} />));
    act(() => { ref.current!.focusKey("row-20"); });
    await settle();
    expect(document.activeElement?.getAttribute("data-row-key")).toBe("row-20");
    expect(scrolls.some((top) => top > 9000)).toBe(true);
    act(() => {
      ref.current!.focusKey("row-250");
      root.render(<DataTable rows={reversed.filter((row) => row.id !== "row-250")} columns={columns} getKey={(row) => row.id} virtual height={170} navigationRef={ref} />);
    });
    await settle();
    expect(document.activeElement?.getAttribute("data-row-key")).not.toBe("row-250");
    expect(ref.current!.getRowElement("row-250")).toBeNull();
  });

  it("keeps inspection, selection, focus and row-only notifications independent; controls stay native", () => {
    const ref = createRef<DataTableNavigationHandle>();
    const onRowFocus = vi.fn();
    const onRowClick = vi.fn();
    act(() => root.render(<DataTable rows={rows.slice(0, 3)} columns={columns} getKey={(row) => row.id} selectedKey="row-0" focusedKey="row-1" multiSelectedKeys={["row-2"]} onRowFocus={onRowFocus} onRowClick={onRowClick} navigationRef={ref} />));
    const first = ref.current!.getRowElement("row-0")!;
    const focused = ref.current!.getRowElement("row-1")!;
    expect(first.className).toBe("selected");
    expect(focused.className).toBe("keyboard-focused");
    expect(ref.current!.getRowElement("row-2")!.className).toBe("multi-selected");
    expect(first.tabIndex).toBe(-1);
    expect(focused.tabIndex).toBe(0);
    act(() => { ref.current!.focusKey("row-1"); });
    expect(document.activeElement).toBe(focused);
    expect(onRowFocus).toHaveBeenCalledTimes(1);
    expect(onRowFocus).toHaveBeenCalledWith(rows[1]);
    for (const control of first.querySelectorAll<HTMLElement>("button, a, input")) {
      act(() => { control.focus(); control.click(); control.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true })); });
      expect(document.activeElement).toBe(control);
    }
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowFocus).toHaveBeenCalledTimes(1);
    act(() => { expect(ref.current!.focusKey("missing")).toBe(false); });
    expect(ref.current!.getRowElement("missing")).toBeNull();
  });

  it("cancels pending focus when superseded, including by an absent key", async () => {
    const ref = createRef<DataTableNavigationHandle>();
    act(() => root.render(<DataTable rows={rows} columns={columns} getKey={(row) => row.id} virtual height={170} navigationRef={ref} />));
    act(() => { ref.current!.focusKey("row-280"); ref.current!.focusKey("row-1"); });
    await settle();
    expect(document.activeElement?.getAttribute("data-row-key")).toBe("row-1");
    act(() => { ref.current!.focusKey("row-240"); expect(ref.current!.focusKey("absent")).toBe(false); });
    await settle();
    expect(document.activeElement?.getAttribute("data-row-key")).not.toBe("row-240");
  });

  it("cancels pending focus on modal opening and never resumes it on modal close or refresh", async () => {
    const ref = createRef<DataTableNavigationHandle>();
    const render = () => root.render(<DataTable rows={[...rows]} columns={columns} getKey={(row) => row.id} virtual height={170} navigationRef={ref} />);
    act(render);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const input = document.createElement("input");
    dialog.append(input);
    act(() => { ref.current!.focusKey("row-280"); document.body.append(dialog); input.focus(); });
    await settle();
    expect(document.activeElement).toBe(input);
    act(() => { ref.current!.focusKey("row-0"); });
    expect(document.activeElement).toBe(input);
    dialog.remove();
    act(render);
    await settle();
    expect(document.activeElement?.getAttribute("data-row-key")).not.toBe("row-280");
  });

  it("cancels an unmounted request and clears the handle", async () => {
    const ref = createRef<DataTableNavigationHandle>();
    act(() => root.render(<DataTable rows={rows} columns={columns} getKey={(row) => row.id} virtual navigationRef={ref} />));
    const handle = ref.current!;
    act(() => { handle.focusKey("row-280"); root.render(null); });
    await settle();
    expect(ref.current).toBeNull();
    expect(handle.getRowElement("row-280")).toBeNull();
    expect(handle.focusKey("row-280")).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("preserves consumers without navigation props and adds no keyboard policy", () => {
    const click = vi.fn();
    act(() => root.render(<DataTable rows={rows.slice(0, 2)} columns={columns} getKey={(row) => row.id} onRowClick={click} selectedKey="row-0" />));
    const table = host.querySelector("table")!;
    expect(table.classList.contains("keyboard-list")).toBe(false);
    expect(host.querySelector("[tabindex], [data-row-key]")).toBeNull();
    const row = host.querySelector("tbody tr")!;
    expect(row.className).toBe("selected");
    const event = new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true });
    act(() => { row.dispatchEvent(event); row.querySelector("span")!.click(); });
    expect(event.defaultPrevented).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledWith(rows[0]);
  });
});

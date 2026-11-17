import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appApi, button, click, course, deferred, emitAppEvent, flushApp, renderApp, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>> | undefined;
const courses = Array.from({ length: 65 }, (_, i) => ({ ...course, id: i + 1, name: `Course ${i + 1}`, shortName: `CODE${i + 1}`, externalCourseId: `external-${i + 1}` }));
const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".course-row-main")];
const search = () => document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')!;
async function key(value: string, options: KeyboardEventInit = {}, target: Element = document.activeElement!, prevented = false) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
  if (prevented) event.preventDefault();
  await act(async () => { target.dispatchEvent(event); });
  await flushApp();
  return event;
}
async function filter(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flushApp();
}
async function open() {
  app = await renderApp();
  await click(button("Library"));
}
function noActions() {
  for (const name of ["setEventReadState", "dismissInboxEvents", "deleteHistory", "previewResource", "snapshotResourceEventIds", "setMonitoring", "rebuildBaseline", "openExternal", "downloadResource"] as const) {
    if (name in appApi) expect(appApi[name as keyof typeof appApi]).not.toHaveBeenCalled();
  }
}
beforeEach(() => {
  setupApp();
  appApi.listCourses.mockResolvedValue(courses);
});
afterEach(() => { app?.unmount(); app = undefined; });

describe("Courses keyboard in the actual App", () => {
  it("clamps first/last and reaches every incoming course without navigation or mutation", async () => {
    await open();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    act(() => rows()[0].focus());
    await key("k"); expect(document.activeElement).toBe(rows()[0]);
    for (let i = 1; i < courses.length; i++) {
      expect((await key(i % 2 ? "j" : "ArrowDown")).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(rows()[i]);
    }
    await key("ArrowDown"); expect(document.activeElement).toBe(rows().at(-1));
    await key("ArrowUp"); expect(document.activeElement).toBe(rows().at(-2));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(document.querySelector(".course-page")).toBeNull();
    noActions();
  });
  it("keeps native primary/menu tab stops and pointer navigation in the existing App chain", async () => {
    await open();
    const first = rows()[0];
    const menu = button("Actions for Course 1");
    expect(first.tabIndex).toBe(0); expect(menu.tabIndex).toBe(0);
    const buttons = [...first.parentElement!.parentElement!.querySelectorAll("button")];
    expect(buttons.slice(0, 4)).toEqual([first, menu, rows()[1], button("Actions for Course 2")]);
    act(() => first.focus());
    for (const value of ["Tab", "Enter", " ", "x", "e", "u", "Delete"]) expect((await key(value)).defaultPrevented).toBe(false);
    expect((await key("A", { shiftKey: true })).defaultPrevented).toBe(false);
    noActions();
    await click(first);
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("main")?.textContent).toContain("Course 1");
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });
  it("preserves alias/name/code/external-ID filtering and incoming order", async () => {
    localStorage.setItem("quanta-pulse-course-aliases", JSON.stringify({ "3": "Favourite" }));
    appApi.listCourses.mockResolvedValue([courses[4], courses[2], courses[0]]);
    await open();
    expect(rows().map(r => r.getAttribute("aria-label"))).toEqual(["Open Course 5 library", "Open Favourite library", "Open Course 1 library"]);
    for (const term of ["Favourite", "Course 3", "CODE3", "external-3"]) {
      await filter(term); expect(rows()).toHaveLength(1);
      act(() => rows()[0].focus()); await key("j"); expect(document.activeElement).toBe(rows()[0]);
    }
    act(() => search().focus()); await filter("no matches");
    expect(rows()).toHaveLength(0); expect(document.activeElement).toBe(search());
    noActions();
  });
  it("recovers next then previous identity across reorder/removal and returns empty focus to search", async () => {
    appApi.listCourses.mockResolvedValue(courses.slice(0, 4)); await open();
    act(() => rows()[1].focus());
    appApi.listCourses.mockResolvedValue([courses[3], courses[1], courses[2], courses[0]]);
    await emitAppEvent("sync:done", {}); expect(document.activeElement).toBe(rows()[1]);
    appApi.listCourses.mockResolvedValue([courses[3], courses[2], courses[0]]);
    await emitAppEvent("sync:done", {}); expect(document.activeElement).toBe(rows()[1]);
    appApi.listCourses.mockResolvedValue([courses[3]]);
    await emitAppEvent("sync:done", {}); expect(document.activeElement).toBe(rows()[0]);
    appApi.listCourses.mockResolvedValue([]);
    await emitAppEvent("sync:done", {}); expect(document.activeElement).toBe(search());
    expect(document.body.textContent).toContain("No courses found"); noActions();
  });
  it("retains navigable courses during refresh/failure and never steals search focus on arrivals", async () => {
    appApi.listCourses.mockResolvedValue(courses.slice(0, 3)); await open();
    const pending = deferred<typeof courses>(); appApi.listCourses.mockReturnValue(pending.promise);
    await emitAppEvent("sync:done", {});
    act(() => rows()[0].focus()); await key("j"); expect(document.activeElement).toBe(rows()[1]);
    await act(async () => pending.reject(new Error("courses offline"))); await flushApp();
    await key("j"); expect(document.activeElement).toBe(rows()[2]);
    act(() => search().focus()); appApi.listCourses.mockResolvedValue(courses);
    await emitAppEvent("sync:done", {}); expect(document.activeElement).toBe(search());
    expect(rows()).toHaveLength(65); noActions();
  });
  it("rejects repeats, IME, prevented, modifiers, nested targets, overlays and inactive routes/tabs", async () => {
    await open(); const first = rows()[0]; act(() => first.focus());
    for (const options of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect((await key("j", options)).defaultPrevented).toBe(false); expect(document.activeElement).toBe(first);
    }
    await key("j", {}, first, true); expect(document.activeElement).toBe(first);
    await key("j", {}, first.querySelector("span")!); expect(document.activeElement).toBe(first);
    await key("j", {}, button("Actions for Course 1")); expect(document.activeElement).toBe(first);
    for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
      const overlay = document.createElement("div"); overlay.setAttribute("role", role); document.body.append(overlay);
      expect((await key("j")).defaultPrevented).toBe(false); overlay.remove();
    }
    const drawer = document.createElement("div"); drawer.className = "sidebar-drawer"; document.body.append(drawer);
    await key("j"); expect(document.activeElement).toBe(first); drawer.remove();
    act(() => search().focus()); await key("j"); expect(document.activeElement).toBe(search());
    await click(button("All files")); await key("j", {}, first); expect(rows()).toHaveLength(0);
    await click(button("Library")); await click(button("Courses")); const old = rows()[0];
    await click(button("Inbox")); await key("j", {}, old); expect(rows()).toHaveLength(0); noActions();
  });
  it("leaves explicit menu monitoring, rename and rebaseline with their existing owners", async () => {
    await open();
    // Radix opens a menu with the native trigger's key, not a course shortcut.
    act(() => button("Actions for Course 1").focus()); await key("ArrowDown");
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(n => n.textContent?.includes("Pause monitoring"))!);
    expect(appApi.setMonitoring).toHaveBeenCalledWith(1, "paused");
    act(() => button("Actions for Course 1").focus()); await key("ArrowDown");
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(n => n.textContent?.includes("Rename"))!);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Rename course");
    act(() => document.querySelector<HTMLInputElement>('#course-alias-input')!.focus());
    await key("j"); expect(document.activeElement?.id).toBe("course-alias-input");
    await click(button("Cancel"));
    act(() => button("Actions for Course 1").focus()); await key("ArrowDown");
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(n => n.textContent?.includes("Reset baseline"))!);
    expect(appApi.rebuildBaseline).not.toHaveBeenCalled(); await click(button("Reset baseline"));
    expect(appApi.rebuildBaseline).toHaveBeenCalledWith(1);
  });
});

it("isolates fallback-to-first and overlay removal without background recovery or a required adapter", async () => {
  const { default: CourseList } = await import("../src/views/library/CourseList");
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const render = async (items: typeof courses) => { await act(async () => root.render(<CourseList courses={items} resources={[]} onOpenCourse={vi.fn()} onOpen={vi.fn()} onChanged={vi.fn()} />)); };
  try {
    await render(courses.slice(0, 2)); act(() => rows()[1].focus());
    await render([courses[4]]); expect(document.activeElement).toBe(rows()[0]);
    const overlay = document.createElement("button"); overlay.setAttribute("role", "dialog"); document.body.append(overlay); overlay.focus();
    await render([courses[5]]); expect(document.activeElement).toBe(overlay); overlay.remove();
    await render([]); expect(rows()).toHaveLength(0);
  } finally { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

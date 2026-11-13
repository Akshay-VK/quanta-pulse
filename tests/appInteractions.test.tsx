import { act } from "react";
import type { LocalFile } from "../src/lib/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, appClipboard, button, change, click, deferred, emitAppEvent, escape, flushApp, renderApp, resource, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("App details lifecycle", () => {
  it("inspects Today without opening or acknowledging and returns to the pointer origin", async () => {
    app = await renderApp();
    const row = button("Show details for Lecture 4");
    // A pointer activation must not depend on document.activeElement already being the row.
    await click(row);
    expect(document.querySelectorAll(".peek")).toHaveLength(1);
    expect(document.activeElement).toBe(document.querySelector(".peek-title"));
    expect(document.querySelector(".resource-row.selected")).toBeTruthy();
    expect(appApi.openExternal).not.toHaveBeenCalled();
    expect(appApi.markRead).not.toHaveBeenCalled();
    await click(button("Close details"));
    expect(document.activeElement).toBe(row);
  });
  it("ignores an older mirror lookup even after the same resource is selected again", async () => {
    const first = deferred<LocalFile | null>();
    const current = deferred<LocalFile | null>();
    appApi.listDashboardResources.mockResolvedValue([resource(), resource({ id: 2, title: "Lecture 5" })]);
    appApi.listDashboardEvents.mockResolvedValue([change(), change({ id: 11, resourceId: 2 })]);
    appApi.mirrorLocalFile.mockReturnValueOnce(first.promise).mockResolvedValueOnce(null).mockReturnValueOnce(current.promise);
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    await click(button("Show details for Lecture 5"));
    expect(document.querySelector(".peek")?.textContent).not.toContain("/new.pdf");
    await click(button("Show details for Lecture 4"));
    const local: LocalFile = { resourceId: 1, relPath: "new.pdf", path: "/new.pdf", sizeBytes: 42, mime: null, sha256: null, status: "ok", error: null };
    await act(async () => current.resolve(local));
    await flushApp();
    expect(document.querySelector(".peek")?.textContent).toContain("/new.pdf");
    await act(async () => first.resolve({ ...local, path: "/old.pdf" }));
    await flushApp();
    expect(document.querySelector(".peek")?.textContent).toContain("/new.pdf");
    expect(document.querySelector(".peek")?.textContent).not.toContain("/old.pdf");
  });

  it("clears details on shell navigation and focuses the current view heading", async () => {
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    await emitAppEvent("ui:navigate", "history");
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("main h1"));
    expect(document.activeElement?.textContent).toBe("History");
  });

  it("keeps selection while filters retain the row, then clears it with heading focus", async () => {
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search activity"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(search, "Lecture"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 170)); });
    expect(document.querySelector(".peek")).toBeTruthy();
    await act(async () => { setValue.call(search, "no matching file"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 170)); });
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("main h1"));
  });

  it("dismisses a nested preview before details and returns keyboard focus in two steps", async () => {
    app = await renderApp();
    const row = button("Show details for Lecture 4");
    row.focus();
    // Native button activation (jsdom does not synthesize click from Enter).
    expect(row.tagName).toBe("BUTTON");
    await click(row);
    const preview = button("Preview", document.querySelector(".peek")!);
    preview.focus();
    await click(preview);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await escape();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".peek")).toBeTruthy();
    expect(document.activeElement).toBe(preview);
    await escape();
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("dismisses an action menu before details", async () => {
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    const trigger = button("More actions", document.querySelector(".peek")!);
    trigger.focus();
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true })); });
    await flushApp();
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    await escape();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector(".peek")).toBeTruthy();
    await escape();
    expect(document.querySelector(".peek")).toBeNull();
  });

  it("shows current mirror status and catches local action failures with recoverable feedback", async () => {
    appApi.mirrorLocalFiles.mockResolvedValue([{ resourceId: 1, status: "ok", error: null }]);
    appApi.mirrorLocalFile.mockResolvedValue({ resourceId: 1, relPath: "lecture.pdf", path: "/files/lecture.pdf", sizeBytes: 42, mime: null, sha256: null, status: "ok", error: null });
    appApi.openLocalFile.mockRejectedValueOnce("Disk unavailable").mockResolvedValueOnce(undefined);
    appApi.revealLocalFile.mockRejectedValue("Folder unavailable");
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    const panel = document.querySelector(".peek")!;
    expect(panel.textContent).toContain("/files/lecture.pdf");
    expect(panel.textContent).not.toContain("Waiting");
    await click(button("Open local copy", panel));
    expect(document.body.textContent).toContain("Disk unavailable");
    await click(button("Open local copy", panel));
    expect(appApi.openLocalFile).toHaveBeenCalledTimes(2);
    await click(button("Dismiss"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
    await click(button("Show in folder", panel));
    expect(document.body.textContent).toContain("Folder unavailable");
    await emitAppEvent("mirror:file", { resourceId: 1, status: "failed", error: "Download interrupted" });
    expect(panel.textContent).toContain("Download interrupted");
  });

  it("describes absent local data and missing dates honestly and reports failed downloads", async () => {
    appApi.ensureLocal.mockRejectedValue("No space available");
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    const panel = document.querySelector(".peek")!;
    expect(panel.textContent).toContain("Upload date unavailable");
    expect(panel.textContent).toContain("No local copy yet");
    await click(button("Download now", panel));
    expect(document.body.textContent).toContain("No space available");
    expect(document.querySelector(".peek")).toBeTruthy();
  });

  it("lets a confirmation dialog consume Escape while keeping details and activity", async () => {
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    const trigger = button("Activity actions");
    trigger.focus();
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
    await flushApp();
    const clear = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent?.includes("Clear activity"))!;
    await click(clear);
    expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).toBeTruthy();
    await escape();
    expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull();
    expect(document.querySelector(".peek")).toBeTruthy();
    expect(appApi.clearDashboardActivity).not.toHaveBeenCalled();
  });

  it("falls back to the view heading when the connected origin is hidden", async () => {
    app = await renderApp();
    const row = button("Show details for Lecture 4");
    await click(row);
    row.hidden = true;
    await click(button("Close details"));
    expect(document.activeElement).toBe(document.querySelector("main h1"));
  });

  it.each([820, 1280])("keeps explicit file actions separate from inspection at width %s", async (width) => {
    setupApp({ width });
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    expect(appApi.openExternal).not.toHaveBeenCalled();
    await click(button("Open file", document.querySelector(".peek")!));
    expect(appApi.openExternal).toHaveBeenCalledWith(resource().url);
    expect(appApi.markRead).not.toHaveBeenCalled();
    await escape();
    expect(document.activeElement).toBe(button("Show details for Lecture 4"));
  });

  it("clears a completed local lookup when another resource is selected", async () => {
    appApi.listDashboardResources.mockResolvedValue([resource(), resource({ id: 2, title: "Lecture 5" })]);
    appApi.listDashboardEvents.mockResolvedValue([change(), change({ id: 11, resourceId: 2 })]);
    appApi.mirrorLocalFile.mockResolvedValueOnce({ resourceId: 1, relPath: "a.pdf", path: "/files/a.pdf", sizeBytes: 42, mime: null, sha256: null, status: "ok", error: null });
    appApi.mirrorLocalFile.mockReturnValueOnce(deferred<LocalFile | null>().promise);
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    expect(document.querySelector(".peek")?.textContent).toContain("/files/a.pdf");
    await click(button("Show details for Lecture 5"));
    expect(document.querySelectorAll(".peek")).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe("Lecture 5");
    expect(document.querySelector(".peek")?.textContent).not.toContain("/files/a.pdf");
    expect(document.querySelector(".peek")?.textContent).toContain("Loading local copy");
  });

  it("reports a lookup failure, then recovers through an explicit local download", async () => {
    appApi.mirrorLocalFile.mockRejectedValue("Mirror database unavailable");
    appApi.ensureLocal.mockResolvedValue({ resourceId: 1, relPath: "recovered.pdf", path: "/files/recovered.pdf", sizeBytes: 42, mime: null, sha256: null, status: "ok", error: null });
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    expect(document.querySelector(".peek")?.textContent).toContain("Local copy unavailable");
    expect(document.body.textContent).toContain("Could not load local copy");
    await click(button("Download now", document.querySelector(".peek")!));
    expect(document.querySelector(".peek")?.textContent).toContain("/files/recovered.pdf");
    expect(button("Open local copy", document.querySelector(".peek")!)).toBeTruthy();
  });

  it("reports failed copying from a local path property through the existing notification surface", async () => {
    appApi.mirrorLocalFile.mockResolvedValue({ resourceId: 1, relPath: "a.pdf", path: "/files/a.pdf", sizeBytes: 42, mime: null, sha256: null, status: "ok", error: null });
    appClipboard.writeText.mockRejectedValue("Clipboard unavailable");
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    await click(button("Copy path", document.querySelector(".peek")!));
    expect(document.body.textContent).toContain("Could not copy to the clipboard");
    expect(document.querySelector(".peek")).toBeTruthy();
  });

  it("keeps a newly downloaded local copy when its older lookup finishes later", async () => {
    const lookup = deferred<LocalFile | null>();
    appApi.mirrorLocalFile.mockReturnValue(lookup.promise);
    appApi.ensureLocal.mockResolvedValue({ resourceId: 1, relPath: "new.pdf", path: "/files/new.pdf", sizeBytes: 42, mime: null, sha256: null, status: "ok", error: null });
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    await click(button("Download now", document.querySelector(".peek")!));
    await act(async () => lookup.resolve(null));
    expect(document.querySelector(".peek")?.textContent).toContain("/files/new.pdf");
  });

});

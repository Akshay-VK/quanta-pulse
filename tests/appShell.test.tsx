import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { appApi, button, click, escape, renderApp, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>> | undefined;
beforeEach(() => setupApp({ width: 1000 }));
afterEach(() => { app?.unmount(); app = undefined; });

describe("workspace inspector and route heading", () => {
  it("closes the navigation drawer on Escape and restores its opener", async () => {
    setupApp({ width: 720 });
    app = await renderApp();
    const opener = button("Open navigation");
    opener.focus();
    await click(opener);
    expect(app.container.querySelector('.sidebar[aria-modal="true"]')).toBeTruthy();
    await escape();
    expect(app.container.querySelector(".sidebar-scrim")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves the workspace unobscured when no inspector is open", async () => {
    app = await renderApp();
    expect(app.container.querySelector(".workspace-inspector-scrim")).toBeNull();
  });

  it("removes the inspector scrim again after closing a selection", async () => {
    app = await renderApp();
    const row = app.container.querySelector<HTMLButtonElement>(".row-select");
    expect(row).toBeTruthy();
    await click(row!);
    expect(app.container.querySelector(".workspace-inspector-scrim")).toBeTruthy();
    await escape();
    expect(app.container.querySelector(".workspace-inspector-scrim")).toBeNull();
  });

  it("shows the Inbox heading without a duplicate top-bar route label", async () => {
    app = await renderApp();
    const titles = [...app.container.querySelectorAll(".crumb-current, h1")]
      .filter(element => element.textContent?.trim() === "Inbox");
    expect(titles).toHaveLength(1);
    expect(app.container.querySelector("h1")?.textContent).toBe("Inbox");
  });

  it("puts command search beside the page title and Appearance in the sidebar footer", async () => {
    app = await renderApp();
    const heading = app.container.querySelector("main h1");
    expect(heading?.closest("header")?.contains(button("Search"))).toBe(true);
    expect(button("Appearance").closest(".sidebar-footer")).toBeTruthy();
    await click(button("Search"));
    expect(document.querySelector('[role="combobox"]')).toBeTruthy();
  });

  it("lets keyboard users skip the sidebar to the current workspace", async () => {
    app = await renderApp();
    const link = app.container.querySelector<HTMLAnchorElement>('a[href="#workspace-content"]')!;
    link.focus();
    await click(link);
    expect(document.activeElement).toBe(app.container.querySelector("main"));
  });

  it("opens History on the Scans tab from a failed monitoring status", async () => {
    appApi.syncStatus.mockResolvedValue({
      running: false, phase: "Idle", progress: 0, lastSuccessAt: null,
      nextScheduledAt: null, unreadNew: 0, lastError: "Offline", authState: "connected",
    });
    app = await renderApp();
    await click(button("Scan failed"));
    expect(app.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Scans");
  });

  it("contains focus in the narrow inspector and restores the originating row", async () => {
    app = await renderApp();
    const row = app.container.querySelector<HTMLButtonElement>(".row-select")!;
    await click(row);
    const dialog = app.container.querySelector('[role="dialog"][aria-label="Material details"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const background = app.container.querySelector<HTMLElement>(".nav-item")!;
    await act(async () => background.focus());
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await escape();
    expect(app.container.querySelector('[role="dialog"][aria-label="Material details"]')).toBeNull();
    expect(document.activeElement).toBe(row);
  });
});

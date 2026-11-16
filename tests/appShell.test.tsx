import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { click, escape, renderApp, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>> | undefined;
beforeEach(() => setupApp({ width: 1000 }));
afterEach(() => { app?.unmount(); app = undefined; });

describe("workspace inspector and route heading", () => {
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

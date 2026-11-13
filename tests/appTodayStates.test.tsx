import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, click, emitAppEvent, renderApp, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("Today request and empty states in the real application", () => {
  it("reports initial request failure without claiming successful emptiness, then retries", async () => {
    appApi.listDashboardResources.mockRejectedValueOnce(new Error("Offline"));
    app = await renderApp();
    const main = document.querySelector("main")!;
    expect(main.textContent).toContain("Could not load activity");
    expect(main.textContent).not.toContain("You're all caught up");
    expect(main.textContent).not.toContain("Nothing tracked yet");
    expect(main.textContent).not.toContain("No matches");
    await click(button("Try again"));
    expect(button("Show details for Lecture 4")).toBeTruthy();
    expect(main.textContent).not.toContain("Could not load activity");
  });
  it("explains a completed known-file baseline without showing false new rows or no-match advice", async () => {
    appApi.listDashboardEvents.mockResolvedValue([]);
    app = await renderApp();
    const main = document.querySelector("main")!;
    expect(main.querySelectorAll(".resource-row")).toHaveLength(0);
    expect(main.textContent).toContain("First scan recorded 1 file as known");
    expect(main.textContent).toContain("First scan complete");
    expect(main.textContent).not.toContain("No matches");
    expect(main.textContent).not.toContain("Nothing tracked yet");
    expect(main.textContent).not.toContain("1 new file");
    expect(appApi.markRead).not.toHaveBeenCalled();
  });

  it("distinguishes genuinely empty storage from an empty activity feed", async () => {
    appApi.listResources.mockResolvedValue([]);
    appApi.listDashboardResources.mockResolvedValue([]);
    appApi.listDashboardEvents.mockResolvedValue([]);
    app = await renderApp();
    const main = document.querySelector("main")!;
    expect(main.textContent).toContain("Nothing tracked yet");
    expect(main.textContent).not.toContain("You're all caught up");
    expect(main.textContent).not.toContain("No matches");
    await click(button("Sync now"));
    expect(appApi.syncNow).toHaveBeenCalledTimes(1);
  });

  it("describes successful empty activity with stored files as caught up", async () => {
    appApi.listDashboardResources.mockResolvedValue([]);
    appApi.listDashboardEvents.mockResolvedValue([]);
    app = await renderApp();
    expect(document.querySelector("main")?.textContent).toContain("You're all caught up");
    expect(document.querySelector("main")?.textContent).not.toContain("Nothing tracked yet");
  });

  it("shows no matches only after filtering, and keeps rows through a failed refresh", async () => {
    app = await renderApp();
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search activity"]')!;
    async function searchFor(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, value);
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    }
    await searchFor("unmatched worksheet");
    expect(document.querySelector("main")?.textContent).toContain("No matches");
    expect(document.querySelector("main")?.textContent).not.toContain("Nothing tracked yet");
    await searchFor("");
    expect(button("Show details for Lecture 4")).toBeTruthy();
    appApi.listDashboardResources.mockRejectedValueOnce(new Error("Offline"));
    await emitAppEvent("sync:done", {});
    expect(document.querySelector("main")?.textContent).toContain("Could not load activity");
    expect(button("Show details for Lecture 4")).toBeTruthy();
    expect(appApi.markRead).not.toHaveBeenCalled();
  });

});

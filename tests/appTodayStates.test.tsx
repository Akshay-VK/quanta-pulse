import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, click, emitAppEvent, renderApp, setupApp, change } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("Inbox request and empty states in the real application", () => {
  it("reports initial request failure without claiming successful emptiness, then retries", async () => {
    appApi.queryInbox.mockRejectedValue(new Error("Offline"));
    app = await renderApp();
    const main = document.querySelector("main")!;
    expect(main.textContent).toContain("Could not load Inbox");
    expect(main.textContent).not.toContain("You’re all caught up");
    expect(main.textContent).not.toContain("Nothing tracked yet");
    expect(main.textContent).not.toContain("No matches");
    appApi.queryInbox.mockResolvedValue({ items: [{ key: "resource:1", resourceId: 1, courseId: 1, latestEvent: change(), eventIds: [10], changeTypes: ["new"], unread: true }], total: 1, unreadTotal: 1, courseCounts: [] });
    await click(button("Retry Inbox"));
    expect(button("Show details for Lecture 4")).toBeTruthy();
    expect(main.textContent).not.toContain("Could not load Inbox");
  });
  it("shows an en dash for unread count when only the count query fails, while rows stay current", async () => {
    appApi.queryInbox.mockImplementation(async (filter = {}) => {
      if (Object.keys(filter).length === 0) throw new Error("Counts offline");
      return { items: [{ key: "resource:1", resourceId: 1, courseId: 1, latestEvent: change(), eventIds: [10], changeTypes: ["new"], unread: true }], total: 1, unreadTotal: 1, courseCounts: [] };
    });
    app = await renderApp();
    const main = document.querySelector("main")!;
    expect(button("Show details for Lecture 4")).toBeTruthy();
    expect(main.textContent).toContain("· – unread");
    expect(main.textContent).toContain("Sidebar counts may be out of date");
    expect(button("Inbox").querySelector(".nav-badge")?.textContent).toBe("–");
    expect(app.container.querySelector(".course-nav-count")?.textContent).toBe("–");
  });
  it("explains a completed known-file baseline without showing false new rows or no-match advice", async () => {
    appApi.listDashboardEvents.mockResolvedValue([]);
    appApi.dbInfo.mockResolvedValue({ path: "", sizeBytes: 0, courseCount: 1, resourceCount: 1, eventCount: 0, logDir: null });
    appApi.listHistoryScans.mockResolvedValue([{ id: 1, startedAt: "2026-11-14T00:00:00Z", completedAt: null, status: "ok", discoveredCount: 1, newCount: 0, updatedCount: 0, unavailableCount: 0, coursesScanned: 1, coursesFailed: 0, errorSummary: null, isBaseline: true }]);
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
    appApi.dbInfo.mockResolvedValue({ path: "", sizeBytes: 0, courseCount: 1, resourceCount: 0, eventCount: 0, logDir: null });
    appApi.listResources.mockResolvedValue([]);
    appApi.listDashboardResources.mockResolvedValue([]);
    appApi.listDashboardEvents.mockResolvedValue([]);
    app = await renderApp();
    const main = document.querySelector("main")!;
    expect(main.textContent).toContain("Nothing tracked yet");
    expect(main.textContent).not.toContain("You’re all caught up");
    expect(main.textContent).not.toContain("No matches");
    await click(button("Sync now"));
    expect(appApi.syncNow).toHaveBeenCalledTimes(1);
  });

  it("describes successful empty activity with stored files as caught up", async () => {
    appApi.listDashboardResources.mockResolvedValue([]);
    appApi.listDashboardEvents.mockResolvedValue([]);
    app = await renderApp();
    expect(document.querySelector("main")?.textContent).toContain("You’re all caught up");
    expect(document.querySelector("main")?.textContent).not.toContain("Nothing tracked yet");
  });

  it("shows no matches only after filtering, and keeps rows through a failed refresh", async () => {
    app = await renderApp();
    await click(button("Filter"));
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search Inbox"]')!;
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
    appApi.queryInbox.mockRejectedValue(new Error("Offline"));
    await emitAppEvent("sync:done", {});
    expect(document.querySelector("main")?.textContent).toContain("Showing saved results");
    expect(button("Show details for Lecture 4")).toBeTruthy();
    expect(appApi.markRead).not.toHaveBeenCalled();
  });

});

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, change, click, emitAppEvent, escape, renderApp, setupApp } from "./helpers/renderApp";
import type { ScanRun } from "../src/lib/types";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

const scan: ScanRun = {
  id: 31, startedAt: "2026-10-14T09:05:00Z", completedAt: "2026-10-14T09:06:00Z",
  status: "partial", discoveredCount: 12, newCount: 2, updatedCount: 3,
  unavailableCount: 1, coursesScanned: 4, coursesFailed: 1,
  errorSummary: "Course A: timeout; Course B: unavailable", isBaseline: false,
};

async function openHistory() {
  app = await renderApp();
  await emitAppEvent("ui:navigate", "history");
}

describe("History shared details", () => {
  it("inspects recorded changes, including events without a current resource, without acknowledging them", async () => {
    const historical = change({
      id: 41, resourceId: null, resourceTitle: null, title: "Removed handout",
      courseName: "Archived course", resourceType: "file", resourceUrl: "https://quanta.bits-pilani.ac.in/old.pdf",
    });
    appApi.listHistoryEvents.mockResolvedValue([historical]);
    await openHistory();

    await click(button("Show details for Removed handout"));
    expect(document.querySelectorAll(".peek")).toHaveLength(1);
    expect(document.querySelector(".peek-title")?.textContent).toBe("Removed handout");
    expect(document.querySelector(".peek")?.textContent).toContain("Archived course");
    expect(document.querySelector(".peek")?.textContent).toContain("old.pdf");
    expect(document.querySelector(".peek")?.textContent).not.toContain("Open local copy");
    expect(appApi.markAllRead).not.toHaveBeenCalled();
    expect(appApi.openExternal).not.toHaveBeenCalled();
  });

  it("moves between change and scan details in one panel and restores scan row focus", async () => {
    appApi.listHistoryScans.mockResolvedValue([scan]);
    await openHistory();
    const eventButton = button("Show details for Lecture 4");
    await click(eventButton);
    expect(document.querySelector(".peek-title")?.textContent).toBe("Lecture 4");

    await click(button("Scans"));
    expect(document.querySelector(".peek")).toBeNull();
    const scanButton = document.querySelector<HTMLButtonElement>('[aria-label^="Show details for scan of"]');
    if (!scanButton) throw new Error(`Missing scan selector in: ${document.body.textContent}`);
    await click(scanButton);
    expect(document.querySelectorAll(".peek")).toHaveLength(1);
    expect(document.querySelector(".peek-title")?.textContent).toMatch(/^Scan of/);
    expect(document.querySelector(".peek")?.textContent).toContain("Course A: timeout; Course B: unavailable");
    expect(document.querySelector(".peek")?.textContent).toContain("3/4");
    expect(document.querySelector(".data-table tr.selected")).toBeTruthy();
    await escape();
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(scanButton);
  });

  it("clears scan details when switching back to changes", async () => {
    appApi.listHistoryScans.mockResolvedValue([scan]);
    await openHistory();
    await click(button("Scans"));
    await click(document.querySelector<HTMLButtonElement>('[aria-label^="Show details for scan of"]')!);
    await click(button("Changes"));
    expect(document.querySelector(".peek")).toBeNull();
  });

  it("keeps prior rows after a failed refresh and offers a retry", async () => {
    await openHistory();
    appApi.listHistoryEvents.mockRejectedValueOnce(new Error("history unavailable"));
    await emitAppEvent("sync:done", {});
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("history unavailable");
    expect(button("Show details for Lecture 4").isConnected).toBe(true);

    await click(button("Retry History"));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(button("Show details for Lecture 4").isConnected).toBe(true);
  });

  it("dismisses clear confirmation before shared details and preserves cancel semantics", async () => {
    await openHistory();
    await click(button("Show details for Lecture 4"));
    const historyActionButtons = app.container.querySelectorAll<HTMLButtonElement>('[aria-label="History actions"]');
    const historyActions = historyActionButtons[historyActionButtons.length - 1];
    historyActions.focus();
    await act(async () => { historyActions.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true })); });
    await click(historyActions);
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    await click(document.querySelector<HTMLElement>('[role="menuitem"]')!);
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();

    await escape();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector(".peek")).toBeTruthy();
    expect(appApi.clearHistoryActivity).not.toHaveBeenCalled();
  });
});

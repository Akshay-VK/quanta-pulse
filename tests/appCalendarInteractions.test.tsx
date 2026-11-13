import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { appApi, button, change, click, flushApp, renderApp, setupApp } from "./helpers/renderApp";

describe("Calendar details in the application", () => {
  let app: Awaited<ReturnType<typeof renderApp>> | undefined;

  beforeEach(() => setupApp());
  afterEach(() => app?.unmount());

  it("opens the recorded event in shared details without marking it read", async () => {
    const event = change({ id: 41, resourceId: null, resourceTitle: null, title: "New calendar event", detectedAt: new Date().toISOString(), read: false });
    appApi.eventsRange.mockResolvedValue([event]);
    appApi.dailyDigest.mockResolvedValue({
      date: new Date().toLocaleDateString("en-CA"), newCount: 1, updatedCount: 0,
      announcementCount: 0, deadlineCount: 0, unavailableCount: 0, coursesFailed: 0,
      lastSuccessAt: null, items: [event],
    });
    app = await renderApp();
    await click(button("Calendar"));
    await flushApp();

    await click(button("Show details for New calendar event"));

    expect(document.querySelector(".peek")?.textContent).toContain("New calendar event");
    expect(appApi.markRead).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.querySelector(".peek-title"));
  });

  it("clears Calendar details on day navigation and returns focus to the day heading", async () => {
    const event = change({ id: 41, resourceId: null, resourceTitle: null, title: "New calendar event", detectedAt: new Date().toISOString() });
    appApi.eventsRange.mockResolvedValue([event]);
    appApi.dailyDigest.mockResolvedValue({
      date: new Date().toLocaleDateString("en-CA"), newCount: 1, updatedCount: 0,
      announcementCount: 0, deadlineCount: 0, unavailableCount: 0, coursesFailed: 0,
      lastSuccessAt: null, items: [event],
    });
    app = await renderApp();
    await click(button("Calendar"));
    await click(button("Show details for New calendar event"));
    const selectedDay = document.querySelector<HTMLButtonElement>(".cal-day.selected")!;

    act(() => {
      selectedDay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    await flushApp();

    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(".cal-day.selected"));
  });
});

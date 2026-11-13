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

  it("highlights only the selected recorded event when resources are shared", async () => {
    const first = change({ id: 41, resourceId: 1, resourceTitle: "First event", detectedAt: new Date().toISOString() });
    const second = change({ ...first, id: 42, resourceTitle: "Second event" });
    appApi.dailyDigest.mockResolvedValue({
      date: new Date().toLocaleDateString("en-CA"), newCount: 2, updatedCount: 0,
      announcementCount: 0, deadlineCount: 0, unavailableCount: 0, coursesFailed: 0,
      lastSuccessAt: null, items: [first, second],
    });
    app = await renderApp();
    await click(button("Calendar"));
    await click(button("Show details for Second event"));
    expect(button("Show details for Second event").closest(".resource-row")?.classList.contains("selected")).toBe(true);
    expect(button("Show details for First event").closest(".resource-row")?.classList.contains("selected")).toBe(false);
  });

  it("clears a removed event after retrying a retained day digest and focuses the day heading", async () => {
    const event = change({ id: 41, resourceId: null, resourceTitle: "Retained event", detectedAt: new Date().toISOString() });
    const digest = {
      date: new Date().toLocaleDateString("en-CA"), newCount: 1, updatedCount: 0,
      announcementCount: 0, deadlineCount: 0, unavailableCount: 0, coursesFailed: 0,
      lastSuccessAt: null, items: [event],
    };
    appApi.dailyDigest.mockResolvedValueOnce(digest)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ ...digest, items: [] });
    app = await renderApp();
    await click(button("Calendar"));
    async function move(key: string) {
      await act(async () => {
        document.querySelector(".cal-day.selected")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
      await flushApp();
    }
    await move("ArrowRight");
    await move("ArrowLeft");
    await click(button("Show details for Retained event"));
    expect(document.querySelector(".peek")).toBeTruthy();
    await click(button("Retry day"));
    expect(document.body.textContent).toContain("No activity on this day");
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(".cal-panel-title"));
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

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, change, click, emitAppEvent, escape, renderApp, setupApp } from "./helpers/renderApp";
import { course } from "./helpers/data";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("App Library interactions", () => {
  it("keeps sidebar course order independent of unread counts and API order", async () => {
    const second = { ...course, id: 2, shortName: "BIO F111", name: "BIO F111", monitoringStatus: "paused" as const };
    appApi.listCourses.mockResolvedValue([second, course]);
    app = await renderApp();
    const nav = document.querySelector(".course-nav-list")!;
    expect([...nav.querySelectorAll(".course-nav-code")].map((node) => node.textContent)).toEqual(["BIO F111", "MATH F111"]);
    appApi.unreadCount.mockResolvedValue(20);
    await emitAppEvent("sync:done", {});
    expect([...document.querySelectorAll(".course-nav-code")].map((node) => node.textContent)).toEqual(["BIO F111", "MATH F111"]);
    expect(button("All courses")).toBeTruthy();
  });

  it("selects an All files row into shared details without opening it", async () => {
    app = await renderApp();
    await click(button("Library"));
    await click(button("All files"));
    await click(document.querySelector("tbody tr") as HTMLElement);
    expect(document.querySelector(".peek-title")?.textContent).toBe("Lecture 4");
    expect(appApi.mirrorLocalFile).toHaveBeenCalledWith(1);
    expect(appApi.openExternal).not.toHaveBeenCalled();
  });

  it("offers a keyboard-reachable All files details button and restores it on Escape", async () => {
    app = await renderApp();
    await click(button("Library"));
    await click(button("All files"));
    const origin = button("Show details for Lecture 4");
    origin.focus();
    expect(origin.tabIndex).toBe(0);
    // Native button activation is synthesized by browsers, not jsdom.
    await click(origin);
    expect(document.querySelector(".peek-title")?.textContent).toBe("Lecture 4");
    expect(appApi.openExternal).not.toHaveBeenCalled();
    expect(appApi.markRead).not.toHaveBeenCalled();
    await escape();
    expect(document.activeElement).toBe(origin);
  });

  it("clears All files details when its tab disappears", async () => {
    app = await renderApp();
    await click(button("Library"));
    await click(button("All files"));
    await click(button("Show details for Lecture 4"));
    await click(button("Courses"));
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("main h1"));
  });

  it("clears course details when changing between Contents and Activity", async () => {
    appApi.eventsRange.mockResolvedValue([change({ title: "Course activity", resourceTitle: "Course activity" })]);
    app = await renderApp();
    await click(button("MATH F111"));
    await click(document.querySelector<HTMLElement>('[role="treeitem"]:not([aria-expanded])')!);
    expect(document.querySelector(".peek")).toBeTruthy();
    await click(button("Activity"));
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("main h1"));
    await click(button("Show details for Course activity"));
    await click(button("Contents"));
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("main h1"));
  });

  it("shows a retryable Library error instead of an empty course list", async () => {
    appApi.listCourses.mockRejectedValueOnce("Offline").mockResolvedValueOnce([course]);
    app = await renderApp();
    await click(button("Library"));
    expect(document.body.textContent).toContain("Offline");
    expect(document.body.textContent).not.toContain("No courses found");
    await click(button("Retry"));
    expect(document.body.textContent).not.toContain("Offline");
    expect(document.body.textContent).toContain("MATH F111");
  });

  it("selects a tree file with Enter and shows course activity details", async () => {
    appApi.eventsRange.mockResolvedValue([change({ resourceId: null, resourceUrl: null, sourcePageUrl: "https://quanta.bits-pilani.ac.in/course/view.php?id=1", resourceTitle: null, title: "Recorded without a resource", resourceType: null })]);
    app = await renderApp();
    await click(button("MATH F111"));
    const file = document.querySelector<HTMLElement>('[role="treeitem"]:not([aria-expanded])')!;
    await click(file);
    expect(document.querySelector(".peek-title")?.textContent).toBe("Lecture 4");
    expect(appApi.openExternal).not.toHaveBeenCalled();
    await click(button("Close details"));
    await act(async () => {
      file.focus();
      file.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector(".peek-title")?.textContent).toBe("Lecture 4");
    await click(button("Activity"));
    await click(button("Show details for Recorded without a resource"));
    expect(document.querySelector(".peek-title")?.textContent).toBe("Recorded without a resource");
    expect(document.querySelector(".peek")?.textContent).toContain("Upload date unavailable");
    expect(document.querySelector(".peek")?.textContent).toContain("Open Quanta page");
  });
});

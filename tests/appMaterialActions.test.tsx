import type { LocalFile } from "../src/lib/types";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, change, click, deferred, escape, emitAppEvent, renderApp, resource, setupApp, course } from "./helpers/renderApp";

const saved: LocalFile = { resourceId: 1, relPath: "lecture.pdf", path: "/files/lecture.pdf", sizeBytes: 12, mime: null, sha256: null, status: "ok", error: null };

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());
async function input(label: string, value: string) {
  await act(async () => {
    const node = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(label: string, text: string) {
  const trigger = button(label);
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.trim() === text)!;
  expect(option).toBeTruthy();
  await act(async () => { option.focus(); option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
}

describe("App shared material destinations", () => {
  for (const surface of ["Inbox", "All files", "Tree", "Activity", "History", "Calendar"]) {
    it(`downloads and opens from ${surface}, while selection stays local and unread`, async () => {
      const event = change({ detectedAt: new Date().toISOString() });
      appApi.eventsRange.mockResolvedValue([event]);
      appApi.dailyDigest.mockResolvedValue({ date: new Date().toLocaleDateString("en-CA"), newCount: 1, updatedCount: 0, announcementCount: 0, deadlineCount: 0, unavailableCount: 0, coursesFailed: 0, lastSuccessAt: null, items: [event] });
      appApi.ensureLocal.mockResolvedValue(saved);
      app = await renderApp();
      if (surface === "All files") { await click(button("Library")); await click(button("All files")); }
      if (surface === "Tree" || surface === "Activity") { await click(document.querySelector<HTMLButtonElement>(".course-nav-item")!); if (surface === "Activity") await click(button("Activity")); }
      if (surface === "History") await emitAppEvent("ui:navigate", "history");
      if (surface === "Calendar") { await click(button(surface)); await click(button("Activity calendar")); }
      const row = document.querySelector<HTMLElement>(surface === "All files" ? "tbody tr" : surface === "Tree" ? '[role="treeitem"]:not([aria-expanded])' : ".resource-row")!;
      expect(row).toBeTruthy();
      await click(row.querySelector<HTMLButtonElement>('[aria-label^="Show details"]') ?? row);
      expect(document.querySelector(".peek-title")?.textContent).toBeTruthy();
      expect(appApi.openExternal).not.toHaveBeenCalled();
      expect(appApi.markRead).not.toHaveBeenCalled();
      await escape();
      const trigger = button(surface === "All files" ? "Actions for Lecture 4" : "More actions", row);
      await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
      const menu = document.querySelector('[role="menu"]')!;
      expect(menu.textContent).toContain("Download and open");
      expect(menu.textContent).toContain("Preview");
      if (surface === "All files") expect(menu.textContent).toContain("Copy link");
      const quanta = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Open in Quanta")!;
      await click(quanta);
      expect(appApi.openExternal).toHaveBeenCalledWith(resource().sourcePageUrl);
      expect(appApi.ensureLocal).not.toHaveBeenCalled();
      expect(document.querySelector(".peek")).toBeNull();
      appApi.openExternal.mockClear();
      await click(button("Download and open", row));
      expect(appApi.ensureLocal).toHaveBeenCalledWith(1);
      expect(appApi.openLocalFile).toHaveBeenCalledWith(1);
      expect(appApi.openExternal).not.toHaveBeenCalled();
      expect(document.querySelector(".peek")).toBeNull();
    });
  }

  it("guards duplicate download, reports failure and allows retry", async () => {
    const pending = deferred<LocalFile>();
    appApi.ensureLocal.mockReturnValueOnce(pending.promise).mockResolvedValue(saved);
    app = await renderApp();
    const action = button("Download and open", document.querySelector(".resource-row")!);
    await click(action); await click(action);
    expect(appApi.ensureLocal).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("Offline")));
    expect(document.body.textContent).toContain("Could not download and open");
    expect(appApi.openLocalFile).not.toHaveBeenCalled();
    await click(button("Download and open", document.querySelector(".resource-row")!));
    expect(appApi.openLocalFile).toHaveBeenCalledWith(1);
  });

  it("retains Library query/tab and filters through course and route navigation", async () => {
    app = await renderApp();
    await click(button("Library")); await click(button("All files"));
    await input("Search library", "Lecture");
    await choose("Filter by course", "MATH F111");
    await choose("Filter by file type", "pdf (1)");
    await click(button("Title", document.querySelector("thead")!));
    const main = document.querySelector("main")!; main.scrollTop = 137;
    main.dispatchEvent(new Event("scroll"));
    await click(document.querySelector<HTMLButtonElement>(".course-nav-item")!);
    await click(button("Inbox")); await click(button("Library"));
    expect(document.querySelector<HTMLInputElement>('[aria-label="Search library"]')?.value).toBe("Lecture");
    expect(document.querySelector('[aria-label="All course files"]')).toBeTruthy();
    expect(main.scrollTop).toBe(137);
    expect(button("Filter by course").textContent).toContain("MATH F111");
    expect(button("Filter by file type").textContent).toContain("pdf");
    expect(document.querySelector('th[aria-sort="ascending"]')?.textContent).toBe("Title");
  });

  it("keeps external links out of local destinations", async () => {
    appApi.listResources.mockResolvedValue([resource({ isExternal: true })]);
    app = await renderApp();
    const row = document.querySelector(".resource-row")!;
    await click(button("Open in Quanta", row));
    expect(appApi.openExternal).toHaveBeenCalledWith(resource().sourcePageUrl ?? resource().url);
    expect(appApi.ensureLocal).not.toHaveBeenCalled();
  });
});

it("preserves course query, sorting, type, expansion and scroll across courses and refresh", async () => {
  const item = resource({ sectionPath: ["Week 4", "Lectures"] });
  appApi.listResources.mockResolvedValue([item]);
  app = await renderApp();
  await click(document.querySelector<HTMLButtonElement>(".course-nav-item")!);
  const collapse = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.getAttribute("aria-label") === "Collapse Week 4");
  if (collapse) await click(collapse);
  await input("Search resources in this course", "Lecture");
  await choose("Sort resources", "Name (A–Z)");
  await choose("Filter by file type", "pdf (1)");
  const main = document.querySelector("main")!;
  main.scrollTop = 215; main.dispatchEvent(new Event("scroll"));
  await click(button("Inbox"));
  await click(document.querySelector<HTMLButtonElement>(".course-nav-item")!);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Search resources in this course"]')?.value).toBe("Lecture");
  expect(button("Sort resources").textContent).toContain("Name (A–Z)");
  expect(button("Filter by file type").textContent).toContain("pdf");
  expect(main.scrollTop).toBe(215);
  await click(button("Clear search"));
  expect(button("Expand Week 4")).toBeTruthy();
  await emitAppEvent("sync:done", {});
  expect(button("Expand Week 4")).toBeTruthy();
});

it("keeps a missing disk copy distinct from an unavailable source and offers explicit redownload", async () => {
  appApi.listResources.mockResolvedValue([resource({ availabilityStatus: "unavailable" })]);
  appApi.mirrorLocalFiles.mockResolvedValue([{ resourceId: 1, status: "kept", error: null }]);
  appApi.mirrorLocalFile.mockResolvedValue(null);
  app = await renderApp();
  const row = document.querySelector(".resource-row")!;
  await click(button("Open saved copy", row));
  expect(appApi.openLocalFile).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Saved copy is missing from disk");
  expect(button("Download and open", row)).toBeTruthy();
});

it("keeps both orphan recorded links keyboard accessible and returns menu focus", async () => {
  const event = change({ resourceId: null, resourceTitle: "Archived material", sourcePageUrl: "https://quanta.bits-pilani.ac.in/archived-page", resourceUrl: "https://quanta.bits-pilani.ac.in/archived.pdf" });
  appApi.listHistoryEvents.mockResolvedValue([event]);
  app = await renderApp();
  await emitAppEvent("ui:navigate", "history");
  const row = document.querySelector(".resource-row")!;
  const trigger = button("More actions", row);
  trigger.focus();
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("Open recorded file in Quanta");
  await escape();
  expect(document.activeElement).toBe(trigger);
  await click(button("Open in Quanta", row));
  expect(appApi.openExternal).toHaveBeenCalledWith(event.sourcePageUrl);
  expect(appApi.ensureLocal).not.toHaveBeenCalled();
});

it("keeps technical saved-file facts expandable without duplicating the primary action", async () => {
  appApi.mirrorLocalFile.mockResolvedValue({ resourceId: 1, relPath: "lecture.pdf", path: "/files/lecture.pdf", sizeBytes: 42, mime: null, sha256: null, status: "ok", error: null });
  app = await renderApp();
  await click(button("Show details for Lecture 4"));
  const panel = document.querySelector(".peek")!;
  expect([...panel.querySelectorAll("button")].filter((node) => node.textContent === "Open saved copy")).toHaveLength(1);
  const technical = panel.querySelector<HTMLDetailsElement>("details")!;
  expect(technical).toBeTruthy();
  expect(technical.open).toBe(false);
  await click(technical.querySelector("summary")!);
  expect(technical.open).toBe(true);
  expect(technical.textContent).toContain("/files/lecture.pdf");
});

it("isolates course context and ignores a late request from the course left behind", async () => {
  const second = { ...course, id: 2, shortName: "CS F111", name: "CS F111" };
  const items = [resource(), resource({ id: 2, courseId: 2, title: "Lab notes" })];
  const late = deferred<ReturnType<typeof resource>[]>();
  appApi.listCourses.mockResolvedValue([course, second]);
  let delayFirst = false;
  appApi.listResources.mockImplementation(async (filter) => {
    if (filter?.courseId === 1 && delayFirst) return late.promise;
    return filter?.courseId ? items.filter((item) => item.courseId === filter.courseId) : items;
  });
  app = await renderApp();
  const courseButton = (code: string) => [...document.querySelectorAll<HTMLButtonElement>(".course-nav-item")].find((node) => node.querySelector(".course-nav-code")?.textContent === code)!;
  await click(courseButton("MATH F111"));
  await input("Search resources in this course", "Lecture");
  await click(button("Inbox"));
  delayFirst = true;
  await click(courseButton("MATH F111"));
  await click(courseButton("CS F111"));
  await act(async () => late.resolve([resource({ title: "Late obsolete material" })]));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Search resources in this course"]')?.value).toBe("");
  expect(document.querySelector("main")?.textContent).not.toContain("Late obsolete material");
  delayFirst = false;
  await click(courseButton("MATH F111"));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Search resources in this course"]')?.value).toBe("Lecture");
});

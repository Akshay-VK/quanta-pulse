// Course hub scenario test: each course row opens its in-app library, the
// row menu holds the monitoring actions, and search filters the list.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Course, Resource } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: {
    listResources: vi.fn(),
    setMonitoring: vi.fn(),
    rebuildBaseline: vi.fn(),
    previewResource: vi.fn(),
  },
}));

import { api } from "../src/lib/api";
import CourseList from "../src/views/library/CourseList";
import { TooltipProvider } from "../src/components/ui/Tooltip";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function buildCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    externalCourseId: "math-f211",
    name: "Discrete Mathematics",
    shortName: "MATH F211",
    url: "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    firstSeenAt: "2026-09-01T06:00:00Z",
    lastScannedAt: "2026-10-12T06:00:00Z",
    lastScanStatus: "ok",
    monitoringStatus: "monitored",
    resourceCount: 12,
    ...overrides,
  };
}

function buildResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 7,
    externalResourceId: "mod:resource:7",
    courseId: 1,
    courseName: "Discrete Mathematics",
    title: "Lecture 04 — Graph theory",
    url: "https://quanta.bits-pilani.ac.in/pluginfile.php/1/mod_resource/content/0/lecture04.pdf",
    sourcePageUrl: "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    resourceType: "pdf",
    uploadedAt: "2026-10-10T09:00:00+05:30",
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: "2026-10-10T09:05:00+05:30",
    lastSeenAt: "2026-10-11T09:05:00+05:30",
    lastCheckedAt: "2026-10-12T06:00:00+05:30",
    contentFingerprint: "fp",
    availabilityStatus: "available",
    sizeBytes: 2048,
    section: "Week 1",
    isExternal: false,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.listResources).mockReset();
  vi.mocked(api.setMonitoring).mockReset();
  vi.mocked(api.rebuildBaseline).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderCourses(
  courses: Course[],
  options: {
    resources?: Resource[];
    search?: string;
    unreadByCourse?: Map<number, number>;
    onOpenCourse?: (course: Course) => void;
    onOpen?: (url: string) => void;
    onChanged?: () => void;
    onSyncNow?: () => void;
  } = {},
) {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <CourseList
          courses={courses}
          resources={options.resources ?? []}
          search={options.search ?? ""}
          unreadByCourse={options.unreadByCourse ?? null}
          onOpenCourse={options.onOpenCourse ?? (() => {})}
          onOpen={options.onOpen ?? (() => {})}
          onChanged={options.onChanged ?? (() => {})}
          onSyncNow={options.onSyncNow ?? (() => {})}
        />
      </TooltipProvider>,
    );
  });
}

function row(course: Course): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>(".course-row")].find((el) =>
    el.textContent?.includes(course.name),
  );
  if (!found) throw new Error(`Missing course row for ${course.name}`);
  return found;
}

function rowButtons(course: Course): HTMLButtonElement[] {
  return [...row(course).querySelectorAll("button")] as HTMLButtonElement[];
}

function menuButton(course: Course): HTMLButtonElement {
  const button = rowButtons(course).find(
    (el) => el.getAttribute("aria-label") === `Actions for ${course.name}`,
  );
  if (!button) throw new Error(`Missing actions menu for ${course.name}`);
  return button;
}

async function openMenu(course: Course) {
  // Radix menu triggers toggle on pointerdown, not click. jsdom has no
  // PointerEvent, and MouseEvent carries the button/ctrlKey Radix checks.
  await act(async () => {
    menuButton(course).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
  });
}

/** Menu items live in a Radix portal on document.body, outside the container. */
function menuItem(label: string): HTMLButtonElement {
  const item = [...document.body.querySelectorAll(".menu-item")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!item) throw new Error(`Missing menu item: ${label}`);
  return item as HTMLButtonElement;
}

async function clickMenuItem(label: string) {
  await act(async () => menuItem(label).click());
}

async function clickDialogButton(text: string) {
  const dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
  if (!dialog) throw new Error("Missing confirm dialog");
  await act(async () => {
    [...dialog.querySelectorAll("button")].find((b) => b.textContent === text)?.click();
  });
}

describe("CourseList", () => {
  it("renders one row per course with its dot, file count, new badge and status", async () => {
    await renderCourses([buildCourse(), buildCourse({ id: 2, name: "Physics", shortName: "PHYS F111", url: "https://quanta.bits-pilani.ac.in/course/view.php?id=2" })]);
    expect(container.querySelectorAll(".course-row")).toHaveLength(2);
    expect(container.textContent).toContain("Discrete Mathematics");
    expect(container.textContent).toContain("Physics");
    expect(container.textContent).toContain("Monitoring");
    expect(container.querySelector(".course-row .course-dot")).toBeTruthy();
    expect(container.textContent).toContain("12 files");
    // The raw name equals the display name here, so there is no second line.
    expect(container.querySelector(".course-row-code")).toBeNull();
  });

  it("shows unread badges from the unread map and file counts in mono", async () => {
    await renderCourses([buildCourse()], {
      unreadByCourse: new Map([[1, 3]]),
      resources: [buildResource()],
    });
    const found = container.querySelector(".course-row") as HTMLElement;
    expect(found.textContent).toContain("3 new");
    expect(found.querySelector(".course-row-stat")?.textContent).toBe("12 files");
  });

  it("opens the course page from the row without fetching resources itself", async () => {
    const onOpenCourse = vi.fn();
    await renderCourses([buildCourse()], { onOpenCourse });
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) =>
        b.getAttribute("aria-label")?.startsWith("Open Discrete Mathematics"),
      )!.click();
    });
    expect(onOpenCourse).toHaveBeenCalledWith(buildCourse());
    expect(api.listResources).not.toHaveBeenCalled();
  });

  it("filters rows by search and shows the empty state when nothing matches", async () => {
    await renderCourses([buildCourse(), buildCourse({ id: 2, name: "Physics", shortName: "PHYS F111", externalCourseId: "phys-f111", url: "https://quanta.bits-pilani.ac.in/course/view.php?id=2" })]);

    await renderCourses([buildCourse(), buildCourse({ id: 2, name: "Physics", shortName: "PHYS F111", externalCourseId: "phys-f111", url: "https://quanta.bits-pilani.ac.in/course/view.php?id=2" })], { search: "phys" });
    expect(container.querySelectorAll(".course-row")).toHaveLength(1);
    expect(container.textContent).toContain("Physics");

    await renderCourses([buildCourse()], { search: "no-such-course" });
    expect(container.querySelector(".course-row")).toBeNull();
    expect(container.textContent).toContain("No courses found");
    expect(container.textContent).toContain("Pulse discovers your courses on the first scan");
  });

  it("shows the empty state when there are no courses at all", async () => {
    const onSyncNow = vi.fn();
    await renderCourses([], { onSyncNow });
    expect(container.textContent).toContain("No courses found");
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Sync now")?.click();
    });
    expect(onSyncNow).toHaveBeenCalledOnce();
  });

  it("pauses and resumes monitoring from the row menu", async () => {
    await renderCourses([buildCourse()]);
    await openMenu(buildCourse());
    await clickMenuItem("Pause monitoring");
    expect(api.setMonitoring).toHaveBeenCalledWith(1, "paused");

    await renderCourses([buildCourse({ monitoringStatus: "paused" })]);
    await openMenu(buildCourse({ monitoringStatus: "paused" }));
    await clickMenuItem("Resume monitoring");
    expect(api.setMonitoring).toHaveBeenCalledWith(1, "monitored");
  });

  it("rebases through a confirmation dialog", async () => {
    const onChanged = vi.fn();
    await renderCourses([buildCourse()], { onChanged });
    await openMenu(buildCourse());
    await clickMenuItem("Re-baseline course…");
    expect(api.rebuildBaseline).not.toHaveBeenCalled();
    await clickDialogButton("Re-baseline");
    expect(api.rebuildBaseline).toHaveBeenCalledWith(1);
    expect(onChanged).toHaveBeenCalled();
  });

  it("links to the real Quanta course homepage from the menu", async () => {
    const onOpen = vi.fn();
    await renderCourses([buildCourse()], { onOpen });
    await openMenu(buildCourse());
    await clickMenuItem("Open Quanta course");
    expect(onOpen).toHaveBeenCalledWith(
      "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    );
  });

  it("shows Paused and Last scan failed status pills", async () => {
    await renderCourses([
      buildCourse({ monitoringStatus: "paused" }),
      buildCourse({ id: 2, name: "Physics", shortName: "PHYS F111", externalCourseId: "phys-f111", url: "https://quanta.bits-pilani.ac.in/course/view.php?id=2", lastScanStatus: "error" }),
    ]);
    expect(container.textContent).toContain("Paused");
    expect(container.textContent).toContain("Last scan failed");
    expect(container.querySelector(".status-pill.warn")).toBeTruthy();
    expect(container.querySelector(".status-pill.error")).toBeTruthy();
  });
});

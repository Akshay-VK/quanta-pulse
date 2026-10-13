// Course hub scenario test: each course row expands to an internal library
// fetched on demand, the course name never navigates, and the separate
// controls (Pause / Re-baseline / Open Quanta Course) stay independent.

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
import CoursesView from "../src/views/CoursesView";

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
  vi.mocked(api.listResources).mockReset().mockResolvedValue([]);
  vi.mocked(api.setMonitoring).mockReset();
  vi.mocked(api.rebuildBaseline).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCourses(courses: Course[], onOpen = vi.fn()) {
  await act(async () => {
    root.render(
      <CoursesView
        courses={courses}
        resources={[]}
        sync={null}
        onChanged={() => {}}
        onOpen={onOpen}
      />,
    );
  });
  await flush();
  return onOpen;
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

describe("CoursesView", () => {
  it("renders one card per course with its code, count and status", async () => {
    await renderCourses([buildCourse()]);
    expect(container.textContent).toContain("Discrete Mathematics");
    expect(container.textContent).toContain("MATH F211");
    expect(container.textContent).toContain("12 resources");
    expect(container.textContent).toContain("Monitoring");
    expect(container.querySelector(".course-card")).toBeTruthy();
  });

  it("opens the internal library from the course name and fetches its resources", async () => {
    vi.mocked(api.listResources).mockResolvedValue([buildResource()]);
    await renderCourses([buildCourse()]);

    expect(api.listResources).not.toHaveBeenCalled();
    const title = container.querySelector(".course-title-btn") as HTMLButtonElement;
    await act(async () => title.click());
    await flush();

    expect(api.listResources).toHaveBeenCalledWith({ courseId: 1, limit: 2000 });
    expect(container.querySelector(".course-tree-navigate")).toBeTruthy();
    expect(container.textContent).not.toContain("Lecture 04 — Graph theory");
    await act(async () => (container.querySelector(".course-tree-navigate") as HTMLButtonElement).click());
    expect(container.textContent).toContain("Lecture 04 — Graph theory");
    // Grouped by category, with the breadcrumb inside the expanded card.
    expect(container.textContent).toContain("PDFs");
    expect(container.querySelector(".breadcrumb")?.textContent).toContain("Discrete Mathematics");
  });

  it("keeps Pause and Re-baseline from opening the library", async () => {
    await renderCourses([buildCourse()]);

    await act(async () => buttonByText("Pause")!.click());
    await flush();
    expect(api.setMonitoring).toHaveBeenCalledWith(1, "paused");
    expect(api.listResources).not.toHaveBeenCalled();
    expect(container.querySelector(".course-body")).toBeNull();
  });

  it("links to the real Quanta course homepage, and flags a missing one", async () => {
    const onOpen = vi.fn();
    await renderCourses([buildCourse()], onOpen);

    await act(async () => {
      const link = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Open Quanta Course"),
      ) as HTMLButtonElement;
      link.click();
    });
    expect(onOpen).toHaveBeenCalledWith(
      "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    );

    await renderCourses([buildCourse({ url: "" })], onOpen);
    expect(container.textContent).toContain("Open Quanta Course unavailable");
  });

  it("shows a clear empty state when no resources were discovered", async () => {
    vi.mocked(api.listResources).mockResolvedValue([]);
    await renderCourses([buildCourse()]);
    const title = container.querySelector(".course-title-btn") as HTMLButtonElement;
    await act(async () => title.click());
    await flush();
    expect(container.textContent).toContain("No resources have been discovered");
  });
});

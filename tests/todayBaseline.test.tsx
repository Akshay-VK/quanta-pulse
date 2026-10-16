// Today is a feed of change events (Task 6): the baseline scan's discovered
// files are counted once in a muted note, never listed as dead rows, and every
// listed row carries its course pill.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import TodayView from "../src/views/TodayView";
import { TooltipProvider } from "../src/components/ui/Tooltip";
import { registerCourseLabels } from "../src/lib/courseName";
import type { Course, Resource } from "../src/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};
Element.prototype.setPointerCapture = () => {};

function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    externalResourceId: "r1",
    courseId: 1,
    courseName: "Discrete Maths",
    title: "Lecture 4",
    url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
    sourcePageUrl: null,
    resourceType: "PDF",
    uploadedAt: "2026-10-14T09:05:00Z",
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: "2026-10-14T09:05:00Z",
    lastSeenAt: "2026-10-14T09:05:00Z",
    lastCheckedAt: "2026-10-14T10:00:00Z",
    contentFingerprint: "abc",
    availabilityStatus: "available",
    sizeBytes: null,
    section: null,
    isExternal: false,
    ...overrides,
  };
}

const COURSE: Course = {
  id: 1,
  externalCourseId: "1124",
  name: "1124_MATH_INSTR_MATH F111",
  shortName: "MATH F111",
  url: "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
  firstSeenAt: "2026-09-01T00:00:00Z",
  lastScannedAt: null,
  lastScanStatus: null,
  monitoringStatus: "monitored",
  resourceCount: 2,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  // The shell derives display names during render; mirror that here.
  registerCourseLabels([COURSE]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  resources: Resource[],
  handlers: { onOpenCourse?: (id: number) => void; onSelect?: () => void } = {},
) {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <TodayView
          resources={resources}
          hasStoredResources
          courses={[COURSE]}
          eventKinds={new Map([[1, new Set(["new"])]])}
          unreadIds={new Set([1])}
          lastSyncLabel="4 min ago"
          loading={false}
          error={null}
          onRetry={() => {}}
          selectedId={null}
          onSelect={handlers.onSelect ?? (() => {})}
          onOpen={() => {}}
          onOpenLocal={() => {}}
          onPreview={() => {}}
          onToggleRead={() => {}}
          onMarkAllRead={() => {}}
          onClearActivity={() => Promise.resolve()}
          onSyncNow={() => {}}
          onOpenCourse={handlers.onOpenCourse ?? (() => {})}
        />
      </TooltipProvider>,
    );
  });
}

function titles(): string[] {
  return [...container.querySelectorAll(".row-title")].map((el) => el.textContent ?? "");
}

describe("Today lists change events only", () => {
  it("lists the changed file and hides the baseline one", async () => {
    await render([resource(), resource({ id: 2, title: "Syllabus", externalResourceId: "r2" })]);
    expect(titles()).toEqual(["Lecture 4"]);
  });

  it("reports the hidden baseline files once, in the muted note", async () => {
    await render([
      resource(),
      resource({ id: 2, title: "Syllabus", externalResourceId: "r2" }),
      resource({ id: 3, title: "Timetable", externalResourceId: "r3" }),
    ]);
    expect(container.querySelector(".baseline-note")?.textContent).toBe(
      "First scan recorded 2 files as known",
    );
  });

  it("omits the note when nothing is baseline", async () => {
    await render([resource()]);
    expect(container.querySelector(".baseline-note")).toBeNull();
  });

  it("counts the summary from the live set, not the whole table", async () => {
    await render([
      resource(),
      resource({ id: 2, title: "Syllabus", externalResourceId: "r2" }),
    ]);
    // One new file; the hidden baseline file must not inflate the counts.
    expect(container.querySelector(".page-summary")?.textContent).toBe("1 new file.");
  });

  it("gives every listed row its course pill", async () => {
    await render([resource()]);
    const pill = container.querySelector(".resource-row .course-pill");
    expect(pill?.textContent).toContain("MATH F111");
    expect(pill?.querySelector(".course-dot")).toBeTruthy();
  });

  it("opens the course from the pill without selecting the row", async () => {
    const onOpenCourse = vi.fn();
    const onSelect = vi.fn();
    await render([resource()], { onOpenCourse, onSelect });
    const pill = container.querySelector<HTMLButtonElement>(".resource-row .course-pill");
    expect(pill?.tagName).toBe("BUTTON");
    await act(async () => pill?.click());
    expect(onOpenCourse).toHaveBeenCalledWith(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the pill out of the row's select button", async () => {
    await render([resource()]);
    // A button inside a button is invalid HTML and fails the a11y check.
    expect(container.querySelector(".row-select .course-pill")).toBeNull();
    expect(container.querySelector(".row-meta .course-pill")).toBeTruthy();
  });
});

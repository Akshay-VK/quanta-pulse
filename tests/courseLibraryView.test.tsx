// Course page scenario test: the section tree expands and collapses, search
// flattens results with paths and highlights, filters narrow the tree, and
// the ARIA tree keyboard model moves a roving selection.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Course, Resource } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: {
    listResources: vi.fn(),
    setMonitoring: vi.fn(),
    rebuildBaseline: vi.fn(),
    previewResource: vi.fn().mockRejectedValue(new Error("preview unavailable")),
    eventsRange: vi.fn().mockResolvedValue([]),
  },
}));

import { api } from "../src/lib/api";
import CoursePage from "../src/views/library/CoursePage";
import { TooltipProvider } from "../src/components/ui/Tooltip";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
// jsdom lacks scrollIntoView and the pointer-capture methods Radix Select uses.
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};
Element.prototype.setPointerCapture = () => {};

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    externalCourseId: "math-f211",
    name: "MATH F211",
    shortName: "MATH F211",
    url: "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    firstSeenAt: "2026-09-01T00:00:00Z",
    lastScannedAt: "2026-10-12T00:00:00Z",
    lastScanStatus: "ok",
    monitoringStatus: "monitored",
    resourceCount: 4,
    ...overrides,
  };
}

function makeResource(
  id: number,
  title: string,
  sectionPath: string[],
  overrides: Partial<Resource> = {},
): Resource {
  return {
    id,
    externalResourceId: `resource-${id}`,
    courseId: 1,
    courseName: "MATH F211",
    title,
    url: `https://quanta.bits-pilani.ac.in/pluginfile.php/1/${id}.pdf`,
    sourcePageUrl: `https://quanta.bits-pilani.ac.in/mod/page/view.php?id=${id + 20}`,
    resourceType: "pdf",
    uploadedAt: null,
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: `2026-10-${String(id).padStart(2, "0")}T00:00:00Z`,
    lastSeenAt: null,
    lastCheckedAt: null,
    contentFingerprint: null,
    availabilityStatus: "available",
    sizeBytes: null,
    section: sectionPath[0] ?? null,
    sectionPath,
    isExternal: false,
    ...overrides,
  };
}

const initialResources = [
  makeResource(1, "Lecture One", ["Worksheets Folder", "Tutorial Set", "Week 1"]),
  makeResource(2, "Lecture Two", ["Worksheets Folder", "Tutorial Set", "Week 1"]),
  makeResource(3, "Notice", ["Notices"], { resourceType: "announcement" }),
  makeResource(4, "Consultation material", [
    "Section-4: Consultation Hour with a deliberately long heading",
  ], { sourcePageUrl: null }),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.listResources).mockReset().mockResolvedValue(initialResources);
  vi.mocked(api.setMonitoring).mockReset();
  vi.mocked(api.rebuildBaseline).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render(
  resources: Resource[] | null = initialResources,
  options: {
    course?: Course;
    failWith?: string;
    onOpen?: (url: string) => void;
    onChanged?: () => void;
    onSyncNow?: () => void;
    onPreview?: (resource: Resource) => void;
  } = {},
) {
  if (options.failWith) {
    vi.mocked(api.listResources).mockRejectedValue(new Error(options.failWith));
  } else if (resources === null) {
    vi.mocked(api.listResources).mockReturnValue(new Promise(() => {}));
  } else {
    vi.mocked(api.listResources).mockResolvedValue(resources);
  }
  await act(async () => {
    root.render(
      <TooltipProvider>
        <CoursePage
          course={options.course ?? makeCourse()}
          onOpen={options.onOpen ?? (() => {})}
          onPreview={options.onPreview ?? (() => {})}
          onChanged={options.onChanged ?? (() => {})}
          onSyncNow={options.onSyncNow ?? (() => {})}
        />
      </TooltipProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function treeRows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

function byLabel(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`Missing button with aria-label: ${label}`);
  return button as HTMLButtonElement;
}

function byText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  if (!button) throw new Error(`Missing button with text: ${text}`);
  return button as HTMLButtonElement;
}

/** The new toolbar affordance: start every case from a collapsed tree. */
async function collapseAll() {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "Collapse all",
  );
  // Already collapsed — e.g. the previous case left it that way in the
  // per-course session memory.
  if (!button) return;
  await act(async () => button.click());
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

async function typeSearch(text: string) {
  const search = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search resources in this course"]',
  )!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(search, text);
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

async function key(keyName: string, index = 0) {
  const el = treeRows()[index];
  if (!el) throw new Error(`Missing treeitem at index ${index}`);
  // Focus first and flush so the keydown handler sees the updated activeIndex.
  await act(async () => {
    el.focus();
  });
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true }));
  });
}

async function chooseOption(ariaLabel: string, itemText: string) {
  const trigger = [...container.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === ariaLabel,
  );
  if (!trigger) throw new Error(`Missing select: ${ariaLabel}`);
  // Radix Select triggers open on pointerdown, which jsdom's React integration
  // does not deliver; the keyboard path opens it reliably in tests.
  await act(async () => {
    (trigger as HTMLButtonElement).focus();
  });
  await act(async () => {
    (trigger as HTMLButtonElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    const item = [...document.body.querySelectorAll(".select-item")].find((el) =>
      el.textContent?.includes(itemText),
    );
    if (!item) throw new Error(`Missing select item: ${itemText}`);
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("CoursePage tree", () => {
  it("expands and collapses the same sections repeatedly without duplicates", async () => {
    await render();
    await collapseAll();
    // Three top-level folders; every file lives inside a folder.
    expect(treeRows()).toHaveLength(3);

    await click(byLabel("Expand Worksheets Folder"));
    expect(treeRows()).toHaveLength(4);
    await click(byLabel("Expand Tutorial Set"));
    expect(treeRows()).toHaveLength(5);
    await click(byLabel("Expand Week 1"));
    expect(treeRows()).toHaveLength(7);
    expect(container.textContent).toContain("Lecture One");
    expect(container.textContent).toContain("Lecture Two");

    for (let i = 0; i < 3; i += 1) {
      await click(byLabel("Collapse Week 1"));
      expect(treeRows()).toHaveLength(5);
      await click(byLabel("Expand Week 1"));
      expect(treeRows()).toHaveLength(7);
    }
  });

  it("shows folder counts, external links, and never duplicates file rows", async () => {
    await render();
    await collapseAll();
    await click(byLabel("Expand Worksheets Folder"));
    await click(byLabel("Expand Tutorial Set"));
    await click(byLabel("Expand Week 1"));
    const lectureRows = [...container.querySelectorAll(".tree-name")].filter(
      (el) => el.textContent === "Lecture One" || el.textContent === "Lecture Two",
    );
    expect(lectureRows).toHaveLength(2);
    expect(byLabel("Open Quanta page for Week 1")).toBeTruthy();
  });

  it("moves a roving selection with arrow keys and expands with ArrowRight", async () => {
    await render();
    await collapseAll();
    await key("ArrowDown", 0);
    expect(treeRows()[1].getAttribute("aria-selected")).toBe("true");

    await key("ArrowRight", 0);
    expect(treeRows()[0].getAttribute("aria-expanded")).toBe("true");
    await key("ArrowLeft", 0);
    expect(treeRows()[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("supports typeahead to jump to a matching row", async () => {
    await render();
    await collapseAll();
    await click(byLabel("Expand Section-4: Consultation Hour with a deliberately long heading"));
    const el = treeRows()[0];
    await act(async () => {
      el.focus();
    });
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    });
    const selected = treeRows().findIndex(
      (el) => el.getAttribute("aria-selected") === "true",
    );
    expect(treeRows()[selected].textContent).toContain("Consultation material");
  });

  it("flattens search results with section paths and highlights matches", async () => {
    await render();
    await collapseAll();
    await typeSearch("Lecture Two");
    expect(container.querySelector(".result-count")?.textContent).toBe("1 of 4");
    expect(container.querySelector(".tree-match-path")?.textContent).toBe(
      "Worksheets Folder → Tutorial Set → Week 1",
    );
    expect(container.querySelector("mark.match-hl")?.textContent).toBe("Lecture Two");

    await click(byText("Clear filters"));
    const searchEl = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search resources in this course"]',
    );
    expect(searchEl?.value).toBe("");
    expect(container.querySelector(".tree-match-path")).toBeNull();
  });

  it("filters by file type through the select", async () => {
    await render();
    await collapseAll();
    await chooseOption("Filter by file type", "announcement");
    expect(container.querySelector(".result-count")?.textContent).toBe("1 of 4");
    expect(container.textContent).toContain("Notice");
    expect(container.textContent).not.toContain("Lecture One");
  });

  it("offers Preview only for previewable resources and shows restored status", async () => {
    await render([
      makeResource(1, "Lecture One", ["Week 1"]),
      makeResource(2, "Old archive", ["Week 1"], {
        resourceType: "archive",
        url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=2",
        sizeBytes: 1024,
      }),
      makeResource(3, "Back again", ["Week 1"], { availabilityStatus: "restored" }),
    ]);
    await collapseAll();
    await click(byLabel("Expand Week 1"));
    expect(byLabel("Preview Lecture One")).toBeTruthy();
    expect(container.querySelector('button[aria-label="Preview Old archive"]')).toBeNull();
    expect(container.textContent).toContain("Restored");
  });

  it("renders loading, error with retry, and empty states", async () => {
    await render(null, { course: makeCourse({ id: 11 }) });
    expect(container.querySelector(".skeleton-stack")).toBeTruthy();

    await render([], { course: makeCourse({ id: 12 }), failWith: "Course resources unavailable" });
    expect(container.textContent).toContain("Course resources unavailable");
    await click(byText("Retry"));
    expect(api.listResources).toHaveBeenCalledTimes(3);

    await render([], { course: makeCourse({ id: 13 }) });
    expect(container.textContent).toContain("This course has not been scanned yet");
    expect(byText("Sync now")).toBeTruthy();
  });

  it("pauses and resumes monitoring from the title row", async () => {
    await render(initialResources);
    await collapseAll();
    await click(byText("Pause"));
    expect(api.setMonitoring).toHaveBeenCalledWith(1, "paused");
  });
});

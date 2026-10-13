import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CourseLibrary from "../src/components/CourseLibrary";
import type { Course, Resource } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: {
    previewResource: vi.fn().mockRejectedValue(new Error("preview unavailable")),
  },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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

function makeResource(id: number, title: string, sectionPath: string[], overrides: Partial<Resource> = {}): Resource {
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
  makeResource(3, "Notice", ["Notices"]),
  makeResource(4, "Consultation material", ["Section-4: Consultation Hour with a deliberately long heading"], { sourcePageUrl: null }),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render(resources: Resource[], options: { loading?: boolean; error?: string | null; onOpen?: (url: string) => void; onRetry?: () => void } = {}) {
  await act(async () => {
    root.render(
      <CourseLibrary
        course={makeCourse({ resourceCount: resources.length })}
        resources={resources}
        loading={options.loading ?? false}
        error={options.error ?? null}
        onRetry={options.onRetry ?? (() => {})}
        onOpen={options.onOpen ?? (() => {})}
      />,
    );
  });
}

function byLabel(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Missing button with aria-label: ${label}`);
  return button as HTMLButtonElement;
}

function byTitle(title: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((item) => item.getAttribute("title") === title);
  if (!button) throw new Error(`Missing button with title: ${title}`);
  return button as HTMLButtonElement;
}

function byText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  if (!button) throw new Error(`Missing button with text: ${text}`);
  return button as HTMLButtonElement;
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

describe("CourseLibrary hierarchy", () => {
  it("expands and collapses the same sections repeatedly without duplicates", async () => {
    await render(initialResources);
    await click(byLabel("Expand Worksheets Folder"));
    expect(container.textContent).toContain("Tutorial Set");
    await click(byLabel("Expand Tutorial Set"));
    expect(container.textContent).toContain("Week 1");

    for (let i = 0; i < 3; i += 1) {
      await click(byLabel("Collapse Tutorial Set"));
      expect(container.querySelectorAll(".course-tree-navigate").length).toBe(4);
      await click(byLabel("Expand Tutorial Set"));
      expect(container.querySelectorAll(".course-tree-navigate").length).toBe(5);
    }

    await click(byLabel("Expand Week 1"));
    expect(container.querySelectorAll(".library-row-title")).toHaveLength(2);
    await click(byLabel("Collapse Week 1"));
    await click(byLabel("Expand Week 1"));
    expect(container.querySelectorAll(".library-row-title")).toHaveLength(2);
  });

  it("keeps a single row structure at every depth and truncates long names", async () => {
    await render(initialResources);
    const longName = "Section-4: Consultation Hour with a deliberately long heading";
    const longRow = byTitle(`Open section ${longName}`).closest(".course-tree-row") as HTMLElement;
    const normalRow = byTitle("Open section Notices").closest(".course-tree-row") as HTMLElement;
    expect(longRow.children).toHaveLength(4);
    expect(normalRow.children).toHaveLength(4);
    expect(longRow.querySelector("strong")?.getAttribute("title")).toBe(longName);
    expect(longRow.querySelector(".course-tree-external-placeholder")).toBeTruthy();

    await click(byLabel("Expand Worksheets Folder"));
    await click(byLabel("Expand Tutorial Set"));
    const depths = [...container.querySelectorAll<HTMLElement>(".course-tree-row")]
      .map((row) => row.style.getPropertyValue("--tree-depth"));
    expect(depths).toContain("0");
    expect(depths).toContain("1");
    expect(depths).toContain("2");
  });

  it("keeps disclosure, section navigation, breadcrumbs, and external links independent", async () => {
    const onOpen = vi.fn();
    await render(initialResources, { onOpen });
    const folder = [...container.querySelectorAll<HTMLElement>(".course-tree-node")]
      .find((node) => node.querySelector('[title="Open section Worksheets Folder"]'))!;
    const external = folder.querySelector<HTMLButtonElement>(".course-tree-external")!;
    await click(external);
    expect(onOpen).toHaveBeenCalledWith(initialResources[0].sourcePageUrl);
    expect(byLabel("Expand Section-4: Consultation Hour with a deliberately long heading").getAttribute("aria-expanded")).toBe("false");

    await click(byLabel("Expand Worksheets Folder"));
    expect(byLabel("Collapse Worksheets Folder").getAttribute("aria-expanded")).toBe("true");
    await click(byTitle("Open section Worksheets Folder"));
    expect(container.querySelector(".library-breadcrumb")?.textContent).toBe("MATH F211/Worksheets Folder");
    await click(byText("MATH F211"));
    expect(container.querySelector(".library-breadcrumb")?.textContent).toBe("MATH F211");
    expect(byLabel("Collapse Worksheets Folder").getAttribute("aria-expanded")).toBe("true");
  });

  it("preserves selection and expansion when synchronization replaces resource data", async () => {
    await render(initialResources);
    await click(byLabel("Expand Worksheets Folder"));
    await click(byLabel("Expand Tutorial Set"));
    await click(byTitle("Open section Worksheets Folder"));
    const updated = [...initialResources, makeResource(5, "Lecture Three", ["Worksheets Folder", "Tutorial Set", "Week 1"])];
    await render(updated);

    expect(container.querySelector(".library-breadcrumb")?.textContent).toContain("Worksheets Folder");
    expect(container.textContent).toContain("3 descendant resources in Worksheets Folder");
    expect(container.querySelector(".course-tree-navigate")?.textContent).toContain("Tutorial Set");
    expect(container.querySelectorAll(".course-tree-navigate")[1]?.textContent).toContain("Week 1");
  });

  it("shows direct resources for a section without child sections and preserves sorting/search", async () => {
    await render(initialResources);
    await click(byLabel("Expand Notices"));
    expect([...container.querySelectorAll(".library-row-title")].some((item) => item.textContent === "Notice")).toBe(true);

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search resources in this course"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "Lecture Two");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Found 1 of 4 resources");
    expect(container.querySelectorAll(".library-row-title")).toHaveLength(1);
    expect(container.textContent).toContain("Worksheets Folder → Tutorial Set → Week 1");
  });

  it("renders loading, error, and empty states without inventing empty sections", async () => {
    await render([], { loading: true });
    expect(container.textContent).toContain("Loading course structure");

    const retry = vi.fn();
    await render([], { error: "Course resources unavailable", onRetry: retry });
    expect(container.textContent).toContain("Course resources unavailable");
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "Retry") as HTMLButtonElement);
    expect(retry).toHaveBeenCalledOnce();

    await render([]);
    expect(container.textContent).toContain("No resources have been discovered");
    expect(container.querySelector(".course-tree")).toBeNull();
  });
});

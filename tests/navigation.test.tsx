// The single navigation model (Task 1): every entry point that opens a course
// — sidebar item, Library row, palette result — lands on the same course page,
// and the only breadcrumb carries the display name.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import LibraryView from "../src/views/LibraryView";
import Sidebar from "../src/components/Sidebar";
import { TooltipProvider } from "../src/components/ui/Tooltip";
import { registerCourseLabels } from "../src/lib/courseName";
import { loadCollapsed, SIDEBAR_KEY } from "../src/App";
import type { Course, Resource } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: {
    listResources: vi.fn().mockResolvedValue([]),
    setMonitoring: vi.fn(),
    rebuildBaseline: vi.fn(),
    previewResource: vi.fn().mockRejectedValue(new Error("no preview")),
    eventsRange: vi.fn().mockResolvedValue([]),
  },
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};
Element.prototype.setPointerCapture = () => {};

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 7,
    externalCourseId: "1166",
    name: "1166_ECE_INSTR_EEE_ECOM F215",
    shortName: "ECOM F215",
    url: "https://quanta.bits-pilani.ac.in/course/view.php?id=7",
    firstSeenAt: "2026-09-01T00:00:00Z",
    lastScannedAt: "2026-10-12T00:00:00Z",
    lastScanStatus: "ok",
    monitoringStatus: "monitored",
    resourceCount: 12,
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
  localStorage.clear();
  registerCourseLabels([course()]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderLibrary(onNavigate: (id: number | null, folderPath?: string[] | null) => void, courseId: number | null) {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <LibraryView
          courses={[course()]}
          resources={[] as Resource[]}
          courseId={courseId}
          folderPath={null}
          onNavigate={onNavigate}
          onChanged={() => {}}
          onOpen={() => {}}
        />
      </TooltipProvider>,
    );
  });
}

async function renderSidebar(
  activeCourseId: number | null,
  onCourse: (id: number | null) => void,
  options: { collapsed?: boolean; overlay?: boolean; onToggle?: () => void } = {},
) {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <Sidebar
          view="library"
          onView={() => {}}
          courses={[course()]}
          unreadByCourse={new Map()}
          unreadTotal={0}
          activeCourseId={activeCourseId}
          onCourse={onCourse}
          sync={null}
          onSync={() => {}}
          onOpenScans={() => {}}
          onOpenPalette={() => {}}
          collapsed={options.collapsed ?? false}
          onToggle={options.onToggle ?? (() => {})}
          overlay={options.overlay}
        />
      </TooltipProvider>,
    );
  });
}

describe("navigation to a course", () => {
  it("opens the course page from the Library row", async () => {
    const onNavigate = vi.fn();
    await renderLibrary(onNavigate, null);
    const row = [...container.querySelectorAll<HTMLButtonElement>(".course-row-main")][0];
    expect(row).toBeTruthy();
    await act(async () => row.click());
    expect(onNavigate).toHaveBeenCalledWith(7);
  });

  it("navigates from the sidebar course item on any view", async () => {
    const onCourse = vi.fn();
    await renderSidebar(null, onCourse);
    const item = [...container.querySelectorAll<HTMLButtonElement>(".course-nav-item")][0];
    await act(async () => item.click());
    // Always an open, never a filter toggle.
    expect(onCourse).toHaveBeenCalledWith(7);
    expect(onCourse).not.toHaveBeenCalledWith(null);
  });

  it("marks the open course's sidebar item as the current page", async () => {
    await renderSidebar(7, () => {});
    const item = container.querySelector('.course-nav-item[aria-current="page"]');
    expect(item?.textContent).toContain("ECOM F215");
  });

  it("keeps the Library nav item active only on the course list", async () => {
    await renderSidebar(7, () => {});
    const active = [...container.querySelectorAll('.nav-item[aria-current="page"]')].map((el) =>
      el.textContent,
    );
    expect(active).not.toContain("Library");

    await renderSidebar(null, () => {});
    const after = [...container.querySelectorAll('.nav-item[aria-current="page"]')].map((el) =>
      el.textContent,
    );
    expect(after).toContain("Library");
  });

  it("shows the course page with its display name as the title", async () => {
    await renderLibrary(() => {}, 7);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector(".course-title-text")?.textContent).toBe("ECOM F215");
    // The raw Moodle name stays as the caption; no second 'Library' button and
    // no leftover breadcrumb strip in the page body.
    const buttons = [...container.querySelectorAll("button")].map((el) => el.textContent);
    expect(buttons).not.toContain("Library");
    expect(container.querySelector(".course-page-topper")).toBeNull();
  });
});

describe("Library course rows", () => {
  it("is one button with a trailing chevron and a separate menu", async () => {
    await renderLibrary(() => {}, null);
    const row = container.querySelector(".course-row") as HTMLElement;
    expect(row.querySelectorAll("button")).toHaveLength(2);
    expect(row.querySelector(".course-row-main")).toBeTruthy();
    expect(row.querySelector(".course-row-chevron")).toBeTruthy();
    // No leading chevron implying an inline expansion that never happens: the
    // row starts with the colour dot and ends with the chevron.
    const main = row.querySelector(".course-row-main") as HTMLElement;
    expect(main.firstElementChild?.classList.contains("course-dot")).toBe(true);
    expect(main.lastElementChild?.classList.contains("course-row-chevron")).toBe(true);
  });
});

describe("sidebar collapse", () => {
  /** Matched by prefix because the label contains a literal backslash. */
  function expandButton(): HTMLButtonElement | null {
    return (
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((el) =>
        el.getAttribute("aria-label")?.startsWith("Expand sidebar"),
      ) ?? null
    );
  }

  it("hides the courses section and offers an expand control in the rail", async () => {
    await renderSidebar(null, () => {}, { collapsed: true });
    expect(container.querySelector(".course-nav-section")).toBeNull();
    expect(expandButton()).toBeTruthy();
  });

  it("expands from the rail's control", async () => {
    const onToggle = vi.fn();
    await renderSidebar(null, () => {}, { collapsed: true, onToggle });
    await act(async () => expandButton()?.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("expands from the logo in the rail", async () => {
    const onToggle = vi.fn();
    await renderSidebar(null, () => {}, { collapsed: true, onToggle });
    await act(async () => container.querySelector<HTMLButtonElement>(".sidebar-brand")?.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("offers a muted Collapse control when expanded", async () => {
    const onToggle = vi.fn();
    await renderSidebar(null, () => {}, { onToggle });
    const button = container.querySelector<HTMLButtonElement>(".sidebar-collapse");
    expect(button?.textContent).toContain("Collapse");
    await act(async () => button?.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("marks the drawer as an overlay at narrow widths", async () => {
    await renderSidebar(null, () => {}, { collapsed: true, overlay: true });
    expect(container.querySelector(".sidebar")?.classList.contains("overlay")).toBe(true);
  });

  it("remembers the rail preference across a restart", () => {
    localStorage.removeItem(SIDEBAR_KEY);
    expect(loadCollapsed()).toBe(false);
    localStorage.setItem(SIDEBAR_KEY, "1");
    expect(loadCollapsed()).toBe(true);
    localStorage.setItem(SIDEBAR_KEY, "0");
    expect(loadCollapsed()).toBe(false);
  });
});

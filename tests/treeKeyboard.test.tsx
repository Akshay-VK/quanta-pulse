// ARIA tree keyboard model (spec 12.3): Up/Down with clamping, Home/End,
// Right expands-or-enters, Left collapses-or-goes-to-parent, and typeahead.

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

const COURSE: Course = {
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
};

function makeResource(id: number, title: string, sectionPath: string[]): Resource {
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
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: null,
    lastCheckedAt: null,
    contentFingerprint: null,
    availabilityStatus: "available",
    sizeBytes: null,
    section: sectionPath[0] ?? null,
    sectionPath,
    isExternal: false,
  };
}

// Top-level folders: "Worksheets Folder", "Notices", "Section-4…".
const RESOURCES: Resource[] = [
  makeResource(1, "Lecture One", ["Worksheets Folder", "Tutorial Set", "Week 1"]),
  makeResource(2, "Lecture Two", ["Worksheets Folder", "Tutorial Set", "Week 1"]),
  makeResource(3, "Notice", ["Notices"]),
  makeResource(4, "Consultation", ["Section-4"]),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.listResources).mockReset().mockResolvedValue(RESOURCES);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render() {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <CoursePage
          course={COURSE}
          onOpen={() => {}}
          onPreview={() => {}}
          onChanged={() => {}}
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

function expanded(index: number): string | null {
  return treeRows()[index].getAttribute("aria-expanded");
}

/** Focus the row at `index` (which syncs the roving activeIndex), then fire a key. */
async function press(key: string, index: number) {
  const el = treeRows()[index];
  if (!el) throw new Error(`Missing treeitem at index ${index}`);
  await act(async () => {
    el.focus();
  });
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
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

function selectedIndex(): number {
  return treeRows().findIndex((el) => el.getAttribute("aria-selected") === "true");
}

describe("tree keyboard model", () => {
  it("moves with Up/Down and clamps at both ends", async () => {
    await render();
    await collapseAll();
    expect(treeRows()).toHaveLength(3);

    await press("ArrowUp", 0);
    expect(selectedIndex()).toBe(0);

    await press("ArrowDown", 0);
    await press("ArrowDown", 1);
    expect(selectedIndex()).toBe(2);

    await press("ArrowDown", 2);
    expect(selectedIndex()).toBe(2);
  });

  it("Home and End jump to the first and last row", async () => {
    await render();
    await collapseAll();
    await press("ArrowDown", 0);
    expect(selectedIndex()).toBe(1);

    await press("End", 1);
    expect(selectedIndex()).toBe(2);

    await press("Home", 2);
    expect(selectedIndex()).toBe(0);
  });

  it("ArrowRight expands a folder, then enters it", async () => {
    await render();
    await collapseAll();
    expect(expanded(0)).toBe("false");

    await press("ArrowRight", 0);
    expect(expanded(0)).toBe("true");
    expect(selectedIndex()).toBe(0);

    await press("ArrowRight", 0);
    expect(selectedIndex()).toBe(1);
  });

  it("ArrowLeft collapses an expanded folder, else moves to the parent", async () => {
    await render();
    await collapseAll();
    // Expand Worksheets Folder → Tutorial Set → Week 1 → files appear.
    await press("ArrowRight", 0);
    await press("ArrowRight", 1);
    await press("ArrowRight", 2);
    expect(expanded(2)).toBe("true");
    expect(treeRows().length).toBeGreaterThan(3);

    // A file (index 3) steps Left to its parent folder (index 2).
    await press("ArrowLeft", 3);
    expect(selectedIndex()).toBe(2);

    // An expanded folder (index 2) collapses in place.
    await press("ArrowLeft", 2);
    expect(expanded(2)).toBe("false");
  });

  it("typeahead selects the next row whose name starts with the typed key", async () => {
    await render();
    await collapseAll();
    await press("n", 0);
    const selected = treeRows()[selectedIndex()];
    expect(selected.textContent).toContain("Notices");
  });
});

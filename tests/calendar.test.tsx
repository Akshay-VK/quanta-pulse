// Calendar view scenario test: month dots and the selected-day digest both come
// from stored events, month navigation refetches the right bounds, and the day
// panel stays interactive. Runs against the real component with a stubbed `api`
// (no Tauri runtime needed).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ChangeEvent, Course, Digest } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: {
    eventsRange: vi.fn(),
    dailyDigest: vi.fn(),
  },
}));

import { api } from "../src/lib/api";
import CalendarView from "../src/views/CalendarView";
import { TooltipProvider } from "../src/components/ui/Tooltip";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildEvent(id: number, detectedAt: string, changeType = "new"): ChangeEvent {
  return {
    id,
    resourceId: id,
    courseId: 1,
    courseName: "Discrete Maths",
    resourceTitle: "Worksheet-9.pdf",
    resourceUrl: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
    sourcePageUrl: "https://quanta.bits-pilani.ac.in/course/view.php?id=1&section=3",
    resourceType: "PDF",
    uploadedAt: null,
    changeType,
    title: "Worksheet-9.pdf",
    description: null,
    detectedAt,
    read: false,
  };
}

function buildCourse(): Course {
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
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.eventsRange).mockReset();
  vi.mocked(api.dailyDigest).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush() {
  // Let the mocked-promise continuations inside effects run to completion.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCalendar() {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <CalendarView courses={[buildCourse()]} onOpen={() => {}} onOpenScan={() => {}} />
      </TooltipProvider>,
    );
  });
  await flush();
}

function statValue(label: string): string | undefined {
  const block = [...container.querySelectorAll(".stat-block")].find(
    (el) => el.querySelector(".stat-label")?.textContent === label,
  );
  return block?.querySelector(".stat-value")?.textContent?.trim();
}

describe("CalendarView", () => {
  it("draws day dots and the selected-day digest from stored events", async () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const day = now.getDate();
    const selected = todayKey();
    const from = `${y}-${pad(m + 1)}-01`;
    const last = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${pad(m + 1)}-${pad(last)}`;
    const evt = buildEvent(1, new Date(y, m, day, 10, 0).toISOString(), "new");
    const digest: Digest = {
      date: selected,
      newCount: 1,
      updatedCount: 0,
      announcementCount: 0,
      deadlineCount: 0,
      unavailableCount: 0,
      coursesFailed: 1,
      lastSuccessAt: new Date(y, m, day, 6, 0).toISOString(),
      items: [evt],
    };

    vi.mocked(api.eventsRange).mockResolvedValue([evt]);
    vi.mocked(api.dailyDigest).mockResolvedValue(digest);

    await renderCalendar();

    expect(api.eventsRange).toHaveBeenCalledWith(from, to);
    expect(api.dailyDigest).toHaveBeenCalledWith(selected);

    const selectedBtn = container.querySelector(".cal-day.selected") as HTMLButtonElement | null;
    expect(selectedBtn).toBeTruthy();
    expect(selectedBtn!.querySelector(".cal-num")?.textContent).toBe(String(day));
    // A semantic dot on the day with activity.
    expect(selectedBtn!.querySelector(".cal-dot.ev-new")).toBeTruthy();

    // The day digest shows the new-upload and failed-course figures.
    expect(statValue("New")).toBe("1");
    expect(statValue("Courses failed")).toBe("1");

    expect(container.textContent).toContain("Worksheet-9.pdf");
    expect(container.textContent).toContain("MATH F211");
    expect(container.querySelector(".cal-panel .resource-row")).toBeTruthy();
  });

  it("shows a clear empty state for a day without activity", async () => {
    const selected = todayKey();
    vi.mocked(api.eventsRange).mockResolvedValue([]);
    vi.mocked(api.dailyDigest).mockResolvedValue({
      date: selected,
      newCount: 0,
      updatedCount: 0,
      announcementCount: 0,
      deadlineCount: 0,
      unavailableCount: 0,
      coursesFailed: 0,
      lastSuccessAt: null,
      items: [],
    });

    await renderCalendar();

    expect(container.textContent).toContain("No activity on this day");
    expect(container.textContent).toContain("No scans ran on this day");
  });

  it("refetches the next month when navigating", async () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const from = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`;
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    const to = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(last)}`;

    vi.mocked(api.eventsRange).mockResolvedValue([]);
    vi.mocked(api.dailyDigest).mockResolvedValue({
      date: todayKey(),
      newCount: 0,
      updatedCount: 0,
      announcementCount: 0,
      deadlineCount: 0,
      unavailableCount: 0,
      coursesFailed: 0,
      lastSuccessAt: null,
      items: [],
    });

    await renderCalendar();

    const nextBtn = container.querySelector(
      'button[aria-label="Next month"]',
    ) as HTMLButtonElement | null;
    expect(nextBtn).toBeTruthy();
    await act(async () => nextBtn!.click());
    await flush();

    expect(api.eventsRange).toHaveBeenLastCalledWith(from, to);
  });
});

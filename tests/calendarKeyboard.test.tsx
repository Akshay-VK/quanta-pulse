// Calendar grid keyboard pattern: arrows move by day and week across month
// edges, PageUp/PageDown change month, Home jumps to today, Enter moves focus
// into the day panel, and the roving tabindex keeps exactly one tab stop.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Digest } from "../src/lib/types";

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

function dayNumPlus(deltaDays: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + deltaDays);
  return String(d.getDate());
}

function emptyDigest(date: string): Digest {
  return {
    date,
    newCount: 0,
    updatedCount: 0,
    announcementCount: 0,
    deadlineCount: 0,
    unavailableCount: 0,
    coursesFailed: 0,
    lastSuccessAt: null,
    items: [],
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.eventsRange).mockReset().mockResolvedValue([]);
  vi.mocked(api.dailyDigest).mockReset().mockImplementation((date) => Promise.resolve(emptyDigest(date ?? "")));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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

async function renderCalendar() {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <CalendarView courses={[]} onOpen={() => {}} onOpenScan={() => {}} />
      </TooltipProvider>,
    );
  });
  await flush();
}

function selectedDay(): HTMLButtonElement {
  return container.querySelector(".cal-day.selected") as HTMLButtonElement;
}

function press(key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  selectedDay().dispatchEvent(event);
}

describe("CalendarView keyboard", () => {
  it("moves by day and week with the arrows, keeping one tab stop", async () => {
    await renderCalendar();

    press("ArrowRight");
    await flush();
    expect(selectedDay().querySelector(".cal-num")?.textContent).toBe(dayNumPlus(1));
    expect(document.activeElement).toBe(selectedDay());

    press("ArrowDown");
    await flush();
    expect(selectedDay().querySelector(".cal-num")?.textContent).toBe(dayNumPlus(8));

    press("ArrowLeft");
    await flush();
    expect(selectedDay().querySelector(".cal-num")?.textContent).toBe(dayNumPlus(7));

    press("ArrowUp");
    await flush();
    expect(selectedDay().querySelector(".cal-num")?.textContent).toBe(dayNumPlus(0));

    const tabStops = container.querySelectorAll('.cal-day[tabindex="0"]');
    expect(tabStops).toHaveLength(1);
  });

  it("follows the selection across month edges and back with Home", async () => {
    await renderCalendar();

    press("PageUp");
    await flush();
    const titleBefore = container.querySelector(".cal-month-title")?.textContent;
    expect(titleBefore).toBeTruthy();
    expect(selectedDay().getAttribute("aria-label")).toContain(", no activity");

    press("Home");
    await flush();
    expect(selectedDay().querySelector(".cal-num")?.textContent).toBe(String(new Date().getDate()));
    expect(container.querySelector(".cal-month-title")?.textContent).toBe(
      new Date(nowYear(), nowMonth(), 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    );
  });

  it("moves focus into the day panel on Enter", async () => {
    await renderCalendar();

    press("Enter");
    await flush();
    expect(document.activeElement).toBe(container.querySelector(".cal-panel-title"));
  });

  it("switches months when selecting a day outside the visible month", async () => {
    await renderCalendar();
    const titleBefore = container.querySelector(".cal-month-title")?.textContent;
    const outsideBtn = [...container.querySelectorAll(".cal-day.outside")].pop() as HTMLButtonElement;
    expect(outsideBtn).toBeTruthy();
    const dayNum = outsideBtn.querySelector(".cal-num")?.textContent;

    await act(async () => outsideBtn.click());
    await flush();

    expect(container.querySelector(".cal-month-title")?.textContent).not.toBe(titleBefore);
    expect(selectedDay().querySelector(".cal-num")?.textContent).toBe(dayNum);
  });
});

function nowYear(): number {
  return new Date().getFullYear();
}

function nowMonth(): number {
  return new Date().getMonth();
}

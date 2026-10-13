// Deterministic timezone for midnight/month-boundary grouping checks.
// Settings at process startup (before test bodies) so `Date` uses India local
// time — the same +05:30 offset the original failure report was filed under.
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Kolkata";

import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthGrid,
  clampDayToMonth,
  dayKeyOf,
  daysInMonth,
  dotKinds,
  groupEventsByDay,
  isSameMonth,
  localDayKey,
  monthLabel,
  summarizeEvents,
  todayKey,
} from "../src/lib/events";
import type { ChangeEvent } from "../src/lib/types";

function evt(id: number, detectedAt: string, changeType: string): ChangeEvent {
  return {
    id,
    resourceId: id,
    courseId: 1,
    courseName: "Discrete Maths",
    resourceTitle: `R${id}`,
    resourceUrl: `https://example.com/${id}`,
    sourcePageUrl: null,
    resourceType: "PDF",
    uploadedAt: null,
    changeType,
    title: `R${id}`,
    description: null,
    detectedAt,
    read: false,
  };
}

describe("localDayKey — UTC stored, grouped by local calendar date", () => {
  it("maps an evening UTC instant to that local day", () => {
    // 21:30 IST is 16:00 UTC on the same calendar day.
    expect(localDayKey("2026-10-12T16:00:00Z")).toBe("2026-10-12");
  });

  it("rolls an instant just past local midnight to the next calendar day", () => {
    // 00:10 IST on 13 Oct is still 12 Oct 18:40 UTC.
    expect(localDayKey("2026-10-12T18:40:00Z")).toBe("2026-10-13");
  });

  it("never moves the day the other way at local midnight", () => {
    // 23:50 IST on 12 Oct is 18:20 UTC the same day.
    expect(localDayKey("2026-10-12T18:20:00Z")).toBe("2026-10-12");
  });

  it("handles a bare date value as a local calendar day", () => {
    expect(localDayKey("2026-10-13")).toBe("2026-10-13");
    expect(localDayKey(null)).toBe("");
    expect(localDayKey(undefined)).toBe("");
  });
});

describe("groupEventsByDay", () => {
  it("groups by local day and sorts newest first within each day", () => {
    const events = [
      evt(1, "2026-10-12T04:30:00Z", "new"), // 10:00 IST on 12 Oct
      evt(2, "2026-10-12T18:40:00Z", "updated"), // 00:10 IST on 13 Oct
      evt(3, "2026-10-12T10:00:00Z", "new"), // 15:30 IST on 12 Oct
      evt(4, "2026-10-11T23:00:00Z", "deadline"), // 04:30 IST on 12 Oct
    ];
    const byDay = groupEventsByDay(events);
    expect([...byDay.keys()].sort()).toEqual(["2026-10-12", "2026-10-13"]);
    expect(byDay.get("2026-10-13")).toHaveLength(1);
    // Newest first on the 12th: 15:30 → 10:00 → 04:30.
    expect(byDay.get("2026-10-12")!.map((e) => e.id)).toEqual([3, 1, 4]);
  });

  it("orders across days for the calendar dots", () => {
    const byDay = groupEventsByDay([evt(5, "2026-10-13T00:10:00Z", "new")]);
    expect(byDay.get("2026-10-13")).toHaveLength(1);
  });
});

describe("summarizeEvents", () => {
  it("counts each kind and the total", () => {
    const events = [
      evt(1, "t", "new"),
      evt(2, "t", "announcement"),
      evt(3, "t", "updated"),
      evt(4, "t", "updated"),
      evt(5, "t", "deadline"),
      evt(6, "t", "unavailable"),
      evt(7, "t", "restored"),
    ];
    expect(summarizeEvents(events)).toEqual({
      new: 1,
      announcement: 1,
      updated: 2,
      deadline: 1,
      unavailable: 1,
      restored: 1,
      total: 7,
    });
  });
});

describe("month grid", () => {
  it("is Monday-first and spans six stable weeks", () => {
    const weeks = buildMonthGrid({ year: 2026, month: 9 }); // October 2026
    expect(weeks).toHaveLength(6);
    for (const w of weeks) expect(w).toHaveLength(7);
    // 1 Oct 2026 is a Thursday → the grid starts on Monday 28 Sep 2026.
    expect(dayKeyOf(weeks[0][0])).toBe("2026-09-28");
    // ...and ends on the second Sunday so the grid never reflows between months.
    expect(dayKeyOf(weeks[5][6])).toBe("2026-11-08");
  });

  it("clamps an invalid selected day when switching months", () => {
    expect(clampDayToMonth(2026, 1, 31)).toBe("2026-02-28");
    expect(clampDayToMonth(2026, 1, 1)).toBe("2026-02-01");
    expect(clampDayToMonth(2024, 1, 29)).toBe("2024-02-29"); // leap year
  });

  it("wraps month arithmetic across years", () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it("labels months and detects membership", () => {
    expect(monthLabel({ year: 2026, month: 1 })).toBe("February 2026");
    expect(isSameMonth(new Date(2026, 9, 5), { year: 2026, month: 9 })).toBe(true);
    expect(isSameMonth(new Date(2026, 10, 5), { year: 2026, month: 9 })).toBe(false);
  });

  it("renders today's local key", () => {
    expect(todayKey(new Date(2026, 9, 12, 23, 30))).toBe("2026-10-12");
  });
});

describe("dotKinds", () => {
  it("returns distinct kinds in significance order", () => {
    const events = [
      evt(1, "t", "announcement"),
      evt(2, "t", "new"),
      evt(3, "t", "unavailable"),
      evt(4, "t", "updated"),
    ];
    expect(dotKinds(events)).toEqual(["unavailable", "updated", "announcement"]);
    expect(dotKinds(events, 5)).toEqual(["unavailable", "updated", "announcement", "new"]);
  });

  it("returns nothing for an empty day", () => {
    expect(dotKinds([])).toEqual([]);
  });
});
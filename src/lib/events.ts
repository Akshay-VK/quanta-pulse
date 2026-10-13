// Canonical change-event helpers shared by the Dashboard, History and the
// calendar. Every view reads the same `change_events` rows and groups them with
// the helpers below, so their counts, colours and day boundaries can never
// drift apart. Pure and timezone-aware so it can be unit tested.

import type { ChangeEvent } from "./types";
import { parseTimestamp } from "./format";

export type EventKind =
  | "new"
  | "announcement"
  | "updated"
  | "deadline"
  | "unavailable"
  | "restored";

export interface EventKindMeta {
  id: EventKind;
  /** Compact label used in lists and the legend. */
  label: string;
  /** Plural label used by summary rows. */
  summary: string;
  /** Text-colour helper class (never the only signal — always paired with a label). */
  tone: string;
  /** Dot-colour class used by the calendar and legend. */
  dot: string;
}

export const EVENT_KINDS: EventKindMeta[] = [
  { id: "new", label: "New", summary: "New uploads", tone: "text-cyan", dot: "ev-new" },
  {
    id: "announcement",
    label: "Announcement",
    summary: "Announcements",
    tone: "text-violet",
    dot: "ev-announcement",
  },
  { id: "updated", label: "Updated", summary: "Updated resources", tone: "text-amber", dot: "ev-updated" },
  { id: "deadline", label: "Deadline", summary: "Deadlines", tone: "text-amber", dot: "ev-deadline" },
  {
    id: "unavailable",
    label: "Unavailable",
    summary: "Unavailable resources",
    tone: "text-danger",
    dot: "ev-unavailable",
  },
  { id: "restored", label: "Restored", summary: "Available again", tone: "text-ok", dot: "ev-restored" },
];

const KIND_BY_ID = new Map<string, EventKindMeta>(EVENT_KINDS.map((k) => [k.id, k]));

const UNKNOWN_KIND: EventKindMeta = {
  id: "new",
  label: "Change",
  summary: "Changes",
  tone: "text-cyan",
  dot: "ev-new",
};

export function eventKindMeta(changeType: string): EventKindMeta {
  return KIND_BY_ID.get(changeType) ?? { ...UNKNOWN_KIND, label: changeType, summary: changeType };
}

/** True for events that represent a resource seen for the first time. */
export function isNewlyDetected(changeType: string): boolean {
  return changeType === "new" || changeType === "announcement";
}

/* ------------------------------------------------------- local calendar days */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A `YYYY-MM-DD` key for the *local* calendar day of a Date. */
export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local calendar-day key of a stored timestamp. */
export function localDayKey(value?: string | null): string {
  const d = parseTimestamp(value);
  return d ? dayKeyOf(d) : "";
}

/** Local midnight for a `YYYY-MM-DD` key. */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(now: Date = new Date()): string {
  return dayKeyOf(now);
}

/* --------------------------------------------------------------- summary */

export interface EventCounts {
  new: number;
  announcement: number;
  updated: number;
  deadline: number;
  unavailable: number;
  restored: number;
  total: number;
}

export function summarizeEvents(events: ChangeEvent[]): EventCounts {
  const counts: EventCounts = {
    new: 0,
    announcement: 0,
    updated: 0,
    deadline: 0,
    unavailable: 0,
    restored: 0,
    total: events.length,
  };
  for (const e of events) {
    if (e.changeType in counts && e.changeType !== "total") {
      counts[e.changeType as keyof EventCounts] += 1;
    }
  }
  return counts;
}

/** Group events by their local calendar day, newest first within each day. */
export function groupEventsByDay(events: ChangeEvent[]): Map<string, ChangeEvent[]> {
  const map = new Map<string, ChangeEvent[]>();
  for (const e of events) {
    const key = localDayKey(e.detectedAt);
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  }
  for (const bucket of map.values()) {
    bucket.sort(
      (a, b) =>
        (parseTimestamp(b.detectedAt)?.getTime() ?? 0) -
        (parseTimestamp(a.detectedAt)?.getTime() ?? 0),
    );
  }
  return map;
}

const DOT_PRIORITY: EventKind[] = ["unavailable", "deadline", "updated", "announcement", "new", "restored"];

/** The distinct event kinds on a day, most significant first, for its dots. */
export function dotKinds(events: ChangeEvent[], max = 3): EventKind[] {
  const present = new Set(events.map((e) => e.changeType));
  const ordered = DOT_PRIORITY.filter((k) => present.has(k));
  // Unknown kinds still deserve a dot.
  for (const e of events) {
    if (!KIND_BY_ID.has(e.changeType) && !ordered.includes(e.changeType as EventKind)) {
      ordered.push(e.changeType as EventKind);
    }
  }
  return ordered.slice(0, max);
}

/* ----------------------------------------------------------------- months */

export interface YearMonth {
  year: number;
  /** 0-based, matching `Date.getMonth()`. */
  month: number;
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function monthLabel({ year, month }: YearMonth): string {
  return monthFmt.format(new Date(year, month, 1));
}

export function longDayLabel(key: string): string {
  return dayFmt.format(dayKeyToDate(key));
}

/**
 * A six-week, Monday-first grid covering `year`/`month`. Includes the trailing
 * days of the previous month and leading days of the next so the calendar never
 * reflows between months.
 */
export function buildMonthGrid({ year, month }: YearMonth): Date[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(year, month, 1 - offset);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
    }
    weeks.push(row);
  }
  return weeks;
}

/** Keep the selected day-of-month when possible, clamping at month length. */
export function clampDayToMonth(year: number, month: number, dayOfMonth: number): string {
  const clamped = Math.min(Math.max(dayOfMonth, 1), daysInMonth(year, month));
  return dayKeyOf(new Date(year, month, clamped));
}

export function isSameMonth(d: Date, { year, month }: YearMonth): boolean {
  return d.getFullYear() === year && d.getMonth() === month;
}

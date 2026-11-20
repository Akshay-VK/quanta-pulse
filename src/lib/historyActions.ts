// History view helpers: filtering, grouping, scan summaries and deletion scope copy.

import type { ChangeEvent, HistoryDeletionScope } from "./types";
import { dayKeyOf, groupEventsByDay, todayKey } from "./events";
import { parseTimestamp } from "./format";

export type HistoryTypeFilter = "all" | "new" | "updated" | "announcement" | "deadline" | "unavailable" | "restored";
export type HistoryDateRange = "all" | "today" | "7d" | "30d" | "custom";

export interface HistoryFilters {
  type: HistoryTypeFilter;
  courseId: number | "all";
  search: string;
  range: HistoryDateRange;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD inclusive end
}

export const HISTORY_TYPE_OPTIONS = [
  { value: "all", label: "All changes" },
  { value: "new", label: "New" },
  { value: "updated", label: "Updated" },
  { value: "announcement", label: "Announcement" },
  { value: "deadline", label: "Deadline" },
  { value: "unavailable", label: "Unavailable" },
  { value: "restored", label: "Restored" },
] as const;

export const HISTORY_RANGE_OPTIONS = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
] as const;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function rangeBounds(range: HistoryDateRange, now = new Date(), from?: string, to?: string): { start: number | null; end: number | null } {
  const today = startOfDay(now).getTime();
  if (range === "all") return { start: null, end: null };
  if (range === "today") return { start: today, end: today + 86_400_000 - 1 };
  if (range === "7d") return { start: today - 6 * 86_400_000, end: null };
  if (range === "30d") return { start: today - 29 * 86_400_000, end: null };
  const start = from ? startOfDay(new Date(from + "T00:00:00")).getTime() : null;
  const end = to ? startOfDay(new Date(to + "T00:00:00")).getTime() + 86_400_000 - 1 : null;
  return { start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null };
}

export function filterHistoryEvents(events: readonly ChangeEvent[], filters: HistoryFilters, now = new Date()): ChangeEvent[] {
  const needle = filters.search.trim().toLowerCase();
  const { start, end } = rangeBounds(filters.range, now, filters.from, filters.to);
  return events.filter((e) => {
    if (filters.type !== "all" && e.changeType !== filters.type) return false;
    if (filters.courseId !== "all" && e.courseId !== filters.courseId) return false;
    if (needle) {
      const hay = `${e.resourceTitle ?? e.title} ${e.courseName ?? ""} ${e.description ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (start != null || end != null) {
      const at = parseTimestamp(e.detectedAt)?.getTime() ?? NaN;
      if (!Number.isFinite(at)) return false;
      if (start != null && at < start) return false;
      if (end != null && at > end) return false;
    }
    return true;
  });
}

export function historyDayLabel(key: string, now = new Date()): string {
  const today = todayKey(now);
  if (key === today) return "Today";
  const yesterday = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export function groupHistoryEvents(events: readonly ChangeEvent[], now = new Date()) {
  const byDay = groupEventsByDay([...events]);
  return [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ key, label: historyDayLabel(key, now), items: byDay.get(key) ?? [] }));
}

export function frozenDeleteCopy(scope: HistoryDeletionScope): { title: string; body: string } {
  const events = scope.eventIds.length;
  const scans = scope.scanIds.length;
  const parts = [
    `${events} ${events === 1 ? "event" : "events"}`,
    `${scans} ${scans === 1 ? "scan record" : "scan records"}`,
  ];
  return {
    title: `Delete ${parts.join(" and ")}?`,
    body: `This permanently removes ${parts.join(" and ")} from this device. Saved files and your baseline are not affected. This can't be undone.`,
  };
}

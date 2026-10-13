// Feed filtering and grouping. Pure so it can be unit tested.

import type { Resource } from "./types";
import { parseTimestamp } from "./format";

export type FeedKind = "all" | "new" | "updated" | "deadlines" | "unavailable";

export const FEED_KINDS: { id: FeedKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "updated", label: "Updated" },
  { id: "deadlines", label: "Deadlines" },
  { id: "unavailable", label: "Unavailable" },
];

/**
 * The timestamp used to order a resource in the activity feed.
 *
 * Order of authority mirrors what the rows display (`describeUpload`):
 * the real upload timestamp from the source first, then the source publish
 * date, then the source modification date, and finally the local detection
 * timestamp (`firstSeenAt`). `lastSeenAt` is deliberately excluded — it is a
 * scan timestamp, not a source date, so it must never stand in for the upload
 * time or push an older upload up merely because its course was scanned later.
 */
export function activityTimestamp(r: Resource): string | null {
  return (
    r.uploadedAt ??
    r.publishedAt ??
    r.modifiedAt ??
    r.firstSeenAt ??
    null
  );
}

/**
 * Newest first. Resources without any timestamp sink to the bottom, and equal
 * timestamps break deterministically by title (case-insensitive) then id.
 */
export function sortByRecency(resources: Resource[]): Resource[] {
  return [...resources].sort((a, b) => {
    const ta = parseTimestamp(activityTimestamp(a))?.getTime() ?? 0;
    const tb = parseTimestamp(activityTimestamp(b))?.getTime() ?? 0;
    if (tb !== ta) return tb - ta;
    const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    if (byTitle !== 0) return byTitle;
    return a.id - b.id;
  });
}

export interface FilterOptions {
  kind?: FeedKind;
  courseId?: number | null;
  search?: string;
  /** resource id -> set of event kinds recorded for it. */
  eventKinds?: Map<number, Set<string>>;
}

export function matchesKind(
  resource: Resource,
  kind: FeedKind,
  eventKinds?: Map<number, Set<string>>,
  now: Date = new Date(),
): boolean {
  const kinds = eventKinds?.get(resource.id);
  switch (kind) {
    case "all":
      return true;
    case "unavailable":
      return resource.availabilityStatus !== "available";
    case "deadlines":
      return Boolean(resource.dueAt && (parseTimestamp(resource.dueAt)?.getTime() ?? 0) > now.getTime());
    case "new":
      return Boolean(kinds && (kinds.has("new") || kinds.has("announcement")));
    case "updated":
      return Boolean(kinds && kinds.has("updated"));
    default:
      return true;
  }
}

export function filterResources(resources: Resource[], opts: FilterOptions = {}): Resource[] {
  const { kind = "all", courseId = null, search = "", eventKinds } = opts;
  const needle = search.trim().toLowerCase();
  const now = new Date();

  return resources.filter((r) => {
    if (courseId != null && r.courseId !== courseId) return false;
    if (needle) {
      const haystack = `${r.title} ${r.courseName ?? ""} ${r.resourceType}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return matchesKind(r, kind, eventKinds, now);
  });
}

/** Compact status label shown on a row, in priority order. */
export function statusLabel(
  resource: Resource,
  eventKinds?: Map<number, Set<string>>,
  now: Date = new Date(),
): string | null {
  const kinds = eventKinds?.get(resource.id);
  if (resource.availabilityStatus !== "available") return "UNAVAILABLE";
  if (resource.dueAt) {
    const due = parseTimestamp(resource.dueAt);
    if (due && due.getTime() - now.getTime() < 1000 * 60 * 60 * 24 * 14) return "DEADLINE";
  }
  if (kinds?.has("updated")) return "UPDATED";
  if (kinds?.has("new") || kinds?.has("announcement")) return "NEW";
  return null;
}

export interface DateGroup {
  key: string;
  label: string;
  items: Resource[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function dayLabel(d: Date, now: Date): string {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const key = dayKey(d);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/** Group resources by the local calendar day of their activity timestamp. */
export function groupByDate(resources: Resource[], now: Date = new Date()): DateGroup[] {
  const groups = new Map<string, DateGroup>();
  for (const r of sortByRecency(resources)) {
    const ts = parseTimestamp(activityTimestamp(r)) ?? new Date(0);
    const key = dayKey(ts);
    if (!groups.has(key)) {
      groups.set(key, { key, label: dayLabel(ts, now), items: [] });
    }
    groups.get(key)!.items.push(r);
  }
  return [...groups.values()];
}

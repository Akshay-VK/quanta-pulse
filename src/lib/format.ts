// Timestamp formatting. Pure and timezone-aware.
//
// Key rule: a detection time is never shown as an upload time. If Quanta does
// not expose an upload/publication timestamp we say so explicitly.

import type { Resource } from "./types";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value.trim());
}

/** Parse a stored timestamp into a Date, treating date-only values as local. */
export function parseTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (DATE_ONLY.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "11 Oct 2026" */
export function formatDate(value?: string | null): string {
  const d = parseTimestamp(value);
  return d ? dateFmt.format(d) : "\u2014";
}

/**
 * "11 Oct 2026, 14:35" — or just the date when only a date is known.
 * Never invents a time of day.
 */
export function formatCompact(value?: string | null): string {
  if (!value) return "\u2014";
  const d = parseTimestamp(value);
  if (!d) return "\u2014";
  if (isDateOnly(value)) return dateFmt.format(d);
  return dateTimeFmt.format(d);
}

const timeOfDayFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Local time of day, e.g. "14:35". Used for event rows inside a day view. */
export function formatTimeOfDay(value?: string | null): string {
  const d = parseTimestamp(value);
  return d ? timeOfDayFmt.format(d) : "\u2014";
}

/** "2 hours ago", "in 3 days", "just now". */
export function relativeLabel(value?: string | null, now: Date = new Date()): string {
  const d = parseTimestamp(value);
  if (!d) return "";
  const diff = d.getTime() - now.getTime();
  const absMinutes = Math.round(Math.abs(diff) / 60000);
  const future = diff > 0;

  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
  let text: string;
  if (absMinutes < 1) {
    text = "just now";
  } else if (absMinutes < 60) {
    text = unit(absMinutes, "minute");
  } else if (absMinutes < 60 * 24) {
    text = unit(Math.round(absMinutes / 60), "hour");
  } else if (absMinutes < 60 * 24 * 30) {
    text = unit(Math.round(absMinutes / (60 * 24)), "day");
  } else {
    text = unit(Math.round(absMinutes / (60 * 24 * 30)), "month");
  }

  if (text === "just now") return text;
  return future ? `in ${text}` : `${text} ago`;
}

export type UploadSource = "uploaded" | "published" | "modified" | "unavailable";

export interface UploadDisplay {
  /** Human label for the primary date shown on a row. */
  label: string;
  source: UploadSource;
  /** Text explaining where the timestamp came from, when not a true upload. */
  note?: string;
  /** When Quanta Pulse first detected the resource. */
  detected: string;
}

/**
 * Decide which timestamp to show for a resource and how to describe it.
 * Order of authority: uploaded > published > modified > unavailable.
 */
export function describeUpload(resource: Resource): UploadDisplay {
  const detected = formatCompact(resource.firstSeenAt);
  if (resource.uploadedAt) {
    return { label: formatCompact(resource.uploadedAt), source: "uploaded", detected };
  }
  if (resource.publishedAt) {
    return {
      label: formatCompact(resource.publishedAt),
      source: "published",
      note: "published",
      detected,
    };
  }
  if (resource.modifiedAt) {
    return {
      label: formatCompact(resource.modifiedAt),
      source: "modified",
      note: "last modified",
      detected,
    };
  }
  return { label: "Upload date unavailable", source: "unavailable", detected };
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function todayLabel(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

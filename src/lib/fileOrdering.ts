import { parseTimestamp } from "./format";
import type { Resource } from "./types";

// Fixed locale keeps browsing order independent of the device's default locale.
const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Numeric names compare naturally; equivalent spellings defer to identity. */
export function compareNames(a: string, b: string): number {
  return names.compare(a, b);
}

export function compareResourceNames(a: Resource, b: Resource): number {
  return compareNames(a.title, b.title) || a.id - b.id;
}

/** Known dates precede unknown dates in either direction. */
export function compareDates(a: string | null, b: string | null, direction: "asc" | "desc"): number {
  const ta = parseTimestamp(a)?.getTime() ?? null;
  const tb = parseTimestamp(b)?.getTime() ?? null;
  if (ta === null) return tb === null ? 0 : 1;
  if (tb === null) return -1;
  return direction === "asc" ? ta - tb : tb - ta;
}

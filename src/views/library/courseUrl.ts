import type { Course } from "../../lib/types";

/** The course's real Quanta homepage URL, when it is a usable http(s) link. */
export function courseHomeUrl(course: Course): string | null {
  const raw = course.url?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

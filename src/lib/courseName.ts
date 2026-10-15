// Course presentation: display names, user aliases and stable dot colours.
//
// Moodle course names arrive raw ("1166_ECE_INSTR_EEE_ECOM F215"). Everything
// user-facing shows the trailing course code instead, while tooltips and
// captions keep the raw name.

import type { Course } from "./types";

export type CourseAliases = Record<string, string>;

export const ALIASES_KEY = "quanta-pulse-course-aliases";
export const COLORS_KEY = "quanta-pulse-course-colors";
/** Number of hues in the palette; the first 12 courses must never share one. */
export const DOT_COUNT = 12;

const CODE = /^[A-Z][A-Z0-9&/.-]{1,9}$/;
const NUMBER = /^[A-Z]?\d{3,4}[A-Z]?$/;

function tokens(raw: string): string[] {
  return raw.trim().split(/[\s_]+/).filter(Boolean);
}

/**
 * The trailing "<CODE> <NUMBER>" of a raw name, or the raw name unchanged when
 * it has no course code (e.g. "Discrete Mathematics" stays as it is).
 */
export function deriveDisplayName(raw: string): string {
  const parts = tokens(raw);
  const n = parts.length;
  if (n >= 2 && CODE.test(parts[n - 2]) && NUMBER.test(parts[n - 1])) {
    return `${parts[n - 2]} ${parts[n - 1]}`;
  }
  return raw.trim();
}

/** The department prefix that tells two courses with the same code apart. */
function qualifier(raw: string): string | null {
  // Drop a leading numeric id and the trailing "<code> <number>" pair.
  const prefix = tokens(raw).slice(1, -2);
  return prefix.length > 0 ? prefix.join("/") : null;
}

/** A course's own name, with a user alias winning over the derived code. */
export function displayName(course: Course, aliases: CourseAliases = {}): string {
  const alias = aliases[String(course.id)]?.trim();
  if (alias) return alias;
  return deriveDisplayName(course.name) || course.shortName || course.name;
}

/**
 * Display names for a whole course list, with a distinguishing suffix appended
 * wherever two courses derive the same name ("ECOM F215 (ECE/INSTR/EEE)").
 */
export function buildDisplayNames(
  courses: Course[],
  aliases: CourseAliases = {},
): Map<number, string> {
  const names = new Map(courses.map((c) => [c.id, displayName(c, aliases)]));
  const groups = new Map<string, number[]>();
  for (const course of courses) {
    const name = names.get(course.id) as string;
    groups.set(name, [...(groups.get(name) ?? []), course.id]);
  }
  for (const [name, ids] of groups) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const course = courses.find((c) => c.id === id) as Course;
      const extra = qualifier(course.name) ?? course.name.trim();
      if (extra) names.set(id, `${name} (${extra})`);
    }
  }
  return names;
}

export interface DotAssignment {
  index: Map<number, number>;
  stored: Record<string, number>;
}

/**
 * Assign dot colours in order of first sight from a 12-hue palette. Previously
 * assigned indices are kept, so a course keeps its colour between sessions.
 */
export function assignDotIndices(
  courses: Course[],
  stored: Record<string, number> = {},
): DotAssignment {
  const index = new Map<number, number>();
  const next: Record<string, number> = { ...stored };
  const used = new Set<number>();

  for (const course of courses) {
    const saved = next[String(course.id)];
    if (Number.isInteger(saved) && saved >= 0 && saved < DOT_COUNT) {
      index.set(course.id, saved);
      used.add(saved);
    }
  }
  let cursor = 0;
  for (const course of courses) {
    if (index.has(course.id)) continue;
    while (used.has(cursor % DOT_COUNT)) cursor += 1;
    const value = cursor % DOT_COUNT;
    index.set(course.id, value);
    next[String(course.id)] = value;
    used.add(value);
    cursor += 1;
  }
  return { index, stored: next };
}

function readStore(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota: names and colours fall back to derived values.
  }
}

export function loadAliases(): CourseAliases {
  const store = readStore(ALIASES_KEY);
  const out: CourseAliases = {};
  for (const [id, value] of Object.entries(store)) {
    if (typeof value === "string" && value.trim()) out[id] = value;
  }
  return out;
}

export function saveAliases(aliases: CourseAliases): void {
  writeStore(ALIASES_KEY, aliases);
}

export function loadDotIndices(): Record<string, number> {
  const store = readStore(COLORS_KEY);
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(store)) {
    if (Number.isInteger(value)) out[id] = value as number;
  }
  return out;
}

export function saveDotIndices(value: Record<string, number>): void {
  writeStore(COLORS_KEY, value);
}

// --------------------------------------------------------------- registry

export interface CourseLabel {
  name: string;
  raw: string;
  dot: number;
}

// Views deep in the tree (rows, pills, palette) all need the same three
// values per course. One module-level registry keeps that from being drilled
// through a dozen presentational components.
const registry = new Map<number, CourseLabel>();

/** Rebuild the shared lookup. Called by the shell whenever courses change. */
export function registerCourseLabels(courses: Course[]): void {
  const aliases = loadAliases();
  const names = buildDisplayNames(courses, aliases);
  const dots = assignDotIndices(courses, loadDotIndices());
  registry.clear();
  for (const course of courses) {
    registry.set(course.id, {
      name: names.get(course.id) as string,
      raw: course.name,
      dot: dots.index.get(course.id) ?? 0,
    });
  }
  saveDotIndices(dots.stored);
}

export function courseLabel(courseId: number | null | undefined): CourseLabel | null {
  if (courseId == null) return null;
  return registry.get(courseId) ?? null;
}

/** Display name, falling back to whatever raw name the caller has. */
export function courseTitle(
  courseId: number | null | undefined,
  fallback?: string | null,
): string {
  const label = courseLabel(courseId);
  if (label) return label.name;
  return fallback?.trim() || "Course";
}

export function courseDot(courseId: number | null | undefined): number {
  return courseLabel(courseId)?.dot ?? 0;
}

/** The tooltip for a truncated course name: display name plus the raw name. */
export function courseTooltip(courseId: number | null | undefined): string | null {
  const label = courseLabel(courseId);
  if (!label) return null;
  return label.raw === label.name ? label.name : `${label.name} — ${label.raw}`;
}
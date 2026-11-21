/** Shared offline metadata search policy for the command palette and Library. */
import type { Course, Resource } from "./types";
import { parsePaletteQuery, normalizeSearchText as norm } from "./paletteQuery";
import { activityTimestamp } from "./filter";
import { parseTimestamp } from "./format";
import { resourceSectionPath } from "./sectionPath";
import { resolveTimezone, localDateKey } from "./agenda";

export type SearchScope =
  | { kind: "everywhere" }
  | { kind: "course"; courseId: number }
  | { kind: "folder"; courseId: number; path: string[] };

export interface SearchFilters {
  sourceFrom?: string;
  sourceThrough?: string;
}

export interface SearchRequest {
  raw: string;
  scope: SearchScope;
  filters?: SearchFilters;
  now?: Date | string | number;
  timeZone?: string;
  clock?: Date | string | number;
  timezone?: string;
}

export interface SearchFolder {
  id: string;
  courseId: number;
  path: string[];
  name: string;
}

export interface SearchInventory {
  courses: readonly Course[];
  resources: readonly Resource[];
  displayNames?: ReadonlyMap<number, string>;
  unreadIds?: ReadonlySet<number>;
  savedIds?: ReadonlySet<number>;
  revision?: string;
  now?: Date | string | number;
  timeZone?: string;
  timezone?: string;
  clock?: Date | string | number;
}

export interface SearchResult {
  parsed: ReturnType<typeof parsePaletteQuery>;
  errors: string[];
  files: Resource[];
  folders: SearchFolder[];
  courses: Course[];
  request: SearchRequest;
  revision?: string;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") return new Date(value);
  return new Date();
}

function timeZoneOf(request: SearchRequest, inventory: SearchInventory, options?: any): string {
  return resolveTimezone(
    request.timeZone ?? request.timezone ?? inventory.timeZone ?? inventory.timezone ?? options?.timeZone ?? options?.timezone,
  );
}

function nowOf(request: SearchRequest, inventory: SearchInventory, options?: any): Date {
  const raw = request.now ?? request.clock ?? inventory.now ?? inventory.clock ?? options?.now ?? options?.clock;
  return raw === undefined ? new Date() : toDate(raw);
}

function validDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function activityDateKey(resource: Resource, timeZone: string): string | null {
  const ts = activityTimestamp(resource);
  if (!ts) return null;
  const parsed = parseTimestamp(ts);
  if (!parsed) {
    if (validDateKey(ts)) return ts;
    return null;
  }
  return localDateKey(parsed, timeZone);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dueDayKey(resource: Resource, timeZone: string): string | null {
  if (!resource.dueAt) return null;
  if (isDateOnly(resource.dueAt)) return resource.dueAt;
  const parsed = parseTimestamp(resource.dueAt);
  if (!parsed) return null;
  return localDateKey(parsed, timeZone);
}

export function inSearchScope(resource: Resource, scope: SearchScope): boolean {
  if (scope.kind === "everywhere") return true;
  if (resource.courseId !== scope.courseId) return false;
  if (scope.kind === "course") return true;
  const path = resourceSectionPath(resource);
  return scope.path.every((segment, index) => path[index] === segment);
}

export function searchDesktop(request: SearchRequest, inventory: SearchInventory, options?: any): SearchResult {
  const tz = timeZoneOf(request, inventory, options);
  const now = nowOf(request, inventory, options);
  const parsed = parsePaletteQuery(request.raw, {
    courses: inventory.courses as any,
    resources: inventory.resources as any,
    displayNames: inventory.displayNames,
  });
  const errors = [...parsed.errors];
  const terms = parsed.terms.map(norm).filter(Boolean);
  const byCourse = new Map((inventory.courses as Course[]).map((c) => [c.id, c]));
  const unreadIds = inventory.unreadIds ?? new Set<number>();
  const savedIds = inventory.savedIds ?? new Set<number>();
  const isSaved = (r: Resource) => savedIds.has(r.id);
  const isUnread = (r: Resource) => unreadIds.has(r.id);

  const courseFields = (c?: Course) => {
    if (!c) return [];
    const values = [c.name, c.shortName ?? "", c.displayName ?? "", inventory.displayNames?.get(c.id) ?? ""];
    return values;
  };

  const fileFiltersActive =
    Boolean(parsed.filters.types?.length) ||
    Boolean(parsed.filters.is?.length) ||
    Boolean(parsed.filters.due?.length) ||
    Boolean(request.filters?.sourceFrom) ||
    Boolean(request.filters?.sourceThrough);

  // Match a single file against scope + query + filters.
  const fileMatches = (r: Resource): boolean => {
    if (errors.length) return false;
    if (!inSearchScope(r, request.scope)) return false;
    if (parsed.filters.courseIds && (r.courseId === null || !parsed.filters.courseIds.includes(r.courseId))) return false;
    if (parsed.filters.types && !parsed.filters.types.includes(r.resourceType)) return false;
    const unread = isUnread(r);
    const saved = isSaved(r);
    if (parsed.filters.is?.includes("read") && unread) return false;
    if (parsed.filters.is?.includes("unread") && !unread) return false;
    if (parsed.filters.is?.includes("saved") && !saved) return false;
    if (parsed.filters.is?.includes("unsaved") && saved) return false;

    const dueValues = parsed.filters.due ?? [];
    if (dueValues.length) {
      const dk = dueDayKey(r, tz);
      const todayKey = localDateKey(now, tz);
      if (dueValues.includes("none")) {
        if (dk) return false;
      } else {
        if (!dk) return false;
        const isToday = dk === todayKey;
        const isOverdue = dk < todayKey;
        const isWeek = !isOverdue && (dateOrdinal(dk) - dateOrdinal(todayKey)) < 7;
        const matches =
          (dueValues.includes("today") && isToday) ||
          (dueValues.includes("week") && isWeek) ||
          (dueValues.includes("overdue") && isOverdue);
        if (!matches) return false;
      }
    }

    const from = request.filters?.sourceFrom;
    const through = request.filters?.sourceThrough;
    if (from || through) {
      const key = activityDateKey(r, tz);
      if (!key) return false;
      if (from && key < from) return false;
      if (through && key > through) return false;
    }

    const fields = [
      r.title,
      r.resourceType,
      ...resourceSectionPath(r),
      resourceSectionPath(r).join(" / "),
      ...courseFields(byCourse.get(r.courseId ?? -1)),
    ];
    const haystack = fields.map(norm).join(" ");
    if (terms.length === 0) return true;
    return terms.every((term) => haystack.includes(term));
  };

  const candidateFiles = (inventory.resources as Resource[]).filter(fileMatches);

  // Rank files.
  const phrase = terms.join(" ");
  const scoreTitle = (title: string): number => {
    const value = norm(title);
    if (!phrase) return 3;
    if (value === phrase) return 0;
    if (value.startsWith(phrase)) return 1;
    if (terms.length > 0 && terms.every((t) => value.includes(t))) return 2;
    return 3;
  };
  const activityTime = (r: Resource): number => {
    const ts = activityTimestamp(r);
    const parsedTs = ts ? parseTimestamp(ts) : null;
    return parsedTs ? parsedTs.getTime() : Number.NEGATIVE_INFINITY;
  };
  const rankedFiles = [...candidateFiles].sort((a, b) => {
    const sa = scoreTitle(a.title);
    const sb = scoreTitle(b.title);
    if (sa !== sb) return sa - sb;
    const ta = activityTime(a);
    const tb = activityTime(b);
    if (tb !== ta) return tb - ta;
    return a.id - b.id;
  });

  // Folders.
  const folderMap = new Map<string, SearchFolder>();
  for (const r of inventory.resources as Resource[]) {
    if (r.courseId == null) continue;
    if (!inSearchScope(r, request.scope)) continue; // only folders within scope resources
    const path = resourceSectionPath(r);
    path.forEach((name, i) => {
      const segments = path.slice(0, i + 1);
      const id = JSON.stringify([r.courseId, segments]);
      if (!inFolderScope(segments, request.scope, r.courseId!)) return;
      folderMap.set(id, { id, courseId: r.courseId!, path: segments, name });
    });
  }

  // Filter folders by query + file-filter rule.
  const folderMatches = (f: SearchFolder): boolean => {
    if (errors.length) return false;
    const c = byCourse.get(f.courseId);
    const fields = [f.name, f.path.join(" / "), ...courseFields(c)];
    const haystack = fields.map(norm).join(" ");
    if (terms.length > 0 && !terms.every((t) => haystack.includes(t))) return false;
    // course filter
    if (parsed.filters.courseIds && !parsed.filters.courseIds.includes(f.courseId)) return false;
    if (fileFiltersActive) {
      // must contain at least one matching file in its scope
      const has = rankedFiles.some((r) => r.courseId === f.courseId && resourceSectionPath(r).length >= f.path.length && f.path.every((p, i) => resourceSectionPath(r)[i] === p));
      if (!has) return false;
    }
    return true;
  };
  const rankedFolders = [...folderMap.values()]
    .filter(folderMatches)
    .sort((a, b) => {
      const sa = scoreTitle(a.name);
      const sb = scoreTitle(b.name);
      if (sa !== sb) return sa - sb;
      if (a.path.length !== b.path.length) return a.path.length - b.path.length;
      return a.id.localeCompare(b.id);
    });

  // Courses.
  const courseMatches = (c: Course): boolean => {
    if (errors.length) return false;
    if (request.scope.kind !== "everywhere" && c.id !== request.scope.courseId) return false;
    if (parsed.filters.courseIds && !parsed.filters.courseIds.includes(c.id)) return false;
    const fields = courseFields(c);
    const haystack = fields.map(norm).join(" ");
    if (terms.length > 0 && !terms.every((t) => haystack.includes(t))) return false;
    if (fileFiltersActive) {
      const has = rankedFiles.some((r) => r.courseId === c.id);
      if (!has) return false;
    }
    return true;
  };
  const rankedCourses = (inventory.courses as Course[])
    .filter(courseMatches)
    .sort((a, b) => {
      const an = inventory.displayNames?.get(a.id) ?? a.displayName ?? a.name;
      const bn = inventory.displayNames?.get(b.id) ?? b.displayName ?? b.name;
      const sa = scoreTitle(an);
      const sb = scoreTitle(bn);
      if (sa !== sb) return sa - sb;
      return a.id - b.id;
    });

  return {
    parsed,
    errors,
    files: rankedFiles,
    folders: rankedFolders,
    courses: rankedCourses,
    request,
    revision: inventory.revision,
  };
}

function inFolderScope(segments: string[], scope: SearchScope, courseId: number): boolean {
  if (scope.kind === "everywhere") return true;
  if (scope.courseId !== courseId) return false;
  if (scope.kind === "course") return true;
  // folder scope: segments must be under scope.path
  return scope.path.every((p, i) => segments[i] === p);
}

function dateOrdinal(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000);
}

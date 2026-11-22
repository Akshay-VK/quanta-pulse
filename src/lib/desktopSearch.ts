import { dedupeCourseResources } from "./courseTree";
import { sortResources, resourceCategory, type ResourceCategoryId } from "./courseLibrary";
/** Shared offline metadata search policy for the command palette and Library. */
import type { Course, Resource } from "./types";
import { parsePaletteQuery, normalizeSearchText as norm } from "./paletteQuery";
import { activityTimestamp } from "./filter";
import { parseTimestamp } from "./format";
import { resourceSectionPath } from "./sectionPath";
import { resolveTimezone, localDateKey, validCalendarDate, validCalendarInstant } from "./agenda";

export type SearchScope =
  | { kind: "everywhere" }
  | { kind: "course"; courseId: number }
  | { kind: "folder"; courseId: number; path: string[] };

export interface SearchQueryState extends SearchFilters {
  raw: string;
  scope: SearchScope;
  sourceFrom?: string | null;
  sourceThrough?: string | null;
  requestId: number;
  revision?: string | null;
}

export interface SearchFilters {
  includeSavedText?: boolean;
  category?: ResourceCategoryId | "all";
  sourceFrom?: string | null;
  sourceThrough?: string | null;
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
  bodyHits?: ReadonlyMap<number, string>;
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

function timeZoneOf(request: SearchRequest, inventory: SearchInventory, options?: { now?: Date | string | number; clock?: Date | string | number; timeZone?: string; timezone?: string }): string {
  return resolveTimezone(
    request.timeZone ?? request.timezone ?? inventory.timeZone ?? inventory.timezone ?? options?.timeZone ?? options?.timezone,
  );
}

function nowOf(request: SearchRequest, inventory: SearchInventory, options?: { now?: Date | string | number; clock?: Date | string | number; timeZone?: string; timezone?: string }): Date {
  const raw = request.now ?? request.clock ?? inventory.now ?? inventory.clock ?? options?.now ?? options?.clock;
  return raw === undefined ? new Date() : toDate(raw);
}


function activityDateKey(resource: Resource, timeZone: string): string | null {
  const ts = activityTimestamp(resource);
  if (!ts) return null;
  if (isDateOnly(ts)) return validCalendarDate(ts) ? ts : null;
  const parsed = validCalendarInstant(ts) ? parseTimestamp(ts) : null;
  if (!parsed) {
    if (validCalendarDate(ts)) return ts;
    return null;
  }
  return localDateKey(parsed, timeZone);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dueDayKey(resource: Resource, timeZone: string): string | null {
  if (!resource.dueAt) return null;
  if (isDateOnly(resource.dueAt)) return validCalendarDate(resource.dueAt) ? resource.dueAt : null;
  const parsed = validCalendarInstant(resource.dueAt) ? parseTimestamp(resource.dueAt) : null;
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

export function searchDesktop(request: SearchRequest, inventory: SearchInventory, options?: { now?: Date | string | number; clock?: Date | string | number; timeZone?: string; timezone?: string }): SearchResult {
  const resources = dedupeCourseResources([...inventory.resources]);
  const tz = timeZoneOf(request, inventory, options);
  const now = nowOf(request, inventory, options);
  const parsed = parsePaletteQuery(request.raw, {
    courses: inventory.courses,
    resources: inventory.resources,
    displayNames: inventory.displayNames,
  });
  const errors = [...parsed.errors];
  const { sourceFrom: from, sourceThrough: through } = request.filters ?? {};
  if ((from && !validCalendarDate(from)) || (through && !validCalendarDate(through))) errors.push("Invalid source date");
  if (from && through && from > through) errors.push("Source date start must precede end");
  if (request.scope.kind !== "everywhere") {
    const scope = request.scope;
    if (!inventory.courses.some(c => c.id === scope.courseId)) errors.push("Course unavailable");
    else if (scope.kind === "folder" && !inventory.resources.some(r => inSearchScope(r, scope))) errors.push("Folder unavailable");
  }
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

  const fileFiltersActive = Boolean(request.filters?.category && request.filters.category !== "all") ||
    Boolean(parsed.filters.types?.length) ||
    Boolean(parsed.filters.is?.length) ||
    Boolean(parsed.filters.due?.length) ||
    Boolean(request.filters?.sourceFrom) ||
    Boolean(request.filters?.sourceThrough);

  const bodyOnly = new Set<number>();
  // Match a single file against scope + query + filters.
  const fileMatches = (r: Resource): boolean => {
    if (errors.length) return false;
    if (!inSearchScope(r, request.scope)) return false;
    if (request.filters?.category && request.filters.category !== "all" && resourceCategory(r.resourceType) !== request.filters.category) return false;
    if (parsed.filters.courseIds && (r.courseId === null || !parsed.filters.courseIds.includes(r.courseId))) return false;
    if (parsed.filters.types && !parsed.filters.types.some(type => norm(type) === norm(r.resourceType))) return false;
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
      const overdue = dk && (isDateOnly(r.dueAt!) ? dk < todayKey : new Date(r.dueAt!).getTime() < now.getTime());
      const matches = (!dk && dueValues.includes("none")) || Boolean(dk && (
        (dueValues.includes("today") && dk === todayKey) ||
        (dueValues.includes("week") && !overdue && dateOrdinal(dk) - dateOrdinal(todayKey) < 7) ||
        (dueValues.includes("overdue") && overdue)
      ));
      if (!matches) return false;
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
    if (terms.every((term) => haystack.includes(term))) return true;
    if (!request.filters?.includeSavedText || !inventory.bodyHits?.has(r.id)) return false;
    bodyOnly.add(r.id);
    return true;
  };

  const candidateFiles = resources.filter(fileMatches);

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
    const parsedTs = ts && (validCalendarInstant(ts) || validCalendarDate(ts)) ? parseTimestamp(ts) : null;
    return parsedTs ? parsedTs.getTime() : Number.NEGATIVE_INFINITY;
  };
  const rankedFiles = terms.length === 0 ? sortResources(candidateFiles, "newest") : [...candidateFiles].sort((a, b) => {
    const sa = bodyOnly.has(a.id) ? 4 : scoreTitle(a.title);
    const sb = bodyOnly.has(b.id) ? 4 : scoreTitle(b.title);
    if (sa !== sb) return sa - sb;
    const ta = activityTime(a);
    const tb = activityTime(b);
    if (tb !== ta) return tb - ta;
    return a.id - b.id;
  });

  const matchingCourses = new Set(rankedFiles.map(r => r.courseId));
  const matchingFolders = new Set<string>();
  for (const r of rankedFiles) {
    const path = resourceSectionPath(r);
    path.forEach((_, i) => matchingFolders.add(JSON.stringify([r.courseId, path.slice(0, i + 1)])));
  }

  // Folders.
  const folderMap = new Map<string, SearchFolder>();
  for (const r of resources) {
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
      const has = matchingFolders.has(f.id);
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
      const has = matchingCourses.has(c.id);
      if (!has) return false;
    }
    return true;
  };
  const rankedCourses = (inventory.courses as Course[])
    .filter(courseMatches)
    .sort((a, b) => {
      const sa = Math.min(...courseFields(a).map(scoreTitle));
      const sb = Math.min(...courseFields(b).map(scoreTitle));
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

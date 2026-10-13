// Pure helpers for a single course's resource library: category grouping,
// sorting and filtering. Everything here is driven by the stored resource
// metadata — categories come from the resource *type*, never from title
// heuristics, so a resource is never misfiled by a guess.

import { activityTimestamp } from "./filter";
import { parseTimestamp } from "./format";
import type { Resource } from "./types";
import { formatSectionPath } from "./sectionPath";

export type ResourceCategoryId =
  | "pdf"
  | "notes"
  | "presentations"
  | "spreadsheets"
  | "assignments"
  | "papers"
  | "announcements"
  | "media"
  | "archives"
  | "links"
  | "folders"
  | "other";

export interface ResourceCategory {
  id: ResourceCategoryId;
  label: string;
  /** Resource types that belong to this category (lower-case). */
  types: string[];
}

/** Display order for the grouped library. */
export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  { id: "pdf", label: "PDFs", types: ["pdf"] },
  {
    id: "notes",
    label: "Lecture notes",
    types: ["document", "file", "page", "book", "notebook", "note", "label", "wiki"],
  },
  { id: "presentations", label: "Presentations", types: ["presentation"] },
  { id: "spreadsheets", label: "Spreadsheets", types: ["spreadsheet"] },
  { id: "assignments", label: "Assignments", types: ["assignment"] },
  { id: "papers", label: "Question papers", types: ["quiz"] },
  { id: "announcements", label: "Announcements", types: ["announcement"] },
  { id: "media", label: "Media", types: ["image", "audio", "video", "interactive"] },
  { id: "archives", label: "Archives", types: ["archive"] },
  { id: "links", label: "Links", types: ["external link", "external tool", "link"] },
  { id: "folders", label: "Folders", types: ["folder"] },
  { id: "other", label: "Other", types: [] },
];

const CATEGORY_BY_TYPE = new Map<string, ResourceCategoryId>();
for (const category of RESOURCE_CATEGORIES) {
  for (const type of category.types) {
    if (!CATEGORY_BY_TYPE.has(type)) CATEGORY_BY_TYPE.set(type, category.id);
  }
}

const CATEGORY_LABELS = new Map(RESOURCE_CATEGORIES.map((c) => [c.id, c.label]));

/** The category a resource type belongs to; anything unknown is "other". */
export function resourceCategory(type: string | null | undefined): ResourceCategoryId {
  return CATEGORY_BY_TYPE.get((type ?? "").trim().toLowerCase()) ?? "other";
}

export function categoryLabel(id: ResourceCategoryId): string {
  return CATEGORY_LABELS.get(id) ?? "Other";
}

export type ResourceSort = "newest" | "oldest" | "name" | "type";

export const RESOURCE_SORTS: { id: ResourceSort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "name", label: "Name (A–Z)" },
  { id: "type", label: "File type" },
];

function timestampValue(r: Resource): number | null {
  const at = activityTimestamp(r);
  const parsed = at ? parseTimestamp(at) : null;
  return parsed ? parsed.getTime() : null;
}

function byTitle(a: Resource, b: Resource): number {
  const cmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  return cmp !== 0 ? cmp : a.id - b.id;
}

/**
 * Sort a copy of the resources. Records missing any timestamp always sink to
 * the bottom regardless of direction — an unknown date is never presented as
 * the oldest upload.
 */
export function sortResources(resources: Resource[], sort: ResourceSort): Resource[] {
  const copy = [...resources];
  switch (sort) {
    case "name":
      return copy.sort(byTitle);
    case "type":
      return copy.sort((a, b) => {
        const cmp = a.resourceType.localeCompare(b.resourceType, undefined, {
          sensitivity: "base",
        });
        return cmp !== 0 ? cmp : byTitle(a, b);
      });
    case "oldest":
      return copy.sort((a, b) => {
        const ta = timestampValue(a);
        const tb = timestampValue(b);
        if (ta === null && tb === null) return byTitle(a, b);
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta !== tb ? ta - tb : byTitle(a, b);
      });
    case "newest":
    default:
      return copy.sort((a, b) => {
        const ta = timestampValue(a);
        const tb = timestampValue(b);
        if (ta === null && tb === null) return byTitle(a, b);
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta !== tb ? tb - ta : byTitle(a, b);
      });
  }
}

export interface LibraryFilters {
  search?: string;
  /** Exact resource type; empty string means all. */
  type?: string;
  category?: ResourceCategoryId | "all";
}

/** Search, type and category filters, all applied together. */
export function filterCourseResources(
  resources: Resource[],
  filters: LibraryFilters = {},
): Resource[] {
  const needle = (filters.search ?? "").trim().toLowerCase();
  const type = (filters.type ?? "").trim().toLowerCase();
  const category = filters.category && filters.category !== "all" ? filters.category : null;

  return resources.filter((r) => {
    if (type && r.resourceType.trim().toLowerCase() !== type) return false;
    if (category && resourceCategory(r.resourceType) !== category) return false;
    if (needle) {
      const haystack =
        `${r.title} ${r.resourceType} ${formatSectionPath(r)}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export interface ResourceGroup {
  id: ResourceCategoryId;
  label: string;
  items: Resource[];
}

/** Group resources by category in the canonical display order, sorted within. */
export function groupByCategory(
  resources: Resource[],
  sort: ResourceSort = "newest",
): ResourceGroup[] {
  const byCategory = new Map<ResourceCategoryId, Resource[]>();
  for (const r of resources) {
    const id = resourceCategory(r.resourceType);
    const bucket = byCategory.get(id);
    if (bucket) bucket.push(r);
    else byCategory.set(id, [r]);
  }

  const groups: ResourceGroup[] = [];
  for (const category of RESOURCE_CATEGORIES) {
    const items = byCategory.get(category.id);
    if (items && items.length > 0) {
      groups.push({ id: category.id, label: category.label, items: sortResources(items, sort) });
    }
  }
  return groups;
}

/** The distinct resource types present, with counts, for the type filter. */
export function typeOptions(resources: Resource[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of resources) {
    counts.set(r.resourceType, (counts.get(r.resourceType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type, undefined, { sensitivity: "base" }));
}

/** The categories actually present, in display order, with counts. */
export function categoryOptions(
  resources: Resource[],
): { id: ResourceCategoryId; label: string; count: number }[] {
  const counts = new Map<ResourceCategoryId, number>();
  for (const r of resources) {
    const id = resourceCategory(r.resourceType);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return RESOURCE_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => ({
    id: c.id,
    label: c.label,
    count: counts.get(c.id) ?? 0,
  }));
}

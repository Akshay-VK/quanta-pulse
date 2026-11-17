import type { Course, Resource } from "./types";
import { splitLiteralMatches, type LiteralMatchPart } from "./filter";

export type PaletteTokenKey = "course" | "type" | "is" | "due";

export interface PaletteQueryToken {
  key: string;
  value: string;
  raw: string;
  recognized: boolean;
  valid: boolean;
  reason?: "unknown-key" | "invalid-value";
}

export interface PaletteQuery {
  raw: string;
  freeText: string;
  tokens: PaletteQueryToken[];
  filters: {
    courseIds: number[] | null;
    types: string[] | null;
    is: Array<"read" | "unread" | "saved" | "unsaved"> | null;
    due: Array<"today" | "week" | "overdue" | "none"> | null;
  };
  hasKnownInvalid: boolean;
  highlight(text: string, query?: string): LiteralMatchPart[];
}

const RECOGNIZED: Record<string, true> = { course: true, type: true, is: true, due: true };
const IS_VALUES = new Set(["read", "unread", "saved", "unsaved"]);
const DUE_VALUES = new Set(["today", "week", "overdue", "none"]);

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function parsePaletteQuery(
  raw: string,
  inventory: { courses: readonly Pick<Course, "id" | "name" | "shortName">[]; resources: readonly Pick<Resource, "id" | "courseId" | "courseName" | "resourceType" | "dueAt" | "availabilityStatus">[] },
): PaletteQuery {
  const tokens: PaletteQueryToken[] = [];
  const free: string[] = [];
  const courseIds = new Set<number>();
  const types = new Set<string>();
  const is = new Set<"read" | "unread" | "saved" | "unsaved">();
  const due = new Set<"today" | "week" | "overdue" | "none">();

  const typeInventory = new Map(inventory.resources.map((r) => [norm(r.resourceType), r.resourceType]));
  for (const part of raw.trim().split(/\s+/).filter(Boolean)) {
    const idx = part.indexOf(":");
    if (idx <= 0) {
      free.push(part);
      continue;
    }
    const key = norm(part.slice(0, idx));
    const value = part.slice(idx + 1);
    const rawToken = part;
    if (!RECOGNIZED[key]) {
      tokens.push({ key, value, raw: rawToken, recognized: false, valid: false, reason: "unknown-key" });
      continue;
    }
    if (key === "course") {
      const needle = norm(value);
      const matches = inventory.courses.filter((c) => norm(c.shortName ?? "").includes(needle) || norm(c.name).includes(needle) || String(c.id) === needle);
      const valid = Boolean(needle) && matches.length > 0;
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      matches.forEach((c) => courseIds.add(c.id));
      continue;
    }
    if (key === "type") {
      const found = typeInventory.get(norm(value));
      const valid = Boolean(found);
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      if (found) types.add(found);
      continue;
    }
    if (key === "is") {
      const v = norm(value);
      const valid = IS_VALUES.has(v);
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      if (valid) is.add(v as "read" | "unread" | "saved" | "unsaved");
      continue;
    }
    if (key === "due") {
      const v = norm(value);
      const valid = DUE_VALUES.has(v);
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      if (valid) due.add(v as "today" | "week" | "overdue" | "none");
      continue;
    }
  }
  const freeText = free.join(" ").trim();
  return {
    raw,
    freeText,
    tokens,
    filters: {
      courseIds: tokens.some((t) => t.key === "course") ? [...courseIds] : null,
      types: tokens.some((t) => t.key === "type") ? [...types] : null,
      is: tokens.some((t) => t.key === "is") ? [...is] : null,
      due: tokens.some((t) => t.key === "due") ? [...due] : null,
    },
    hasKnownInvalid: tokens.some((t) => t.recognized && !t.valid),
    highlight(text: string, query = freeText) {
      return splitLiteralMatches(text, query);
    },
  };
}

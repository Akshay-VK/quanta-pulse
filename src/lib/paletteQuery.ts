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
  freeRaw: string;
  terms: string[];
  tokens: PaletteQueryToken[];
  filters: {
    courseIds: number[] | null;
    types: string[] | null;
    is: Array<"read" | "unread" | "saved" | "unsaved"> | null;
    due: Array<"today" | "week" | "overdue" | "none"> | null;
  };
  errors: string[];
  hasKnownInvalid: boolean;
  highlight(text: string, query?: string): LiteralMatchPart[];
}

const RECOGNIZED: Record<string, true> = { course: true, type: true, is: true, due: true };
const IS_VALUES = new Set(["read", "unread", "saved", "unsaved"]);
const DUE_VALUES = new Set(["today", "week", "overdue", "none"]);

export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

/** Replace one filter dimension without discarding phrases or unrelated tokens. */
export function replacePaletteQueryFilter(
  query: PaletteQuery, key: PaletteTokenKey, next: string, dimension?: readonly string[],
): string {
  const keep = query.tokens.filter(token => token.key !== key || (dimension && !dimension.includes(token.value.toLowerCase())));
  return [query.freeRaw, ...keep.map(token => token.raw), next ? `${key}:${JSON.stringify(next)}` : ""].filter(Boolean).join(" ");
}

/** Resolve query values to the canonical spelling used by filter controls. */
export function paletteQueryFilterValues(
  query: PaletteQuery, key: PaletteTokenKey, resources: readonly Pick<Resource, "resourceType">[],
  dimension?: readonly string[],
): string[] {
  return query.tokens
    .filter(token => token.key === key && (!dimension || dimension.includes(token.value.toLowerCase())))
    .map(token => key === "is" || key === "due" ? token.value.toLowerCase()
      : key === "type" ? resources.find(resource => resource.resourceType.toLowerCase() === token.value.toLowerCase())?.resourceType ?? token.value
        : token.value);
}

export function parsePaletteQuery(
  raw: string,
  inventory: {
    courses: readonly (Pick<Course, "id" | "name" | "shortName"> & Partial<Pick<Course, "displayName">>)[];
    resources: readonly Pick<Resource, "id" | "courseId" | "courseName" | "resourceType" | "dueAt" | "availabilityStatus">[];
    displayNames?: ReadonlyMap<number, string>;
    aliases?: Readonly<Record<string, string>>;
  },
): PaletteQuery {
  const errors: string[] = [];
  const tokens: PaletteQueryToken[] = [];
  const free: string[] = [];
  const freeRaw: string[] = [];
  const courseIds = new Set<number>();
  const types = new Set<string>();
  const is = new Set<"read" | "unread" | "saved" | "unsaved">();
  const due = new Set<"today" | "week" | "overdue" | "none">();

  const typeInventory = new Map(inventory.resources.map((r) => [normalizeSearchText(r.resourceType), r.resourceType]));

  // Tokenize respecting quotes and backslash escapes. A colon outside quotes
  // starts a filter key.
  const parts: { text: string; raw: string; colon: number }[] = [];
  let text = "", start = 0, quoted = false, colon = -1;
  for (let i = 0; i <= raw.length; i++) {
    const ch = raw[i];
    if (quoted && ch === "\\" && (raw[i + 1] === '"' || raw[i + 1] === "\\")) {
      text += raw[++i];
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (i === raw.length || (!quoted && /\s/.test(ch ?? ""))) {
      if (text.length || i > start) parts.push({ text, raw: raw.slice(start, i), colon });
      text = "";
      colon = -1;
      start = i + 1;
    } else {
      if (!quoted && ch === ":" && colon < 0) colon = text.length;
      text += ch;
    }
  }
  if (quoted) errors.push("Unclosed quote");

  for (const entry of parts) {
    const part = entry.text;
    const idx = entry.colon;
    if (idx <= 0) {
      free.push(part);
      freeRaw.push(entry.raw);
      continue;
    }
    const key = normalizeSearchText(part.slice(0, idx));
    const value = part.slice(idx + 1);
    const rawToken = entry.raw;
    if (!RECOGNIZED[key]) {
      tokens.push({ key, value, raw: rawToken, recognized: false, valid: false, reason: "unknown-key" });
      continue;
    }
    if (key === "course") {
      const needle = normalizeSearchText(value);
      const matches = inventory.courses.filter((c) => {
        const names = [
          c.name,
          c.shortName ?? "",
          c.displayName ?? "",
          inventory.displayNames?.get(c.id) ?? "",
          inventory.aliases?.[String(c.id)] ?? "",
        ];
        return needle.length > 0 && names.some((n) => normalizeSearchText(n).includes(needle));
      });
      const valid = Boolean(needle) && matches.length > 0;
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      matches.forEach((c) => courseIds.add(c.id));
      continue;
    }
    if (key === "type") {
      const found = typeInventory.get(normalizeSearchText(value));
      const valid = Boolean(found);
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      if (found) types.add(found);
      continue;
    }
    if (key === "is") {
      const v = normalizeSearchText(value);
      const valid = IS_VALUES.has(v);
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      if (valid) is.add(v as "read" | "unread" | "saved" | "unsaved");
      continue;
    }
    if (key === "due") {
      const v = normalizeSearchText(value);
      const valid = DUE_VALUES.has(v);
      tokens.push({ key, value, raw: rawToken, recognized: true, valid, ...(valid ? {} : { reason: "invalid-value" as const }) });
      if (valid) due.add(v as "today" | "week" | "overdue" | "none");
      continue;
    }
  }

  for (const token of tokens) {
    if (!token.valid) {
      errors.push(token.recognized ? `Invalid ${token.key}: ${token.value}` : `Unsupported filter: ${token.key}`);
    }
  }
  if (is.has("read") && is.has("unread")) errors.push("Choose read or unread");
  if (is.has("saved") && is.has("unsaved")) errors.push("Choose saved or unsaved");

  const freeText = free.join(" ").trim();
  const terms = free.filter(Boolean);

  return {
    raw,
    freeText,
    freeRaw: freeRaw.join(" "),
    terms,
    tokens,
    filters: {
      courseIds: tokens.some((t) => t.key === "course") ? [...courseIds] : null,
      types: tokens.some((t) => t.key === "type") ? [...types] : null,
      is: tokens.some((t) => t.key === "is") ? [...is] : null,
      due: tokens.some((t) => t.key === "due") ? [...due] : null,
    },
    errors,
    hasKnownInvalid: errors.length > 0,
    highlight(text: string, query = freeText) {
      return splitLiteralMatches(text, query);
    },
  };
}

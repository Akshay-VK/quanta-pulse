import type { Resource } from "./types";
import { formatSectionPath } from "./sectionPath";

/** The shared destinations available for one material identity and its current capabilities. */
export type MaterialActionId = "preview" | "open-saved" | "download-open" | "open-quanta" | "open-recorded-file";
export interface MaterialAction { id: MaterialActionId; label: string }
export type MaterialLocalState = "saved" | "missing" | "unavailable" | "pending" | "unsupported";

/** Only stored HTTP(S) destinations may reach the system browser. */
export function materialSource(resource: Resource | null, recordedUrl?: string | null): string | null {
  for (const value of [resource?.sourcePageUrl, resource?.url, recordedUrl]) {
    try { if (value && ["https:", "http:"].includes(new URL(value).protocol)) return value; } catch { /* Invalid metadata has no destination. */ }
  }
  return null;
}

/** Derives truthful destinations; callers keep execution in the existing owners. */
export function materialActions(
  resource: Resource | null,
  state: { preview?: boolean; local?: MaterialLocalState; recordedUrl?: string | null; recordedFileUrl?: string | null },
  recorded = false,
): MaterialAction[] {
  const file = materialSource(null, state.recordedFileUrl);
  const source = materialSource(resource, state.recordedUrl) ?? file;
  if (!resource) return recorded && source ? [
    { id: "open-quanta", label: "Open in Quanta" },
    ...(file && file !== source ? [{ id: "open-recorded-file" as const, label: "Open recorded file in Quanta" }] : []),
  ] : [];
  const fileSource = materialSource({ ...resource, sourcePageUrl: null });
  const offOrigin = fileSource && new URL(fileSource).origin !== "https://quanta.bits-pilani.ac.in";
  if (resource.isExternal || offOrigin) return source ? [{ id: "open-quanta", label: "Open in Quanta" }] : [];
  const actions: MaterialAction[] = [];
  if (state.preview && fileSource) actions.push({ id: "preview", label: "Preview" });
  if (state.local === "saved") actions.push({ id: "open-saved", label: "Open saved copy" });
  else if (state.local !== "pending" && state.local !== "unsupported" && fileSource) actions.push({ id: "download-open", label: "Download and open" });
  if (source) actions.push({ id: "open-quanta", label: "Open in Quanta" });
  return actions;
}

/** Search title, course, type, section and source metadata with stable tie breaks. */
export function rankMaterialMatches<T extends Resource>(items: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const fields = (item: T) => [item.title, item.courseName ?? "", item.resourceType, formatSectionPath(item), item.url, item.sourcePageUrl ?? ""]
    .map((value) => value.toLocaleLowerCase());
  return items.map((item, index) => {
    const values = fields(item);
    const rank = values.includes(needle) ? 0 : values.some((value) => value.startsWith(needle)) ? 1 : values.some((value) => value.includes(needle)) ? 2 : 3;
    return { item, index, rank };
  }).filter(({ rank }) => rank < 3).sort((a, b) => a.rank - b.rank || a.item.title.localeCompare(b.item.title) || a.item.id - b.item.id || a.index - b.index).map(({ item }) => item);
}

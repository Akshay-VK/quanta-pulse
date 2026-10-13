import type { Resource } from "./types";

/** Prefer the crawled hierarchy; old rows fall back to their known section. */
export function resourceSectionPath(resource: Pick<Resource, "section" | "sectionPath">): string[] {
  const path = resource.sectionPath?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (path.length) return path;
  return resource.section?.trim() ? [resource.section.trim()] : ["Location unknown"];
}

export function formatSectionPath(resource: Pick<Resource, "section" | "sectionPath">): string {
  return resourceSectionPath(resource).join(" → ");
}

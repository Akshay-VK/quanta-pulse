/** Legacy URL-shape helpers retained for compatibility. Production material
 * destinations are defined by materialActions.ts; row selection opens details.
 */

/** The two URLs a resource/event row can carry. */
export interface OpenTarget {
  /** Original listing page (course/section/folder) or null when unknown. */
  sourcePageUrl: string | null;
  /** Direct file / download URL, or null when the row has no file link. */
  fileUrl: string | null;
}

/** Normalise a Resource row's URLs into an `OpenTarget`. */
export function resourceLinks(r: { url: string; sourcePageUrl?: string | null }): OpenTarget {
  return { sourcePageUrl: r.sourcePageUrl ?? null, fileUrl: r.url };
}

/** Normalise a ChangeEvent row's URLs into an `OpenTarget`. */
export function eventLinks(e: {
  resourceUrl: string | null;
  sourcePageUrl?: string | null;
}): OpenTarget {
  return { sourcePageUrl: e.sourcePageUrl ?? null, fileUrl: e.resourceUrl ?? null };
}

/**
 * The URL a plain click should open: the listing page when known, otherwise
 * the direct file URL. Returns null only when neither URL exists. Never
 * invents a URL.
 */
export function primaryUrl(links: OpenTarget): string | null {
  return links.sourcePageUrl ?? links.fileUrl;
}
/**
 * Central resource navigation.
 *
 * Every "open this resource" action across the app resolves its URL through
 * this module so behaviour stays consistent:
 *
 * - A primary click/button opens `sourcePageUrl` — the page where the
 *   resource's link is actually listed (course, section or folder page).
 * - An explicit "Open File" action always opens the direct file URL.
 * - When no listing page is known a plain click falls back to the direct file
 *   URL, but the visible action is still labelled "Open File" so opening a
 *   file is never a silent or ambiguous action.
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
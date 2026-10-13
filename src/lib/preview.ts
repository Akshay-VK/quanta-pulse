// Client-side mirror of the backend's preview decision.
//
// The Rust `preview_resource` command is the authority on what is actually
// fetched and rendered; this module only decides whether to offer a "Preview"
// action, using the same metadata rules (URL extension first, then the stored
// resource type). It never claims a resource is previewable when the backend
// would report it unsupported — an unknown extension/type yields `null`.

import type { PreviewMode } from "./types";

/** What the in-app viewer can render: a binary mode or extracted text. */
export type PreviewCapability = PreviewMode | "text";

const QUANTA_HOST = "quanta.bits-pilani.ac.in";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "ogg", "oga", "flac", "aac"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v", "ogv", "mkv"]);
const TEXT_EXTS = new Set(["txt", "md", "csv", "json", "xml", "html", "htm"]);

const TEXT_TYPES = new Set([
  "announcement",
  "page",
  "book",
  "label",
  "assignment",
  "quiz",
  "external link",
  "external tool",
]);

/**
 * The lower-case file extension of a URL's last path segment, when it looks
 * like a normal extension (letters/digits, at most five characters).
 */
export function extensionOf(url: string): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  let path: string;
  try {
    path = new URL(trimmed, "https://quanta.bits-pilani.ac.in").pathname;
  } catch {
    return null;
  }
  const name = path.split("/").filter(Boolean).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null;
}

function modeForExtension(ext: string): PreviewMode | null {
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}

/** The host a URL points at, resolving relative links against Quanta. */
function hostOf(url: string): string | null {
  try {
    return new URL(url, `https://${QUANTA_HOST}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * How this resource can be previewed in-app, or `null` when it cannot. Mirrors
 * the backend decision closely enough to label the action truthfully. Anything
 * hosted outside Quanta cannot be fetched with the session cookie, so it is
 * never offered as an in-app preview.
 */
export function previewMode(type: string, url: string): PreviewCapability | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed && hostOf(trimmed) !== QUANTA_HOST) return null;
  const ext = extensionOf(trimmed);
  if (ext) {
    const byExt = modeForExtension(ext);
    if (byExt) return byExt;
    if (TEXT_EXTS.has(ext)) return "text";
  }
  if (TEXT_TYPES.has((type ?? "").trim().toLowerCase())) return "text";
  return null;
}

/** Whether to show the "Preview" action for a resource. */
export function canPreview(type: string, url: string): boolean {
  return previewMode(type, url) !== null;
}

/** Short human label for a preview capability, for buttons and titles. */
export const PREVIEW_LABELS: Record<PreviewCapability, string> = {
  pdf: "PDF",
  image: "image",
  audio: "audio",
  video: "video",
  text: "text",
};

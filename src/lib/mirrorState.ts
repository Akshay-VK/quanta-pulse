// Presentation of the mirror's per-resource states, shared by rows, the peek
// panel, Settings > Files and the sidebar.

import type { LocalFileStatus } from "./types";

/** queued | downloading | ok | failed | skipped | kept */
export type MirrorStatus =
  | "queued"
  | "downloading"
  | "ok"
  | "failed"
  | "skipped"
  | "kept";

export function isMirrorStatus(value: string): value is MirrorStatus {
  return (
    value === "queued" ||
    value === "downloading" ||
    value === "ok" ||
    value === "failed" ||
    value === "skipped" ||
    value === "kept"
  );
}

/** Short label, tooltip and aria text for one mirror state. */
export const MIRROR_STATUS: Record<
  MirrorStatus,
  { label: string; tip: string; tone: "ok" | "busy" | "warn" | "bad" | "muted" }
> = {
  ok: {
    label: "Saved",
    tip: "Saved on this computer",
    tone: "ok",
  },
  downloading: {
    label: "Downloading",
    tip: "Downloading",
    tone: "busy",
  },
  queued: {
    label: "Waiting",
    tip: "Waiting in the download queue",
    tone: "busy",
  },
  failed: {
    label: "Failed",
    tip: "Download failed",
    tone: "bad",
  },
  skipped: {
    label: "Skipped",
    tip: "Skipped: over the size limit",
    tone: "warn",
  },
  kept: {
    label: "Kept",
    tip: "Unavailable on Quanta, saved locally",
    tone: "muted",
  },
};

/** Tooltip text for a row's status icon, including the reason when there is one. */
export function mirrorTip(file: LocalFileStatus | null | undefined): string | null {
  if (!file) return null;
  const meta = MIRROR_STATUS[file.status as MirrorStatus];
  if (!meta) return null;
  if (file.status === "failed" && file.error) return `${meta.tip}: ${file.error}`;
  return meta.tip;
}

/** Minimal shape for checking if a local copy is available. */
interface HasStatus {
  status: string;
}

/** Whether a local copy is ready to open right now. */
export function isLocal(file: HasStatus | null | undefined): boolean {
  return Boolean(file && (file.status === "ok" || file.status === "kept"));
}

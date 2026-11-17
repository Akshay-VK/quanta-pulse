import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Kbd } from "./ui/Kbd";
import { Menu, type MenuItemSpec } from "./ui/Menu";
import PropertyList from "./PropertyList";
import { formatBytes } from "../lib/format";
import { MIRROR_STATUS, isLocal } from "../lib/mirrorState";
import type { DetailProperty } from "../lib/details";
import type { StatusKind } from "./ui/StatusTag";
import type { MirrorDownloadProgress } from "../lib/types";

/** Mirror state of the resource in the panel, for the 'Local copy' group. */
export interface PeekLocal {
  status: string;
  error: string | null;
  sizeBytes: number | null;
  path: string | null;
}

function localStatusLabel(local: PeekLocal): string {
  return MIRROR_STATUS[local.status as keyof typeof MIRROR_STATUS]?.label ?? local.status;
}

export interface PeekProgress {
  percent?: number | null;
  bytesDone?: number | null;
  bytesTotal?: number | null;
  size?: string | null;
}

export interface PeekBanner {
  kind?: "info" | "warning" | "danger" | "neutral";
  text: string;
}

export interface PeekTechnical {
  fileName?: string | null;
  fileType?: string | null;
  size?: string | null;
  sha256?: string | null;
  quantaUrl?: string | null;
  savedPath?: string | null;
}

export interface PeekDetails {
  statusTag?: { kind: StatusKind; label: string } | null;
  title: string;
  /** Optional type badge shown above the title (e.g. "PDF"). */
  typeLabel?: string | null;
  properties: DetailProperty[];
  note?: string | null;
  banner?: PeekBanner | null;
  /** Download progress; accepts a mirror progress object too. */
  progress?: PeekProgress | MirrorDownloadProgress | null;
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean } | null;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean } | null;
  /** Ghost cancel button shown during downloads. */
  cancelAction?: { label?: string; onClick: () => void } | null;
  onCancelDownload?: () => void;
  onCancel?: () => void;
  /** Body text for external link / announcement variants. */
  announcement?: string | null;
  announcementText?: string | null;
  body?: string | null;
  technical?: PeekTechnical | null;
  /** Controlled open state for the 'File information' disclosure. */
  technicalOpen?: boolean;
  fileInfoOpen?: boolean;
  onTechnicalOpenChange?: (open: boolean) => void;
  onFileInfoOpenChange?: (open: boolean) => void;
  /** The mirror state of this resource, when it can have a local copy. */
  local?: PeekLocal | null;
  onOpenLocal?: () => void;
  onRevealLocal?: () => void;
  onCopyLocalPath?: () => void;
  onDownloadNow?: () => void;
  onRedownload?: () => void;
  menu?: MenuItemSpec[];
}

function normalizeProgress(p: PeekDetails["progress"]): PeekProgress | null {
  if (!p) return null;
  const anyP = p as Record<string, unknown>;
  if ("bytesDone" in anyP || "bytesTotal" in anyP || "state" in anyP) {
    const mp = p as MirrorDownloadProgress;
    const total = mp.bytesTotal ?? null;
    const done = mp.bytesDone ?? 0;
    const percent = total && total > 0 ? Math.round((done / total) * 100) : null;
    return { percent, bytesDone: done, bytesTotal: total, size: null };
  }
  return p as PeekProgress;
}

/** The docked (or overlay) details panel for the selected row. */
export default function PeekPanel({
  open,
  details,
  onClose,
  selectionKey,
  onCopy,
  focusOnOpen = true,
}: {
  focusOnOpen?: boolean;
  selectionKey?: string;
  open: boolean;
  details: PeekDetails | null;
  onClose: () => void;
  onCopy?: (text: string) => void;
}) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);
  const previousKey = useRef(selectionKey);

  const initialOpen = details?.technicalOpen ?? details?.fileInfoOpen ?? (details?.technical != null);
  const [fileInfoOpen, setFileInfoOpen] = useState<boolean>(Boolean(initialOpen));

  useEffect(() => {
    if (focusOnOpen && open && details && (!wasOpen.current || previousKey.current !== selectionKey)) {
      titleRef.current?.focus();
    }
    previousKey.current = selectionKey;
    wasOpen.current = open && Boolean(details);
  }, [open, details, selectionKey, focusOnOpen]);

  useEffect(() => {
    const next = details?.technicalOpen ?? details?.fileInfoOpen;
    if (next !== undefined) setFileInfoOpen(Boolean(next));
  }, [details?.technicalOpen, details?.fileInfoOpen]);

  if (!open || !details) return null;

  const local = details.local ?? null;
  const saved = isLocal(local);
  const localPrimary = saved && !details.primaryAction
    ? { label: "Open saved copy", onClick: details.onOpenLocal ?? (() => {}) }
    : null;
  const localActionLabel = local
    ? local.status === "kept" || saved
      ? null
      : "Download now"
    : null;

  const progress = normalizeProgress(details.progress);
  const percent = progress?.percent ?? (progress?.bytesTotal && progress.bytesTotal > 0
    ? Math.round(((progress.bytesDone ?? 0) / progress.bytesTotal) * 100)
    : null);
  const progressSize = progress?.size
    ?? (progress?.bytesTotal ? `${formatBytes(progress.bytesDone ?? 0)} / ${formatBytes(progress.bytesTotal)}` : null);

  const banner = details.banner;
  const announcement = details.announcement ?? details.announcementText ?? details.body ?? null;

  const technical = details.technical ?? null;
  const technicalRows: DetailProperty[] = technical ? [
    ...(technical.fileName ? [{ label: "File name", value: technical.fileName }] : []),
    ...(technical.fileType ? [{ label: "Type", value: technical.fileType }] : []),
    ...(technical.size ? [{ label: "Size", value: technical.size }] : []),
    ...(technical.sha256 ? [{ label: "SHA-256", value: (technical.sha256.length > 12 ? technical.sha256.slice(0, 12) + "…" : technical.sha256), mono: true, copy: technical.sha256 }] : []),
    ...(technical.quantaUrl ? [{ label: "Quanta URL", value: technical.quantaUrl, copy: technical.quantaUrl }] : []),
    ...(technical.savedPath ? [{ label: "Saved path", value: technical.savedPath, mono: true, copy: technical.savedPath }] : []),
  ] : [];

  const cancelOnClick = details.cancelAction?.onClick ?? details.onCancelDownload ?? details.onCancel;
  const cancelLabel = details.cancelAction?.label ?? "Cancel download";

  const disabledAll = Boolean(progress);

  return (
    <aside className="peek open" aria-labelledby={titleId}>
      <div className="peek-inner peek-enter">
        <div className="peek-header">
          <span className="peek-header-label">Material</span>
          <span className="peek-header-spacer" />
          <Kbd keys="Esc" />
          <IconButton label="Close details" size={28} onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>

        {details.typeLabel && (
          <div className="peek-type">
            <span>{details.typeLabel}</span>
          </div>
        )}

        <h2 data-dialog-primary id={titleId} className="peek-title" tabIndex={-1} ref={titleRef}>
          {details.title}
        </h2>

        {banner && (
          <div className={`peek-banner peek-banner--${banner.kind ?? "info"}`} role="status">
            {banner.text}
          </div>
        )}

        <div className="peek-actions-row">
          {details.primaryAction && (
            <Button variant="primary" onClick={details.primaryAction.onClick} disabled={details.primaryAction.disabled || disabledAll}>
              {details.primaryAction.label}
            </Button>
          )}
          {details.secondaryAction && (
            <Button variant="secondary" onClick={details.secondaryAction.onClick} disabled={details.secondaryAction.disabled || disabledAll}>
              {details.secondaryAction.label}
            </Button>
          )}
          {cancelOnClick && (
            <Button variant="ghost" onClick={cancelOnClick}>
              {cancelLabel}
            </Button>
          )}
          {details.menu && details.menu.length > 0 && (
            <div className="peek-extra">
              <Menu
                label="More actions"
                items={details.menu}
                trigger={
                  <IconButton label="More actions" size={28} tooltip={false}>
                    <MoreHorizontal aria-hidden="true" />
                  </IconButton>
                }
              />
            </div>
          )}
        </div>

        <div className="peek-divider" />

        {progress && (
          <div className="peek-progress-row">
            <span className="peek-progress-label">Status</span>
            <span className="peek-progress-bar">
              <i style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
            </span>
            {percent != null && <span className="peek-progress-percent">{percent}%</span>}
            {progressSize && <span className="peek-progress-size">{progressSize}</span>}
          </div>
        )}

        <PropertyList className="peek-properties" properties={details.properties} onCopy={onCopy} />

        {announcement && (
          <>
            <div className="peek-divider" />
            <div className="peek-announcement">{announcement}</div>
          </>
        )}

        {details.note && <p className="peek-note">{details.note}</p>}

        {(technicalRows.length > 0 || details.local) && (
          <details
            className="peek-technical"
            open={fileInfoOpen}
            onToggle={(e) => {
              const o = (e.currentTarget as HTMLDetailsElement).open;
              setFileInfoOpen(o);
              details.onTechnicalOpenChange?.(o);
              details.onFileInfoOpenChange?.(o);
            }}
          >
            <summary>File information</summary>
            {technicalRows.length > 0 && (
              <PropertyList className="peek-properties" properties={technicalRows} onCopy={onCopy} />
            )}
            {details.local && (
              <PropertyList
                className="peek-properties"
                onCopy={onCopy}
                properties={[
                  ...(details.local.sizeBytes != null ? [{ label: "Size", value: formatBytes(details.local.sizeBytes) }] : []),
                  ...(details.local.path ? [{ label: "Path", value: details.local.path, mono: true, copy: details.local.path }] : []),
                  ...(details.local.error ? [{ label: "Why", value: details.local.error }] : []),
                ]}
              />
            )}
          </details>
        )}

        {details.local && (
          <>
            <h3 className="peek-group-title">Local copy</h3>
            <PropertyList className="peek-properties" properties={[{ label: "Status", value: localStatusLabel(details.local) }]} />
            <div className="peek-local-actions">
              {localPrimary && (
                <Button variant="secondary" size="sm" onClick={localPrimary.onClick}>
                  {localPrimary.label}
                </Button>
              )}
              {details.onRevealLocal && (
                <Button variant="secondary" size="sm" onClick={details.onRevealLocal}>
                  Show in folder
                </Button>
              )}
              {details.onCopyLocalPath && details.local.path && (
                <Button variant="secondary" size="sm" onClick={details.onCopyLocalPath}>
                  Copy path
                </Button>
              )}
              {(details.onDownloadNow || details.onRedownload) &&
                localActionLabel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={details.onRedownload ?? details.onDownloadNow}
                  >
                    {localActionLabel}
                  </Button>
                )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

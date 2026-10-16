import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Menu, type MenuItemSpec } from "./ui/Menu";
import { StatusTag, type StatusKind } from "./ui/StatusTag";
import PropertyList from "./PropertyList";
import { formatBytes } from "../lib/format";
import { MIRROR_STATUS, isLocal } from "../lib/mirrorState";
import type { DetailProperty } from "../lib/details";

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

export interface PeekDetails {
  statusTag?: { kind: StatusKind; label: string } | null;
  title: string;
  properties: DetailProperty[];
  note?: string | null;
  primaryAction?: { label: string; onClick: () => void } | null;
  secondaryAction?: { label: string; onClick: () => void } | null;
  /** The mirror state of this resource, when it can have a local copy. */
  local?: PeekLocal | null;
  onOpenLocal?: () => void;
  onRevealLocal?: () => void;
  onCopyLocalPath?: () => void;
  onDownloadNow?: () => void;
  onRedownload?: () => void;
  menu?: MenuItemSpec[];
}

/** The docked (or overlay) details panel for the selected row. */
export default function PeekPanel({
  open,
  details,
  onClose,
}: {
  open: boolean;
  details: PeekDetails | null;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && details && !wasOpen.current) {
      titleRef.current?.focus();
    }
    wasOpen.current = open && Boolean(details);
  }, [open, details]);

  if (!open || !details) return null;

  const local = details.local ?? null;
  const saved = isLocal(local);
  const localPrimary = saved
    ? { label: "Open local copy", onClick: details.onOpenLocal ?? (() => {}) }
    : null;
  const localActionLabel = local
    ? local.status === "kept" || saved
      ? null
      : "Download now"
    : null;

  return (
    <aside className="peek open" aria-label="Details">
      <div className="peek-inner peek-enter">
        <div className="peek-header">
          <span>
            {details.statusTag && (
              <StatusTag kind={details.statusTag.kind} label={details.statusTag.label} />
            )}
          </span>
          <IconButton label="Close details" size={28} onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>

        <h2 className="peek-title" tabIndex={-1} ref={titleRef}>
          {details.title}
        </h2>

        <PropertyList className="peek-properties" properties={details.properties} />

        {details.local && (
          <>
            <h3 className="peek-group-title">Local copy</h3>
            <PropertyList
              className="peek-properties"
              properties={[
                { label: "Status", value: localStatusLabel(details.local) },
                ...(details.local.sizeBytes != null
                  ? [{ label: "Size", value: formatBytes(details.local.sizeBytes) }]
                  : []),
                ...(details.local.path
                  ? [{ label: "Path", value: details.local.path, mono: true, copy: details.local.path }]
                  : []),
                ...(details.local.error ? [{ label: "Why", value: details.local.error }] : []),
              ]}
            />
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

        {details.note && <p className="peek-note">{details.note}</p>}

        <div className="peek-actions">
          {details.primaryAction && (
            <Button variant="primary" onClick={details.primaryAction.onClick}>
              {details.primaryAction.label}
            </Button>
          )}
          {details.secondaryAction && (
            <Button variant="secondary" onClick={details.secondaryAction.onClick}>
              {details.secondaryAction.label}
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
      </div>
    </aside>
  );
}
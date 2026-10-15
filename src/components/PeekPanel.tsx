import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Menu, type MenuItemSpec } from "./ui/Menu";
import { StatusTag, type StatusKind } from "./ui/StatusTag";
import PropertyList from "./PropertyList";
import type { DetailProperty } from "../lib/details";

export interface PeekDetails {
  statusTag?: { kind: StatusKind; label: string } | null;
  title: string;
  properties: DetailProperty[];
  note?: string | null;
  primaryAction?: { label: string; onClick: () => void } | null;
  secondaryAction?: { label: string; onClick: () => void } | null;
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
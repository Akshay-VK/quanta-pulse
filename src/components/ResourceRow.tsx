import { ExternalLink, Eye, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { isLocal, mirrorTip } from "../lib/mirrorState";
import type { LocalFileStatus } from "../lib/types";
import { CoursePill } from "./ui/CoursePill";
import { FileTypeIcon } from "./ui/FileTypeIcon";
import { IconButton } from "./ui/IconButton";
import { MirrorStatusIcon } from "./ui/MirrorStatusIcon";
import { Menu, type MenuItemSpec } from "./ui/Menu";
import { StatusTag, type StatusKind } from "./ui/StatusTag";
import { UnreadDot } from "./ui/UnreadDot";

export type RowDensity = "comfortable" | "compact";

/** Below this width the row flips to its two-line compact layout. Container
 *  queries are unavailable on our minimum webview, so it is measured instead. */
const COMPACT_MAX_WIDTH = 560;

/**
 * Watches the row's own box and reports whether it is narrower than the compact
 * breakpoint. Measuring the row means every list gets the behaviour without each
 * view having to wire up a container ref, and the row's width is the container's
 * width, so one measurement serves the whole row.
 */
function useAutoCompact() {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // jsdom has no ResizeObserver; the explicit `density` prop still applies.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      setNarrow(width < COMPACT_MAX_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, narrow };
}

/**
 * One row in the Today feed, History changes and Calendar day lists. Selecting
 * (for the peek panel) and opening are deliberately separate controls.
 *
 * The row is a grid so a long title can never push the course pill, status tag
 * or time out of their own columns. `compact` stacks it onto two lines for
 * narrow containers (the Calendar day panel); it also engages on its own once
 * the row is measured below `COMPACT_MAX_WIDTH`.
 */
export default function ResourceRow({
  title,
  type,
  courseId,
  courseCode,
  courseName,
  unread,
  selected,
  unavailable,
  status,
  timeLabel,
  openLabel,
  showOpen = true,
  previewAvailable = false,
  density = "comfortable",
  local,
  onOpenLocal,
  onSelect,
  onOpen,
  onPreview,
  onCourse,
  menu,
}: {
  title: string;
  type: string | null;
  courseId: number | null;
  courseCode?: string | null;
  courseName?: string | null;
  unread: boolean;
  selected: boolean;
  unavailable: boolean;
  status?: { kind: StatusKind; label: string } | null;
  timeLabel: string;
  openLabel: string;
  showOpen?: boolean;
  previewAvailable?: boolean;
  density?: RowDensity;
  /**
   * Mirror state of this resource: a status row, null when there is no local
   * copy yet, or undefined when the resource cannot have one (an external
   * link). Drives the status icon and the open/download label.
   */
  local?: LocalFileStatus | null;
  /** Opens the local copy through the Shell ('Open local copy'). */
  onOpenLocal?: () => void;
  onSelect: () => void;
  onOpen?: () => void;
  onPreview?: () => void;
  /** Opens the course this row belongs to; the course pill becomes a button. */
  onCourse?: () => void;
  menu: MenuItemSpec[];
}) {
  const { ref, narrow } = useAutoCompact();
  const compact = density === "compact" || narrow;
  const saved = isLocal(local);
  // With a local copy the primary action opens it; without one it downloads
  // first and then opens.
  const resolvedOpenLabel = local === undefined ? openLabel : saved ? openLabel : "Download and open";

  return (
    <div
      ref={ref}
      className={cx(
        "resource-row",
        compact && "row-compact",
        selected && "selected",
        unread && "row-unread",
        unavailable && "row-unavailable",
      )}
    >
      <button
        type="button"
        className="row-select"
        aria-label={`Show details for ${title}`}
        onClick={onSelect}
      >
        <UnreadDot unread={unread} />
        <FileTypeIcon type={type} />
        <span className="row-title-wrap">
          <span className="row-title" title={title}>
            {title}
          </span>
        </span>
      </button>

      {/* Outside .row-select: the course pill is its own control, and a button
          inside a button is invalid and fails the a11y check. */}
      {(courseCode || status) && (
        <span className="row-meta">
          {courseCode && (
            <CoursePill
              courseId={courseId}
              code={courseCode}
              name={courseName}
              onOpen={onCourse}
            />
          )}
          {status && <StatusTag kind={status.kind} label={status.label} />}
        </span>
      )}

      {local && (
        <span className="row-mirror" title={mirrorTip(local) ?? undefined}>
          <MirrorStatusIcon file={local} />
        </span>
      )}

      <span className="row-time">{timeLabel}</span>

      <span className="row-actions">
        {previewAvailable && onPreview && (
          <IconButton label="Preview" size={28} onClick={onPreview}>
            <Eye aria-hidden="true" />
          </IconButton>
        )}
        {showOpen && (saved ? onOpenLocal : onOpen) && (
          <IconButton
            label={saved ? "Open local copy" : resolvedOpenLabel}
            size={28}
            onClick={() => (saved ? onOpenLocal?.() : onOpen?.())}
          >
            <ExternalLink aria-hidden="true" />
          </IconButton>
        )}
        <Menu
          label="More actions"
          items={menu}
          trigger={
            <IconButton label="More actions" size={28} tooltip={false}>
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          }
        />
      </span>
    </div>
  );
}

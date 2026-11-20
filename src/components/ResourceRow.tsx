import { useMaterialActions } from "../hooks/useMaterialActions";
import { MaterialButtons } from "./MaterialButtons";
import { ExternalLink, Eye, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { isLocal, mirrorTip } from "../lib/mirrorState";
import type { ChangeEvent, Resource, LocalFileStatus } from "../lib/types";
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
const COMPACT_MAX_WIDTH = 800;

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
  resource,
  recorded,
  title,
  type,
  courseId,
  courseCode,
  courseName,
  sectionLabel,
  workspaceVariant,
  leadingIcon,
  timeSuffix,
  unread,
  selected,
  unavailable,
  status,
  timeLabel,
  openLabel = "Open in Quanta",
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
  keyboardFocused = false,
  multiSelected = false,
  showFocusHint = false,
  tabStop,
  selectRef,
  onKeyboardFocus,
}: {
  /** Pass identity to use the App-owned policy; null plus recorded is an orphan. */
  resource?: Resource | null;
  recorded?: ChangeEvent;
  title: string;
  type: string | null;
  courseId: number | null;
  courseCode?: string | null;
  courseName?: string | null;
  /** Optional mono section label, shown between the course and time slots. */
  sectionLabel?: string | null;
  workspaceVariant?: "inbox" | "agenda" | "history";
  leadingIcon?: ReactNode;
  timeSuffix?: ReactNode;
  unread: boolean;
  selected: boolean;
  unavailable: boolean;
  status?: { kind: StatusKind; label: string } | null;
  timeLabel: string;
  openLabel?: string;
  /** Legacy standalone control only. Identity-based rows derive all destinations from policy. */
  showOpen?: boolean;
  previewAvailable?: boolean;
  density?: RowDensity;
  /**
   * Mirror state of this resource: a status row, null when there is no local
   * copy yet, or undefined when the resource cannot have one (an external
   * link). Drives the status icon and the open/download label.
   */
  local?: LocalFileStatus | null;
  /** Legacy standalone saved-file callback. */
  onOpenLocal?: () => void;
  onSelect: (origin: HTMLButtonElement) => void;
  onOpen?: () => void;
  onPreview?: () => void;
  /** Opens the course this row belongs to; the course pill becomes a button. */
  onCourse?: () => void;
  menu: MenuItemSpec[];
  /** Surface-owned roving focus marker; does not imply inspection. */
  keyboardFocused?: boolean;
  /** Surface-owned bulk selection marker; does not imply inspection. */
  multiSelected?: boolean;
  /** Show the surface keyboard hint in the time slot. */
  showFocusHint?: boolean;
  /** Keep this row in the tab order without implying that it is focused. */
  tabStop?: boolean;
  selectRef?: (node: HTMLButtonElement | null) => void;
  onKeyboardFocus?: () => void;
}) {
  const destinations = useMaterialActions();
  const actions = destinations && (resource !== undefined || recorded) ? destinations(resource ?? null, recorded) : null;
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
        actions !== null && "row-material",
        workspaceVariant && `row-workspace row-workspace-${workspaceVariant}`,
        compact && "row-compact",
        selected && "selected",
        keyboardFocused && "keyboard-focused",
        multiSelected && "multi-selected",
        unread && "row-unread",
        unavailable && "row-unavailable",
      )}
    >
      <button
        ref={selectRef}
        onFocus={onKeyboardFocus}
        type="button"
        className="row-select"
        tabIndex={tabStop === undefined ? undefined : tabStop ? 0 : -1}
        aria-label={`Show details for ${title}`}
        onClick={(event) => onSelect(event.currentTarget)}
      >
        <UnreadDot unread={unread} />
        {leadingIcon ?? <FileTypeIcon type={type} />}
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
          {status && <StatusTag kind={status.kind} label={status.label} />}
          {courseCode && (
            <CoursePill
              courseId={courseId}
              code={courseCode}
              name={courseName}
              onOpen={onCourse}
            />
          )}
        </span>
      )}

      {sectionLabel && <span className="row-section">{sectionLabel}</span>}

      {local && (
        <span className="row-mirror" title={mirrorTip(local) ?? undefined}>
          <MirrorStatusIcon file={local} />
        </span>
      )}

      <span className={cx("row-time", showFocusHint && "row-time-focused")} title={timeLabel}>{timeLabel}{timeSuffix}{showFocusHint && <kbd className="row-focus-hint">E</kbd>}</span>

      <span className="row-actions">
        {actions ? <MaterialButtons actions={actions} menu={menu} /> : <>
        {previewAvailable && onPreview && (
          <IconButton label="Preview" size={28} onClick={onPreview}>
            <Eye aria-hidden="true" />
          </IconButton>
        )}
        {showOpen && (saved ? onOpenLocal : onOpen) && (
          <IconButton
            label={saved ? "Open saved copy" : resolvedOpenLabel}
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
        </>}
      </span>
    </div>
  );
}

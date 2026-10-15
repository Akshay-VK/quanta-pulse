import { ExternalLink, Eye, MoreHorizontal } from "lucide-react";
import { cx } from "../lib/cx";
import { CoursePill } from "./ui/CoursePill";
import { FileTypeIcon } from "./ui/FileTypeIcon";
import { IconButton } from "./ui/IconButton";
import { Menu, type MenuItemSpec } from "./ui/Menu";
import { StatusTag, type StatusKind } from "./ui/StatusTag";
import { UnreadDot } from "./ui/UnreadDot";

/**
 * One row in the Today feed, History changes and Calendar day lists. Selecting
 * (for the peek panel) and opening are deliberately separate controls.
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
  onSelect: () => void;
  onOpen?: () => void;
  onPreview?: () => void;
  /** Opens the course this row belongs to; the course pill becomes a button. */
  onCourse?: () => void;
  menu: MenuItemSpec[];
}) {
  return (
    <div
      className={cx(
        "resource-row",
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

      <span className="row-time">{timeLabel}</span>

      <span className="row-actions">
        {previewAvailable && onPreview && (
          <IconButton label="Preview" size={28} onClick={onPreview}>
            <Eye aria-hidden="true" />
          </IconButton>
        )}
        {showOpen && onOpen && (
          <IconButton label={openLabel} size={28} onClick={onOpen}>
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
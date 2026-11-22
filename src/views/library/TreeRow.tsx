import { useMaterialActions } from "../../hooks/useMaterialActions";
import { MaterialButtons } from "../../components/MaterialButtons";
import { type ReactNode } from "react";
import { Check, ChevronRight, ExternalLink, Folder } from "lucide-react";
import { cx } from "../../lib/cx";
import { formatCompact, formatListDate } from "../../lib/format";
import { resourceSectionPath } from "../../lib/sectionPath";
import type { CourseTreeNode } from "../../lib/courseTree";
import type { Resource } from "../../lib/types";
import { FileTypeIcon } from "../../components/ui/FileTypeIcon";
import { StatusTag } from "../../components/ui/StatusTag";
import { UnreadDot } from "../../components/ui/UnreadDot";
import { CoursePill } from "../../components/ui/CoursePill";

/** One flattened row of the course tree: a folder or a file. */
export type FlatRow =
  | { kind: "folder"; id: string; node: CourseTreeNode; depth: number; expanded: boolean }
  | { kind: "file"; id: string; resource: Resource; depth: number; searching: boolean };

const INDENT_PX = 16;
const MAX_INDENT_LEVEL = 6;

/** 16px per level, clamped visually at 6 levels. */
export function indentFor(depth: number): number {
  return Math.min(depth, MAX_INDENT_LEVEL) * INDENT_PX;
}

/** Wrap every case-insensitive match of `query` in the search highlight. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (from < text.length) {
    const at = lower.indexOf(needle, from);
    if (at === -1) {
      parts.push(text.slice(from));
      break;
    }
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark className="match-hl" key={key++}>
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  return <>{parts}</>;
}

interface TreeRowProps {
  row: FlatRow;
  index: number;
  focused: boolean;
  query: string;
  onToggle: (id: string) => void;
  onChooseFolder?: (node: CourseTreeNode) => void;
  folderSelected?: boolean;
  onOpen: (url: string) => void;
  onPreview: (resource: Resource) => void;
  onActivate: (index: number) => void;
  selected?: boolean;
  multiSelected?: boolean;
  saved?: boolean;
  unread?: boolean;
  compactCourse?: { id: number; code: string; name: string };
  onSelect: (resource: Resource, origin: HTMLElement) => void;
}

/**
 * A single ARIA treeitem. Both the folder chevron and its name toggle the
 * folder, so the row reads as one target; the Quanta page link stays a
 * separate button to avoid nesting interactives.
 */
export default function TreeRow({
  row,
  index,
  focused,
  query,
  onToggle,
  onChooseFolder,
  folderSelected,
  onOpen,
  onPreview,
  onActivate,
  selected = false,
  multiSelected = false,
  saved = false,
  unread = false,
  compactCourse,
  onSelect,
}: TreeRowProps) {
  const destinations = useMaterialActions({ onOpen, onPreview });
  const shared = {
    className: cx("tree-row", "tree-folder-row", focused && "keyboard-focused", folderSelected && "is-current"),
    role: "treeitem",
    "aria-level": row.depth + 1,
    "aria-selected": row.kind === "file" ? multiSelected : undefined,
    "data-row-key": row.id,
    tabIndex: focused ? 0 : -1,
    "data-index": index,
    onFocus: (event: React.FocusEvent<HTMLElement>) => { if (event.target === event.currentTarget) onActivate(index); },
  } as const;

  if (row.kind === "folder") {
    const { node, expanded } = row;
    const label = `${expanded ? "Collapse" : "Expand"} ${node.name}`;
    return (
      <div {...shared} aria-expanded={expanded} aria-current={folderSelected ? "true" : undefined} style={{ paddingInlineStart: 24 + indentFor(row.depth) }}>
        <button
          type="button"
          className="tree-toggle"
          aria-label={label}
          onClick={() => onToggle(node.id)}
        >
          <ChevronRight className="chevron" aria-hidden="true" />
        </button>
        <Folder className="tree-folder-icon" aria-hidden="true" />
        <button
          type="button"
          className="tree-name tree-name-toggle"
          title={node.path.join(" / ")}
          onClick={() => onChooseFolder ? onChooseFolder(node) : onToggle(node.id)}
        >
          {node.name}
        </button>
        <span className="tree-count">{node.count}</span>
        {node.sourcePageUrl && (
          <button
            type="button"
            className="tree-external"
            aria-label={`Open Quanta page for ${node.name}`}
            onClick={() => onOpen(node.sourcePageUrl as string)}
          >
            <ExternalLink aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  const { resource, searching } = row;
  const sectionPath = resourceSectionPath(resource);
  const folder = sectionPath.join(" / ");
  const section = sectionPath.at(-1);
  const unavailable = resource.availabilityStatus === "unavailable";

  return (
    <div
      {...shared}
      className={cx("tree-row", "course-material-row", searching && "course-material-match", unread && "is-unread", focused && "keyboard-focused", selected && "selected", multiSelected && "multi-selected")}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onSelect(resource, event.currentTarget);
      }}
    >
      <span className="course-material-marker">{unread && <UnreadDot unread />}</span>
      <FileTypeIcon type={resource.resourceType} />
      <button type="button" className="tree-name" aria-label={`Show details for ${resource.title}`} onClick={(event) => onSelect(resource, event.currentTarget)} title={`${resource.title} — ${folder}`}>
        <span className="course-material-name"><Highlighted text={resource.title} query={searching ? query : ""} /></span>
        {searching && <span className="tree-match-path">{folder}</span>}
      </button>
      {compactCourse
        ? <CoursePill courseId={compactCourse.id} code={compactCourse.code} name={compactCourse.name} />
        : <span className="course-material-section mono" title={folder}>{section}</span>}
      <span className="course-material-detected mono" title={`First detected ${formatCompact(resource.firstSeenAt)}`}>
        {formatListDate(resource.firstSeenAt)}
      </span>
      <span className="course-material-saved">{saved && <Check aria-label="Saved" />}</span>
      <span className="course-material-actions">
        {unavailable && <StatusTag kind="unavailable" label="Unavailable" />}
        {resource.availabilityStatus === "restored" && <StatusTag kind="restored" label="Restored" />}
        <MaterialButtons actions={destinations?.(resource) ?? []} />
      </span>
    </div>
  );
}

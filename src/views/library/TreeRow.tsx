import { type ReactNode } from "react";
import { ChevronRight, ExternalLink, Eye, Folder } from "lucide-react";
import { cx } from "../../lib/cx";
import { describeUpload, formatBytes } from "../../lib/format";
import { fileTone } from "../../lib/filetype";
import { canPreview } from "../../lib/preview";
import { formatSectionPath } from "../../lib/sectionPath";
import type { CourseTreeNode } from "../../lib/courseTree";
import type { Resource } from "../../lib/types";
import { FileTypeIcon } from "../../components/ui/FileTypeIcon";
import { IconButton } from "../../components/ui/IconButton";
import { StatusTag } from "../../components/ui/StatusTag";

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
  onOpen: (url: string) => void;
  onPreview: (resource: Resource) => void;
  onActivate: (index: number) => void;
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
  onOpen,
  onPreview,
  onActivate,
}: TreeRowProps) {
  const shared = {
    className: cx("tree-row", focused && "focused"),
    role: "treeitem",
    "aria-level": row.depth + 1,
    "aria-selected": focused,
    tabIndex: focused ? 0 : -1,
    "data-index": index,
    style: { paddingLeft: indentFor(row.depth) },
    onFocus: () => onActivate(index),
  } as const;

  if (row.kind === "folder") {
    const { node, expanded } = row;
    const label = `${expanded ? "Collapse" : "Expand"} ${node.name}`;
    return (
      <div {...shared} aria-expanded={expanded}>
        <button
          type="button"
          className="tree-toggle"
          aria-label={label}
          onClick={() => onToggle(row.id)}
        >
          <ChevronRight className="chevron" aria-hidden="true" />
        </button>
        <Folder className="tree-folder-icon" aria-hidden="true" />
        <button
          type="button"
          className="tree-name tree-name-toggle"
          title={node.path.join(" / ")}
          onClick={() => onToggle(row.id)}
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
  const upload = describeUpload(resource);
  const size = resource.sizeBytes ? formatBytes(resource.sizeBytes) : "";
  const unavailable = resource.availabilityStatus !== "available";
  const previewable = canPreview(resource.resourceType, resource.url);
  const missingDate = upload.source === "unavailable";

  return (
    <div {...shared}>
      <span className="tree-toggle" aria-hidden="true" />
      <FileTypeIcon type={resource.resourceType} />
      <span className="tree-name" title={`${resource.title} — ${formatSectionPath(resource)}`}>
        <Highlighted text={resource.title} query={searching ? query : ""} />
        {searching && <span className="tree-match-path">{formatSectionPath(resource)}</span>}
      </span>
      <span className={cx("tree-col tree-col-type", "file-tone", fileTone(resource.resourceType))}>
        <span className="file-dot" aria-hidden="true" />
        {resource.resourceType}
      </span>
      <span className="tree-col tree-col-size">
        {size || <span className="tree-blank">—</span>}
      </span>
      {/* In a row the full phrase is too long, so the em dash carries the
          explanation in its tooltip; the detail view spells it out. */}
      <span
        className="tree-col tree-col-date"
        title={missingDate ? "Upload date unavailable" : undefined}
      >
        {missingDate ? "—" : upload.label}
      </span>
      {unavailable && <StatusTag kind="unavailable" label="Unavailable" />}
      {resource.availabilityStatus === "restored" && (
        <StatusTag kind="restored" label="Restored" />
      )}
      <span className="tree-col tree-col-actions">
        {previewable && (
          <IconButton
            label={`Preview ${resource.title}`}
            size={28}
            onClick={() => onPreview(resource)}
          >
            <Eye aria-hidden="true" />
          </IconButton>
        )}
        <IconButton
          label={`Open ${resource.title}`}
          size={28}
          onClick={() => onOpen(resource.url)}
        >
          <ExternalLink aria-hidden="true" />
        </IconButton>
      </span>
    </div>
  );
}
import type { Resource } from "../lib/types";
import type { DateGroup } from "../lib/filter";
import { statusLabel } from "../lib/filter";
import { resourceLinks, primaryUrl } from "../lib/open";
import { fileTone } from "../lib/filetype";
import { describeUpload, formatBytes, relativeLabel } from "../lib/format";
import { formatSectionPath } from "../lib/sectionPath";

interface Props {
  groups: DateGroup[];
  eventKinds: Map<number, Set<string>>;
  onOpen: (url: string) => void;
  emptyMessage?: string;
}

function StatusTag({ label }: { label: string }) {
  const cls = label.toLowerCase();
  return <span className={`label ${cls}`}>{label}</span>;
}

function Row({
  resource,
  eventKinds,
  onOpen,
}: {
  resource: Resource;
  eventKinds: Map<number, Set<string>>;
  onOpen: (url: string) => void;
}) {
  const upload = describeUpload(resource);
  const status = statusLabel(resource, eventKinds);
  const links = resourceLinks(resource);
  const primary = primaryUrl(links);
  const isNew = Boolean(
    eventKinds.get(resource.id)?.has("new") ||
      eventKinds.get(resource.id)?.has("announcement"),
  );

  return (
    <div
      className="row"
      onClick={() => {
        if (primary) onOpen(primary);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (primary) onOpen(primary);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${resource.title}`}
    >
      {isNew && <span className="unread-dot" />}
      <span className="row-title" title={resource.title}>
        {resource.title}
      </span>
      <span className="row-meta">
        {resource.courseName || "—"}
        <span className="sep">·</span>
        <span className="row-section">{formatSectionPath(resource)}</span>
        <span className="sep">·</span>
        <span className={`file-type ${fileTone(resource.resourceType)}`}>
          <span className="file-dot" aria-hidden="true" />
          {resource.resourceType}
        </span>
        {resource.sizeBytes ? (
          <>
            <span className="sep">·</span>
            {formatBytes(resource.sizeBytes)}
          </>
        ) : null}
      </span>
      <span className="row-time">
        {upload.source === "unavailable" ? (
          <span className="faint">Upload date unavailable</span>
        ) : (
          <>
            {upload.note ? `${upload.note} ` : "uploaded "}
            {upload.label}
          </>
        )}
        <small>{relativeLabel(upload.source === "unavailable" ? resource.firstSeenAt : uploadSource(resource))}</small>
      </span>
      {status && <StatusTag label={status} />}
      <button
        type="button"
        className="btn-link row-open"
        title={
          links.sourcePageUrl
            ? "Open the underlying file directly"
            : "Open the file directly (no listing page is known)"
        }
        onClick={(event) => {
          event.stopPropagation();
          onOpen(resource.url);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        Open File
      </button>
    </div>
  );
}

function uploadSource(resource: Resource): string | null {
  return (
    resource.uploadedAt ?? resource.publishedAt ?? resource.modifiedAt ?? resource.firstSeenAt
  );
}

export default function ResourceList({ groups, eventKinds, onOpen, emptyMessage }: Props) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) {
    return <div className="empty">{emptyMessage ?? "No resources match your filters."}</div>;
  }
  return (
    <div>
      {groups.map((group) => (
        <div key={group.key}>
          <div className="group-label">{group.label}</div>
          {group.items.map((r) => (
            <Row key={r.id} resource={r} eventKinds={eventKinds} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}

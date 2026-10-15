import { useMemo, useRef, useState } from "react";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { cx } from "../../lib/cx";
import { typeOptions } from "../../lib/courseLibrary";
import { dedupeCourseResources } from "../../lib/courseTree";
import { activityTimestamp } from "../../lib/filter";
import { fileTone } from "../../lib/filetype";
import { describeUpload, formatBytes, parseTimestamp } from "../../lib/format";
import { formatSectionPath } from "../../lib/sectionPath";
import { canPreview } from "../../lib/preview";
import { resourceDetails } from "../../lib/details";
import type { Course, Resource } from "../../lib/types";
import DataTable, { type DataColumn } from "../../components/DataTable";
import PeekPanel, { type PeekDetails } from "../../components/PeekPanel";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Select } from "../../components/ui/Select";
import { Menu, type MenuItemSpec } from "../../components/ui/Menu";
import { CoursePill } from "../../components/ui/CoursePill";
import { StatusTag, type StatusKind } from "../../components/ui/StatusTag";
import { EmptyState } from "../../components/ui/EmptyState";

interface AllFilesProps {
  resources: Resource[];
  courses: Course[];
  search: string;
  onOpen: (url: string) => void;
  onPreview: (resource: Resource) => void;
}

type SortId = "title" | "course" | "section" | "type" | "uploaded";

const DEFAULT_DIR: Record<SortId, "asc" | "desc"> = {
  title: "asc",
  course: "asc",
  section: "asc",
  type: "asc",
  uploaded: "desc",
};

function uploadedAt(resource: Resource): number | null {
  const at = activityTimestamp(resource);
  return at ? (parseTimestamp(at)?.getTime() ?? null) : null;
}

/** Availability as a muted label, or a StatusTag for the two notable states. */
function availabilityCell(resource: Resource) {
  if (resource.availabilityStatus === "unavailable") {
    return <StatusTag kind="unavailable" label="Unavailable" />;
  }
  if (resource.availabilityStatus === "restored") {
    return <StatusTag kind="restored" label="Restored" />;
  }
  return <span className="cell-title-sub">Available</span>;
}

function availabilityTag(resource: Resource): { kind: StatusKind; label: string } | null {
  if (resource.availabilityStatus === "unavailable") {
    return { kind: "unavailable", label: "Unavailable" };
  }
  if (resource.availabilityStatus === "restored") {
    return { kind: "restored", label: "Restored" };
  }
  return null;
}

function actionItems(
  resource: Resource,
  onOpen: (url: string) => void,
  onPreview: (resource: Resource) => void,
): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  if (canPreview(resource.resourceType, resource.url)) {
    items.push({
      id: "preview",
      label: "Preview",
      onSelect: () => onPreview(resource),
    });
  }
  items.push({
    id: "file",
    label: "Open file",
    icon: <ExternalLink aria-hidden="true" />,
    onSelect: () => onOpen(resource.url),
  });
  if (resource.sourcePageUrl) {
    items.push({
      id: "page",
      label: "Open Quanta page",
      onSelect: () => onOpen(resource.sourcePageUrl as string),
    });
  }
  items.push({
    id: "copy",
    label: "Copy link",
    onSelect: () => void navigator.clipboard?.writeText(resource.sourcePageUrl ?? resource.url),
  });
  return items;
}

/** Every discovered resource as one sortable, filterable table. */
export default function AllFiles({
  resources,
  courses,
  search,
  onOpen,
  onPreview,
}: AllFilesProps) {
  const [courseFilter, setCourseFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<{ id: SortId; dir: "asc" | "desc" }>({
    id: "uploaded",
    dir: "desc",
  });
  const [peek, setPeek] = useState<Resource | null>(null);
  const lastPeek = useRef<HTMLElement | null>(null);

  const unique = useMemo(() => dedupeCourseResources(resources), [resources]);
  const types = useMemo(() => typeOptions(unique), [unique]);
  const codeByCourse = useMemo(() => {
    const map = new Map<number, string>();
    for (const course of courses) map.set(course.id, course.shortName ?? course.name);
    return map;
  }, [courses]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const type = typeFilter === "all" ? "" : typeFilter.toLowerCase();
    return unique.filter((r) => {
      if (courseFilter !== "all" && r.courseId !== Number(courseFilter)) return false;
      if (type && r.resourceType.trim().toLowerCase() !== type) return false;
      if (needle) {
        const haystack =
          `${r.title} ${r.courseName ?? ""} ${r.resourceType} ${formatSectionPath(r)}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [unique, search, typeFilter, courseFilter]);

  const rows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const byTitle = (a: Resource, b: Resource) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    return [...filtered].sort((a, b) => {
      switch (sort.id) {
        case "title":
          return byTitle(a, b) * dir;
        case "course":
          return (a.courseName ?? "").localeCompare(b.courseName ?? "") * dir;
        case "section":
          return formatSectionPath(a).localeCompare(formatSectionPath(b)) * dir;
        case "type":
          return a.resourceType.localeCompare(b.resourceType) * dir;
        case "uploaded":
        default: {
          const ta = uploadedAt(a);
          const tb = uploadedAt(b);
          if (ta === null && tb === null) return byTitle(a, b);
          if (ta === null) return 1;
          if (tb === null) return -1;
          return ta !== tb ? (ta - tb) * dir : byTitle(a, b);
        }
      }
    });
  }, [filtered, sort]);

  const filtersActive = courseFilter !== "all" || typeFilter !== "all" || search.trim() !== "";

  const onSort = (id: string) => {
    const key = id as SortId;
    setSort((prev) =>
      prev.id === key ? { id: key, dir: prev.dir === "asc" ? "desc" : "asc" } : { id: key, dir: DEFAULT_DIR[key] },
    );
  };

  const clearFilters = () => {
    setCourseFilter("all");
    setTypeFilter("all");
  };

  const openResource = (resource: Resource) => {
    lastPeek.current = document.activeElement as HTMLElement | null;
    setPeek(resource);
  };

  const peekDetails: PeekDetails | null = useMemo(() => {
    if (!peek) return null;
    const previewable = canPreview(peek.resourceType, peek.url);
    return {
      title: peek.title,
      statusTag: availabilityTag(peek),
      properties: resourceDetails(peek),
      note:
        peek.availabilityStatus !== "available"
          ? "Missing for 2 scans in a row. It may come back."
          : null,
      primaryAction: { label: "Open file", onClick: () => onOpen(peek.url) },
      secondaryAction: previewable
        ? { label: "Preview", onClick: () => onPreview(peek) }
        : null,
      menu: [
        ...(peek.sourcePageUrl
          ? [
              {
                id: "page",
                label: "Open Quanta page",
                onSelect: () => onOpen(peek.sourcePageUrl as string),
              },
            ]
          : []),
        {
          id: "copy",
          label: "Copy link",
          onSelect: () =>
            void navigator.clipboard?.writeText(peek.sourcePageUrl ?? peek.url),
        },
      ],
    };
  }, [peek, onOpen, onPreview]);

  const columns: DataColumn<Resource>[] = [
    {
      id: "title",
      header: "Title",
      className: "title-cell",
      width: 280,
      sortable: true,
      title: (resource) => resource.title,
      cell: (resource) => {
        const size = resource.sizeBytes ? formatBytes(resource.sizeBytes) : "";
        return (
          <div className="cell-title">
            <span className="cell-title-main">{resource.title}</span>
            {size && <span className="cell-title-sub">{size}</span>}
          </div>
        );
      },
    },
    {
      id: "course",
      header: "Course",
      width: 120,
      sortable: true,
      title: (resource) => resource.courseName ?? undefined,
      cell: (resource) => (
        <span className="row-course-pill">
          <CoursePill
            courseId={resource.courseId}
            code={
              (resource.courseId != null && codeByCourse.get(resource.courseId)) ||
              resource.courseName ||
              "—"
            }
            name={resource.courseName}
          />
        </span>
      ),
    },
    {
      id: "section",
      header: "Section",
      className: "section-cell",
      width: 160,
      sortable: true,
      title: (resource) => formatSectionPath(resource),
      cell: (resource) => formatSectionPath(resource),
    },
    {
      id: "type",
      header: "Type",
      width: 112,
      sortable: true,
      cell: (resource) => (
        <span className={cx("file-tone", fileTone(resource.resourceType))}>
          <span className="file-dot" aria-hidden="true" />
          {resource.resourceType}
        </span>
      ),
    },
    {
      id: "uploaded",
      header: "Uploaded",
      width: 140,
      sortable: true,
      title: (resource) => describeUpload(resource).label,
      cell: (resource) => {
        const upload = describeUpload(resource);
        return upload.source === "unavailable" ? "Upload date unavailable" : upload.label;
      },
    },
    {
      id: "availability",
      header: "Availability",
      width: 112,
      cell: availabilityCell,
    },
    {
      id: "actions",
      header: "",
      width: 72,
      cell: (resource) => (
        <div className="row-actions">
          <IconButton
            label={`Open ${resource.title}`}
            size={28}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(resource.url);
            }}
          >
            <ExternalLink aria-hidden="true" />
          </IconButton>
          <Menu
            label={`Actions for ${resource.title}`}
            items={actionItems(resource, onOpen, onPreview)}
            trigger={
              <IconButton
                label={`Actions for ${resource.title}`}
                size={28}
                tooltip={false}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
            }
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="filter-bar">
        <div className="filter-bar-left">
          <Select
            value={courseFilter}
            onValueChange={setCourseFilter}
            options={[
              { value: "all", label: "All courses" },
              ...courses.map((course) => ({
                value: String(course.id),
                label: course.shortName ?? course.name,
              })),
            ]}
            ariaLabel="Filter by course"
          />
          <Select
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={[
              { value: "all", label: "All types" },
              ...types.map((option) => ({
                value: option.type,
                label: `${option.type} (${option.count})`,
              })),
            ]}
            ariaLabel="Filter by file type"
          />
        </div>
        <div className="filter-bar-right">
          <span className="result-count">
            {rows.length} of {unique.length}
          </span>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(resource) => resource.id}
        sort={sort}
        onSort={onSort}
        onRowClick={openResource}
        selectedKey={peek?.id ?? null}
        ariaLabel="All course files"
        virtual
        empty={
          <EmptyState
            title={filtersActive ? "No files match these filters" : "No files discovered yet"}
            body={
              filtersActive
                ? "Try a different search term or clear the filters."
                : "Quanta Pulse discovers files as it scans your courses."
            }
          />
        }
      />

      <PeekPanel
        open={peek !== null}
        details={peekDetails}
        onClose={() => {
          setPeek(null);
          lastPeek.current?.focus();
        }}
      />
    </>
  );
}

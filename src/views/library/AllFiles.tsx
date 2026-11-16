import { useSessionValue } from "../../hooks/useSessionViews";
import { useMaterialActions } from "../../hooks/useMaterialActions";
import { MaterialButtons } from "../../components/MaterialButtons";
import { useEffect, useMemo } from "react";
import { cx } from "../../lib/cx";
import { typeOptions } from "../../lib/courseLibrary";
import { dedupeCourseResources } from "../../lib/courseTree";
import { activityTimestamp } from "../../lib/filter";
import { fileTone } from "../../lib/filetype";
import { describeUpload, formatBytes, parseTimestamp } from "../../lib/format";
import { formatSectionPath } from "../../lib/sectionPath";
import type { DetailsAdapter } from "../../lib/details";
import type { Course, Resource } from "../../lib/types";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { CoursePill } from "../../components/ui/CoursePill";
import { StatusTag } from "../../components/ui/StatusTag";
import { EmptyState } from "../../components/ui/EmptyState";

interface AllFilesProps {
  resources: Resource[];
  courses: Course[];
  search: string;
  onOpen: (url: string) => void;
  onPreview: (resource: Resource) => void;
  details?: DetailsAdapter;
  onClearSearch?: () => void;
  onCourse?: (courseId: number) => void;
  /** Coordinator adapters consumed by the next All files keyboard worker. */
  onChanged?: () => void | Promise<void>;
  onFocusSearch?: () => void;
  inventoryPending?: boolean;
  inventoryError?: string | null;
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

/** Every discovered resource as one sortable, filterable table. */
export default function AllFiles({
  resources,
  courses,
  search,
  onOpen,
  onPreview,
  details,
  onClearSearch,
  onCourse,
}: AllFilesProps) {
  const destinations = useMaterialActions({ onOpen, onPreview });
  const [courseFilter, setCourseFilter] = useSessionValue("library:files:course", "all");
  const [typeFilter, setTypeFilter] = useSessionValue("library:files:type", "all");
  const [sort, setSort] = useSessionValue<{ id: SortId; dir: "asc" | "desc" }>("library:files:sort", {
    id: "uploaded",
    dir: "desc",
  });

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
    onClearSearch?.();
  };

  const selectedId = details?.selected?.kind === "resource" ? details.selected.resource.id : null;
  const selected = details?.selected;

  useEffect(() => {
    if (selected?.kind === "resource" && !rows.some((resource) => resource.id === selected.resource.id)) {
      details?.clear();
    }
  }, [details, rows, selected]);

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
          <button
            type="button"
            className="cell-title"
            data-resource-id={resource.id}
            aria-label={`Show details for ${resource.title}`}
            onClick={(event) => {
              event.stopPropagation();
              details?.selectResource(resource, event.currentTarget);
            }}
          >
            <span className="cell-title-main">{resource.title}</span>
            {size && <span className="cell-title-sub">{size}</span>}
          </button>
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
            onOpen={resource.courseId != null && onCourse ? () => onCourse(resource.courseId!) : undefined}
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
      width: 120,
      cell: (resource) => (
        <div className="row-actions">
          <MaterialButtons
            actions={destinations?.(resource) ?? []}
            label={`Actions for ${resource.title}`}
            menu={[{ id: "copy", label: "Copy link", onSelect: () => void navigator.clipboard?.writeText(resource.sourcePageUrl ?? resource.url) }]}
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
        sessionKey="library:files:table"
        columns={columns}
        rows={rows}
        getKey={(resource) => resource.id}
        sort={sort}
        onSort={onSort}
        onRowClick={(resource) => {
          const row = document.querySelector<HTMLElement>(`[data-resource-id="${resource.id}"]`)?.closest("tr") ?? null;
          if (row) row.tabIndex = -1;
          details?.selectResource(resource, row ?? (document.activeElement as HTMLElement));
        }}
        selectedKey={selectedId}
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

    </>
  );
}

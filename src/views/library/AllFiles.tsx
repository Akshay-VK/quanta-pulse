import { useSessionValue } from "../../hooks/useSessionViews";
import { useMaterialActions } from "../../hooks/useMaterialActions";
import { MaterialButtons } from "../../components/MaterialButtons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../lib/api";
import { getListNavigationIntent, recoverFocusedId, type ListNavigationInput } from "../../lib/listNavigation";
import ConfirmDialog from "../../components/ConfirmDialog";
import { cx } from "../../lib/cx";
import { typeOptions } from "../../lib/courseLibrary";
import { dedupeCourseResources } from "../../lib/courseTree";
import { activityTimestamp } from "../../lib/filter";
import { fileTone } from "../../lib/filetype";
import { describeUpload, formatBytes, parseTimestamp } from "../../lib/format";
import { formatSectionPath } from "../../lib/sectionPath";
import type { DetailsAdapter } from "../../lib/details";
import type { Course, Resource } from "../../lib/types";
import DataTable, { type DataColumn, type DataTableNavigationHandle } from "../../components/DataTable";
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

const identity = (resource: Resource) => resource.externalResourceId || `local:${resource.id}`;
const modalOpen = () => Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sidebar-drawer'));
interface Capture {
  generation: number;
  resourceIds: number[];
  eventIds: number[];
  action: "read" | "unread" | "dismiss";
  done: boolean;
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
  onChanged,
  onFocusSearch,
  inventoryPending = false,
  inventoryError,
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

  const navigation = useRef<DataTableNavigationHandle>(null);
  const container = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [, setBusy] = useState(false);
  const [refreshWait, setRefreshWait] = useState<{ resolve: (error: string | null) => void } | null>(null);
  useEffect(() => {
    if (refreshWait) {
      refreshWait.resolve(inventoryError ?? null);
      setRefreshWait(null);
    }
  }, [refreshWait, inventoryError]);
  const generation = useRef(0);
  const lock = useRef<number | null>(null);
  const previousIds = useRef<string[]>([]);
  const ownedFocus = useRef(false);
  const ids = useMemo(() => rows.map(identity), [rows]);
  const currentFocus = recoverFocusedId(previousIds.current, ids, focusedId);
  const latest = useRef({ inventoryError, inventoryPending, currentFocus });
  latest.current = { inventoryError, inventoryPending, currentFocus };
  const selected = details?.selected;
  const selectedId = selected?.kind === "resource" ? identity(selected.resource) : null;
  const context = `${search}\0${courseFilter}\0${typeFilter}`;

  useLayoutEffect(() => {
    generation.current += 1;
    lock.current = null;
    setCapture(null);
    setBusy(false);
    setStatus(null);
    return () => { generation.current += 1; lock.current = null; };
  }, [context]);

  useLayoutEffect(() => {
    const changed = previousIds.current.join("\0") !== ids.join("\0");
    previousIds.current = ids;
    setFocusedId(currentFocus);
    setSelection(prev => prev.filter(id => ids.includes(id)));
    if (changed && ownedFocus.current && !modalOpen()) {
      if (currentFocus) navigation.current?.focusKey(currentFocus);
      else onFocusSearch?.();
    }
  }, [ids, currentFocus, onFocusSearch]);

  useEffect(() => {
    if (selected?.kind === "resource" && !rows.some(resource => resource.id === selected.resource.id)) details?.clear();
  }, [details, rows, selected]);

  const restore = (id: string | null) => {
    // The destination tab/route owns fallback focus after this list unmounts.
    if (!container.current?.isConnected) return false;
    if (id && navigation.current?.focusKey(id)) return true;
    if (latest.current.currentFocus && navigation.current?.focusKey(latest.current.currentFocus)) return true;
    onFocusSearch?.();
    return true;
  };
  const inspect = (resource: Resource, origin: HTMLElement) => {
    const id = identity(resource);
    details?.selectResource(resource, origin, () => restore(id));
  };
  const mutate = async (scope: Capture) => {
    const token = scope.generation;
    if (generation.current !== token || lock.current !== null) return;
    lock.current = token;
    setBusy(true);
    setStatus(null);
    try {
      if (!scope.done) {
        if (scope.action === "dismiss") await api.dismissInboxEvents(scope.eventIds);
        else await api.setEventReadState(scope.eventIds, scope.action === "read");
        // Remember backend success even if refresh subsequently fails.
        scope.done = true;
      }
      if (generation.current !== token) return;
      await onChanged?.();
      if (generation.current !== token) return;
      // App reports refresh failure through props, after its promise completes.
      // A render acknowledgement observes that publication before closing.
      const refreshError = await new Promise<string | null>(resolve => setRefreshWait({ resolve }));
      if (generation.current !== token) return;
      if (refreshError) throw new Error(`Changes saved; inventory refresh failed: ${refreshError}`);
      setStatus("Captured changes saved.");
    } catch (error) {
      if (generation.current !== token) return;
      setStatus(`${scope.done ? "Changes saved; retry refresh only. " : ""}${String(error)}`);
      throw error;
    } finally {
      if (generation.current === token && lock.current === token) { lock.current = null; setBusy(false); }
    }
  };
  const beginCapture = async (targetIds: readonly string[], action: Capture["action"], confirm: boolean, policy: ListNavigationInput) => {
    if (lock.current !== null || capture) return;
    if (inventoryPending || inventoryError) {
      setStatus(inventoryError ? "Inventory refresh failed. Retry loading before changing events." : "Inventory is refreshing. Wait before changing events.");
      return;
    }
    const resourceIds = rows.filter(resource => targetIds.includes(identity(resource))).map(resource => resource.id);
    if (!resourceIds.length) { setStatus("No matching materials to capture."); return; }
    const token = ++generation.current;
    lock.current = token;
    setBusy(true);
    setStatus("Capturing recorded changes…");
    try {
      const snapshot = await api.snapshotResourceEventIds([...resourceIds]);
      if (generation.current !== token) return;
      const intent = getListNavigationIntent({ ...policy, completeEventIds: snapshot });
      const eventIds = intent?.type === "openCapturedScope" ? [...intent.eventIds] : [...snapshot];
      if (!eventIds.length) { setStatus("No eligible recorded changes in the captured scope."); return; }
      const scope: Capture = { generation: token, resourceIds, eventIds, action, done: false };
      lock.current = null;
      if (confirm) { setStatus(null); setCapture(scope); }
      else {
        try { await mutate(scope); }
        catch { if (generation.current === token) setCapture(scope); }
      }
    } catch (error) {
      if (generation.current === token) setStatus(`Could not capture changes: ${String(error)}. Try the shortcut again.`);
    } finally {
      if (generation.current === token && (lock.current === token || lock.current === null)) { lock.current = null; setBusy(false); }
    }
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const input: ListNavigationInput = {
      ids, focusedId: currentFocus, inspectedId: selectedId, selectedIds: selection,
      key: event.key, activeSurface: Boolean(target.closest("tr[data-row-key]")),
      editableTarget: Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')),
      nestedControl: Boolean(target.closest('button, a, [role="button"], [role="checkbox"]')),
      modalOpen: modalOpen(), isComposing: event.nativeEvent.isComposing,
      imeKeyCode229: event.keyCode === 229, repeat: event.repeat, defaultPrevented: event.defaultPrevented,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, completeEventIds: [],
    };
    const intent = getListNavigationIntent(input);
    if (!intent) return;
    event.preventDefault(); event.stopPropagation();
    if (intent.type === "focus") { setFocusedId(intent.id); navigation.current?.focusKey(intent.id); }
    else if (intent.type === "toggleSelection") setSelection(prev => prev.includes(intent.id) ? prev.filter(id => id !== intent.id) : [...prev, intent.id]);
    else if (intent.type === "inspect" || intent.type === "preview") {
      const resource = rows.find(resource => identity(resource) === intent.id);
      if (!resource) return;
      if (intent.type === "inspect") inspect(resource, target);
      else destinations?.(resource).find(action => action.id === "preview")?.onSelect?.();
    } else if (intent.type === "openCapturedScope") void beginCapture([...ids], "read", true, input);
    else if (intent.type === "confirmDelete") void beginCapture(intent.ids, "dismiss", true, input);
    else void beginCapture(intent.ids, intent.isRead ? "read" : "unread", false, input);
  };

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
              inspect(resource, event.currentTarget);
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
    <div ref={container} onKeyDown={handleKey}
      onFocusCapture={event => { ownedFocus.current = event.target instanceof HTMLElement && event.target.matches("tr[data-row-key]"); }}
      onBlurCapture={event => { if (event.relatedTarget instanceof Node && !container.current?.contains(event.relatedTarget)) ownedFocus.current = false; }}>
      {(status || inventoryPending || inventoryError) && <p role={status?.includes("failed") || inventoryError ? "alert" : "status"}>
        {status ?? (inventoryError ? "Inventory refresh failed. Retained materials remain inspectable; new changes are blocked." : "Inventory is refreshing; new changes are blocked.")}
      </p>}
      <span className="sr-only" aria-live="polite">{selection.length} materials selected</span>
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
        getKey={identity}
        navigationRef={navigation}
        focusedKey={currentFocus}
        multiSelectedKeys={selection}
        onRowFocus={resource => setFocusedId(identity(resource))}
        sort={sort}
        onSort={onSort}
        onRowClick={(resource) => {
          const row = navigation.current?.getRowElement(identity(resource));
          if (row) inspect(resource, row);
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

      {capture && <ConfirmDialog key={capture.generation} open onOpenChange={open => {
        if (!open && generation.current === capture.generation && lock.current === null) {
          setCapture(null); setStatus(null);
          requestAnimationFrame(() => { if (generation.current === capture.generation && !modalOpen()) restore(latest.current.currentFocus); });
        }
      }} title={capture.action === "dismiss" ? "Dismiss captured Inbox changes?" : capture.action === "unread" ? "Mark captured changes unread?" : "Mark captured changes read?"}
        destructive={capture.action === "dismiss"}
        body={<><p>{capture.eventIds.length} recorded changes across {capture.resourceIds.length} materials.</p>
          <p>{capture.action === "dismiss" ? "Dismiss these captured changes from Inbox? Library materials, History, saved files and your baseline are kept." : "Only these captured changes will be updated. Later arrivals are excluded."}</p>
          {status && <p role="alert">{status}</p>}</>}
        confirmLabel={capture.done ? "Retry refresh" : capture.action === "dismiss" ? "Dismiss captured changes" : capture.action === "unread" ? "Mark captured changes unread" : "Mark captured changes read"}
        onConfirm={() => mutate(capture)} />}
    </div>
  );
}

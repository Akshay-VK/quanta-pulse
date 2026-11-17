import { useSessionValue } from "../../hooks/useSessionViews";
import { useMaterialActions } from "../../hooks/useMaterialActions";
import { useMirror } from "../../hooks/useMirror";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../lib/api";
import { getListNavigationIntent, recoverFocusedId, type ListNavigationInput } from "../../lib/listNavigation";
import ConfirmDialog from "../../components/ConfirmDialog";
import { MaterialButtons } from "../../components/MaterialButtons";
import { Select } from "../../components/ui/Select";
import { typeOptions } from "../../lib/courseLibrary";
import { dedupeCourseResources } from "../../lib/courseTree";
import { activityTimestamp, splitLiteralMatches } from "../../lib/filter";
import { isLocal } from "../../lib/mirrorState";
import { courseTitle } from "../../lib/courseName";
import { formatCompact, parseTimestamp } from "../../lib/format";
import { formatSectionPath } from "../../lib/sectionPath";
import type { DetailsAdapter } from "../../lib/details";
import type { Course, Resource } from "../../lib/types";
import DataTable, { type DataColumn, type DataTableNavigationHandle } from "../../components/DataTable";
import { CoursePill } from "../../components/ui/CoursePill";
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

type SortId = "title" | "course" | "section" | "detected" | "saved";

const DEFAULT_DIR: Record<SortId, "asc" | "desc"> = {
  title: "asc",
  course: "asc",
  section: "asc",
  detected: "desc",
  saved: "desc",
};

function detectedAt(resource: Resource): number | null {
  const at = activityTimestamp(resource) ?? resource.firstSeenAt;
  return at ? (parseTimestamp(at)?.getTime() ?? null) : null;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = splitLiteralMatches(text, query);
  return <>{parts.map((p, i) => p.match ? <mark className="match-hl" key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>)}</>;
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
  const mirror = useMirror();
  const [courseFilter, setCourseFilter] = useSessionValue("library:files:course", "all");
  const [typeFilter, setTypeFilter] = useSessionValue("library:files:type", "all");
  const [savedFilter, setSavedFilter] = useSessionValue("library:files:saved", "all");
  const [sort, setSort] = useSessionValue<{ id: SortId; dir: "asc" | "desc" }>("library:files:sort", {
    id: "detected",
    dir: "desc",
  });

  const unique = useMemo(() => dedupeCourseResources(resources), [resources]);
  const types = useMemo(() => typeOptions(unique), [unique]);

  const isSaved = (r: Resource) => Boolean(mirror && isLocal(mirror.statusOf(r.id)));
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const type = typeFilter === "all" ? "" : typeFilter.toLowerCase();
    return unique.filter((r) => {
      if (courseFilter !== "all" && r.courseId !== Number(courseFilter)) return false;
      if (type && r.resourceType.trim().toLowerCase() !== type) return false;
      if (savedFilter === "saved" && !isSaved(r)) return false;
      if (savedFilter === "unsaved" && isSaved(r)) return false;
      if (needle) {
        const haystack =
          `${r.title} ${courseTitle(r.courseId, r.courseName)} ${r.resourceType} ${formatSectionPath(r)} ${r.sourcePageUrl ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [unique, search, typeFilter, courseFilter, savedFilter, mirror]);

  const rows = useMemo(() => {
    const sortId: SortId = (["title", "course", "section", "detected", "saved"] as const).includes(sort.id as SortId)
      ? (sort.id as SortId) : "detected";
    const dir = sort.dir === "asc" ? 1 : -1;
    const byTitle = (a: Resource, b: Resource) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id - b.id;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortId) {
        case "title": cmp = byTitle(a, b); break;
        case "course": cmp = courseTitle(a.courseId, a.courseName).localeCompare(courseTitle(b.courseId, b.courseName), undefined, { sensitivity: "base" }); break;
        case "section": cmp = formatSectionPath(a).localeCompare(formatSectionPath(b), undefined, { sensitivity: "base" }); break;
        case "saved": cmp = Number(isSaved(a)) - Number(isSaved(b)); break;
        case "detected":
        default: {
          const ta = detectedAt(a); const tb = detectedAt(b);
          if (ta === null && tb === null) cmp = 0;
          else if (ta === null) return 1;
          else if (tb === null) return -1;
          else cmp = ta - tb;
        }
      }
      return cmp !== 0 ? cmp * dir : byTitle(a, b);
    });
  }, [filtered, sort, mirror]);

  const filtersActive = courseFilter !== "all" || typeFilter !== "all" || savedFilter !== "all" || search.trim() !== "";

  const onSort = (id: string) => {
    const key = id as SortId;
    setSort((prev) =>
      prev.id === key ? { id: key, dir: prev.dir === "asc" ? "desc" : "asc" } : { id: key, dir: DEFAULT_DIR[key] ?? "asc" },
    );
  };

  const clearFilters = () => {
    setCourseFilter("all");
    setTypeFilter("all");
    setSavedFilter("all");
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

  const query = search.trim();
  const columns: DataColumn<Resource>[] = [
    {
      id: "title",
      header: "Name",
      className: "title-cell",
      width: 320,
      sortable: true,
      title: (resource) => resource.title,
      cell: (resource) => {
        const path = [courseTitle(resource.courseId, resource.courseName), ...formatSectionPath(resource).split(" / ").filter(Boolean)].join(" / ");
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
            <span className="cell-title-main"><Highlight text={resource.title} query={query} /></span>
            {query && <span className="cell-title-sub"><Highlight text={path} query={query} /></span>}
          </button>
        );
      },
    },
    {
      id: "course",
      header: "Course",
      width: 140,
      sortable: true,
      title: (resource) => courseTitle(resource.courseId, resource.courseName),
      cell: (resource) => (
        <span className="row-course-pill">
          <CoursePill
            courseId={resource.courseId}
            onOpen={resource.courseId != null && onCourse ? () => onCourse(resource.courseId!) : undefined}
            code={courseTitle(resource.courseId, resource.courseName)}
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
      cell: (resource) => <Highlight text={formatSectionPath(resource)} query={query} />,
    },
    {
      id: "detected",
      header: "Detected",
      className: "detected-cell",
      width: 140,
      sortable: true,
      title: (resource) => formatCompact(activityTimestamp(resource) ?? resource.firstSeenAt),
      cell: (resource) => formatCompact(activityTimestamp(resource) ?? resource.firstSeenAt),
    },
    {
      id: "saved",
      header: "Saved",
      width: 160,
      sortable: true,
      cell: (resource) => (
        <div className="saved-cell">
          <span>{isSaved(resource) ? "Saved" : "—"}</span>
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
        <div className="filter-bar-left filter-chips" role="group" aria-label="Filters">
          <div className="filter-chip"><span className="mono">Type</span>
            <Select value={typeFilter} onValueChange={setTypeFilter} ariaLabel="Filter by file type" options={[
              { value: "all", label: "All" },
              ...types.map((option) => ({ value: option.type, label: `${option.type} (${option.count})` })),
            ]} />
          </div>
          <div className="filter-chip"><span className="mono">Course</span>
            <Select value={courseFilter} onValueChange={setCourseFilter} ariaLabel="Filter by course" options={[
              { value: "all", label: "All" },
              ...courses.map((course) => ({ value: String(course.id), label: course.shortName ?? course.name })),
            ]} />
          </div>
          <label className="filter-chip" aria-label="Saved filter"><span className="mono">Saved</span>
            <select value={savedFilter} onChange={(e) => setSavedFilter(e.target.value)} aria-label="Saved">
              <option value="all">All</option>
              <option value="saved">Saved</option>
              <option value="unsaved">Not saved</option>
            </select>
          </label>
          {query && <span className="filter-chip active" aria-label="Search query"><span className="mono">Search</span><span>{query}</span></span>}
        </div>
        <div className="filter-bar-right">
          <span className="result-count">{rows.length} of {unique.length}</span>
          {filtersActive && <button type="button" className="btn ghost sm" onClick={clearFilters}>Clear filters</button>}
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

import { SearchControls } from "../../components/SearchControls";
import { useSessionValue } from "../../hooks/useSessionViews";
import { buildDisplayNames, loadAliases } from "../../lib/courseName";
import { searchDesktop } from "../../lib/desktopSearch";
import type { SearchQueryState, SearchScope, SearchFilters } from "../../lib/desktopSearch";
import { useMaterialActions } from "../../hooks/useMaterialActions";
import { useMirror } from "../../hooks/useMirror";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownUp, Check, X } from "lucide-react";
import { api } from "../../lib/api";
import { getListNavigationIntent, recoverFocusedId, type ListNavigationInput } from "../../lib/listNavigation";
import ConfirmDialog from "../../components/ConfirmDialog";
import { MaterialButtons } from "../../components/MaterialButtons";
import GroupHeader from "../../components/GroupHeader";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { FileTypeIcon } from "../../components/ui/FileTypeIcon";
import { UnreadDot } from "../../components/ui/UnreadDot";
import { Select } from "../../components/ui/Select";
import { dedupeCourseResources } from "../../lib/courseTree";
import { splitLiteralMatches } from "../../lib/filter";
import { isLocal } from "../../lib/mirrorState";
import { courseTitle } from "../../lib/courseName";
import { formatCompact, formatListDate, parseTimestamp } from "../../lib/format";
import { formatSectionPath, resourceSectionPath } from "../../lib/sectionPath";
import type { DetailsAdapter } from "../../lib/details";
import type { Course, Resource } from "../../lib/types";
import DataTable, { type DataColumn, type DataTableNavigationHandle } from "../../components/DataTable";
import { CoursePill } from "../../components/ui/CoursePill";
import { EmptyState } from "../../components/ui/EmptyState";
import { LibraryFooter } from "./LibraryFrame";

interface AllFilesProps {
  resources: Resource[];
  courses: Course[];
  search: string;
  onSearchChange?: (raw: string) => void;
  initialSearchQuery?: SearchQueryState;
  timeZone?: string;
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
  searchField?: ReactNode;
  unreadResourceIds?: ReadonlySet<number>;
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

const EMPTY_IDS: ReadonlySet<number> = new Set();

type SortId = "title" | "course" | "section" | "detected" | "saved" | "relevance";

const DEFAULT_DIR: Record<SortId, "asc" | "desc"> = {
  title: "asc",
  course: "asc",
  section: "asc",
  detected: "desc",
  saved: "desc",
  relevance: "desc",
};

function detectedAt(resource: Resource): number | null {
  return parseTimestamp(resource.firstSeenAt)?.getTime() ?? null;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = splitLiteralMatches(text, query);
  return <>{parts.map((p, i) => p.match ? <mark className="match-hl" key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>)}</>;
}

/** Every discovered resource as one sortable, filterable table. */
export default function AllFiles({
  resources,
  courses,
  search, onSearchChange, initialSearchQuery, timeZone,
  onOpen,
  onPreview,
  details,
  onClearSearch,
  onCourse,
  onChanged,
  onFocusSearch,
  inventoryPending = false,
  inventoryError,
  searchField,
  unreadResourceIds,
}: AllFilesProps) {
  const destinations = useMaterialActions({ onOpen, onPreview });
  const mirror = useMirror();
  const [showSort, setShowSort] = useState(false);
  const [scope, setScope] = useSessionValue<SearchScope>("library:files:scope", { kind: "everywhere" });
  const [dateFilters, setDateFilters] = useSessionValue<SearchFilters>("library:files:dates", {});
  const [appliedRequest, setAppliedRequest] = useSessionValue<number>("library:files:request", -1);
  const [sort, setSort] = useSessionValue<{ id: SortId; dir: "asc" | "desc" }>("library:files:sort", {
    id: "relevance",
    dir: "desc",
  });
  useEffect(() => {
    if (initialSearchQuery && initialSearchQuery.requestId !== appliedRequest) {
      setScope(initialSearchQuery.scope);
      setDateFilters({ sourceFrom: initialSearchQuery.sourceFrom ?? undefined, sourceThrough: initialSearchQuery.sourceThrough ?? undefined });
      setSort({ id: "relevance", dir: "desc" });
      setAppliedRequest(initialSearchQuery.requestId);
    }
  }, [initialSearchQuery, appliedRequest, setAppliedRequest, setDateFilters, setScope, setSort]);


  const unique = useMemo(() => dedupeCourseResources(resources), [resources]);

  const isSaved = (r: Resource) => Boolean(!r.isExternal && mirror && isLocal(mirror.statusOf(r.id)));
  const displayNames = useMemo(() => buildDisplayNames(courses, loadAliases()), [courses]);
  const unreadIds = unreadResourceIds ?? EMPTY_IDS;
  const savedIds = useMemo(() => new Set(unique.filter((r) => isSaved(r)).map((r) => r.id)), [unique, mirror]);
  const searchResult = useMemo(() => searchDesktop(
    { raw: search, scope, filters: dateFilters, timeZone },
    { courses, resources: unique, displayNames, unreadIds, savedIds },
  ), [search, scope, unique, courses, displayNames, unreadIds, savedIds, dateFilters, timeZone]);
  const searchErrors = searchResult.errors;
  const filtered = searchResult.files;

  const rows = useMemo(() => {
    const sortId: SortId = (["title", "course", "section", "detected", "saved", "relevance"] as const).includes(sort.id as SortId)
      ? (sort.id as SortId) : "detected";
    if (sortId === "relevance") return filtered;
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

  const filtersActive = Boolean(search.trim() || dateFilters.sourceFrom || dateFilters.sourceThrough);
  const onSort = (id: string) => {
    const key = id as SortId;
    setSort(prev => prev.id === key ? { id: key, dir: prev.dir === "asc" ? "desc" : "asc" } : { id: key, dir: DEFAULT_DIR[key] ?? "asc" });
  };
  const clearFilters = () => { setDateFilters({}); onClearSearch?.(); };

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
  const context = JSON.stringify([search, scope, dateFilters]);

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
      sortable: true,
      title: (resource) => resource.title,
      cell: (resource) => {
        const path = [courseTitle(resource.courseId, resource.courseName), ...resourceSectionPath(resource)].join(" / ");
        const unread = unreadResourceIds?.has(resource.id);
        return (
          <button
            type="button"
            className={unread ? "cell-title is-unread" : "cell-title"}
            data-resource-id={resource.id}
            aria-label={`Show details for ${resource.title}`}
            onClick={(event) => {
              event.stopPropagation();
              inspect(resource, event.currentTarget);
            }}
          >
            {unread && <span className="library-file-unread"><UnreadDot unread /></span>}
            <FileTypeIcon type={resource.resourceType} />
            <span className="library-file-title-copy">
              <span className="cell-title-main"><Highlight text={resource.title} query={query} /></span>
              {query && <span className="cell-title-sub"><Highlight text={path} query={query} /></span>}
            </span>
          </button>
        );
      },
    },
    {
      id: "course",
      header: "Course",
      width: 100,
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
      width: 100,
      sortable: true,
      title: (resource) => formatSectionPath(resource),
      cell: (resource) => <Highlight text={resourceSectionPath(resource).at(-1) ?? ""} query={query} />,
    },
    {
      id: "detected",
      header: "Detected",
      className: "detected-cell",
      width: 84,
      numeric: true,
      sortable: true,
      title: (resource) => formatCompact(resource.firstSeenAt),
      cell: (resource) => formatListDate(resource.firstSeenAt),
    },
    {
      id: "saved",
      header: "Saved",
      width: 56,
      sortable: true,
      cell: (resource) => (
        <div className="saved-cell">
          <span className="library-saved-mark">{isSaved(resource) && <Check aria-label="Saved" />}</span>
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
    <div ref={container} className={query ? "all-files-view library-search-results" : "all-files-view"} onKeyDown={handleKey}
      onFocusCapture={event => { ownedFocus.current = event.target instanceof HTMLElement && event.target.matches("tr[data-row-key]"); }}
      onBlurCapture={event => { if (event.relatedTarget instanceof Node && !container.current?.contains(event.relatedTarget)) ownedFocus.current = false; }}>
      {(status || inventoryPending || inventoryError) && <Banner kind={status?.includes("failed") || inventoryError ? "error" : "info"}>
        {status ?? (inventoryError ? "Inventory refresh failed. Retained materials remain inspectable; new changes are blocked." : "Inventory is refreshing; new changes are blocked.")}
      </Banner>}
      {searchErrors.length > 0 && <Banner kind="error">{searchErrors.join(" ")}</Banner>}
      <span className="sr-only" aria-live="polite">{selection.length} materials selected</span>
      <div className="library-toolbar">
        {query && <Button variant="secondary" size="sm" trailingIcon={<X aria-hidden="true" />} onClick={onClearSearch}>Search “{query}”</Button>}
        <Button className="library-toolbar-end" variant="ghost" size="sm" leadingIcon={<ArrowDownUp aria-hidden="true" />} aria-expanded={showSort} onClick={() => setShowSort((open) => !open)}>Sort</Button>
      </div>
      <div className="library-toolbar">{searchField}{filtersActive && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}<span>Sort: {sort.id}</span></div>
      <SearchControls raw={search} onRaw={onSearchChange ?? (() => {})} scope={scope} onScope={setScope} filters={dateFilters} onFilters={setDateFilters} courses={courses} resources={unique} />
      {showSort && <div className="library-toolbar">
        <Select ariaLabel="Sort files by" value={sort.id} onValueChange={(value) => onSort(value)} options={[{ value: "relevance", label: "Relevance" }, ...columns.map(({ id, header }) => ({ value: id, label: header }))]} />
        <Button variant="ghost" size="sm" onClick={() => onSort(sort.id)}>{sort.dir === "asc" ? "Ascending" : "Descending"}</Button>
      </div>}

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
        groupHeader={<GroupHeader label="All files" count={rows.length} />}
        rowHeight={query ? 48 : 34}
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
      <LibraryFooter>{query ? `${rows.length} ${rows.length === 1 ? "match" : "matches"}` : `${rows.length} ${rows.length === 1 ? "file" : "files"}`}{rows.length > 0 && rows.every(isSaved) && " · all saved on this device"}</LibraryFooter>

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

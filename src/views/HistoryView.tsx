// History: the full log of changes and scans.
//
// Changes are the same canonical `change_events` rows other views read, grouped
// by local calendar day. Scans are persisted `scan_runs` with per-course
// diagnostics available through the details panel/scan details API.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Copy, History, ListFilter, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { courseTitle } from "../lib/courseName";
import { eventKindMeta, localDayKey } from "../lib/events";
import { formatCompact, formatTimeOfDay } from "../lib/format";
import {
  filterHistoryEvents,
  frozenDeleteCopy,
  groupHistoryEvents,
  historyDayLabel,
  HISTORY_RANGE_OPTIONS,
  HISTORY_TYPE_OPTIONS,
  rangeBounds,
  type HistoryDateRange,
  type HistoryTypeFilter,
} from "../lib/historyActions";
import { scanDurationText, scanStatusMeta, type DetailsAdapter, type RestoreDetailFocus } from "../lib/details";
import { getListNavigationIntent, recoverFocusedId } from "../lib/listNavigation";
import { useMaterialActions } from "../hooks/useMaterialActions";
import { useMirror } from "../hooks/useMirror";
import type { ChangeEvent, Course, HistoryDeletionScope, Resource, ScanRun } from "../lib/types";
import { ACTIVITY_HINTS, WorkspaceViewHeader, WorkspaceViewStatus } from "../components/WorkspaceViewChrome";
import ResourceRow from "../components/ResourceRow";
import GroupHeader from "../components/GroupHeader";
import DataTable, { type DataColumn, type DataTableNavigationHandle } from "../components/DataTable";
import ConfirmDialog from "../components/ConfirmDialog";
import { Button } from "../components/ui/Button";
import { Banner } from "../components/ui/Banner";
import { Menu } from "../components/ui/Menu";
import { ViewTabs } from "../components/ui/Tabs";
import { Select } from "../components/ui/Select";
import { SearchField } from "../components/ui/SearchField";
import { EmptyState } from "../components/ui/EmptyState";
import { Dialog } from "../components/ui/Dialog";
import type { StatusKind } from "../components/ui/StatusTag";
import { Tooltip } from "../components/ui/Tooltip";

/** Explicit interface for course-scoped historical activity lists (e.g. CoursePage). */
export interface HistoryActivityListProps {
  events: ChangeEvent[];
  resources: Resource[];
  details?: DetailsAdapter;
  onSelect?: (event: ChangeEvent, origin: HTMLElement, resource: Resource | null) => void;
}

export interface HistoryViewProps {
  courses: Course[];
  events: ChangeEvent[];
  eventScopeReady?: boolean;
  onSetEventReadState?: (ids: number[], read: boolean) => Promise<void>;
  onDismissEvents?: (ids: number[]) => Promise<void>;
  onChanged?: () => Promise<void>;
  scans: ScanRun[];
  onOpen: (url: string) => void;
  onOpenLocal?: (resourceId: number) => void;
  onMarkAllRead: () => Promise<void>;
  onClearAll: () => Promise<void>;
  onSyncNow: () => void;
  /** Opens a course page from a row's course pill. */
  onOpenCourse?: (courseId: number) => void;
  details: DetailsAdapter;
  resources: Resource[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  headerActions?: ReactNode;
  initialTab?: "changes" | "scans";
}

const STATUS_KIND: Record<string, StatusKind> = {
  new: "new",
  updated: "updated",
  deadline: "deadline",
  announcement: "note",
  unavailable: "unavailable",
  restored: "restored",
};

const BASELINE_TIP =
  "First scan of a course. It records everything as known and reports no changes.";

function eventTitle(e: ChangeEvent): string {
  return e.resourceTitle ?? e.title;
}

function timestampLabel(value: string) {
  const day = localDayKey(value);
  const group = day && historyDayLabel(day);
  return group === "Today" || group === "Yesterday" ? `${group} ${formatTimeOfDay(value)}` : formatCompact(value);
}

function scanResultLabel(status: string) {
  if (status === "ok" || status === "success") return "Success";
  if (status === "partial") return "Partial";
  if (status === "failed" || status === "cancelled" || status === "error") return "Failed";
  return scanStatusMeta(status).label;
}

function numberCell(value: number) {
  return value === 0 ? <span className="num zero">0</span> : value;
}

export default function HistoryView({
  courses,
  events,
  eventScopeReady,
  onSetEventReadState,
  onDismissEvents,
  onChanged,
  scans: recordedScans,
  onOpen: _onOpen,
  onOpenLocal: _onOpenLocal,
  onMarkAllRead,
  onClearAll,
  onSyncNow,
  onOpenCourse,
  details,
  resources,
  loading,
  error,
  onRetry,
  headerActions,
  initialTab = "changes",
}: HistoryViewProps) {
  const mirror = useMirror();
  const [tab, setTab] = useState<"changes" | "scans">(initialTab);
  const [typeFilter, setTypeFilter] = useState<HistoryTypeFilter>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [range, setRange] = useState<HistoryDateRange>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [scanResult, setScanResult] = useState("all");
  const scans = useMemo(() => {
    const { start, end } = rangeBounds(range, new Date(), dateFrom, dateTo);
    return recordedScans.filter(scan => {
      const at = Date.parse(scan.startedAt);
      return (scanResult === "all" || scanResultLabel(scan.status).toLowerCase() === scanResult)
        && (start === null || at >= start) && (end === null || at <= end);
    });
  }, [recordedScans, scanResult, range, dateFrom, dateTo]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteScope, setDeleteScope] = useState<HistoryDeletionScope | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const readRequest = useRef(false);

  const destinations = useMaterialActions();
  const [focused, setFocused] = useState<string | null>(() => events.length ? `change:${events[0].id}` : null);
  const [selected, setSelected] = useState<string[]>([]);
  type Capture = { ids: readonly number[]; read?: boolean; generation: number; origin: string | null; confirmed: boolean; dialog?: boolean; written: boolean };
  const [capture, setCapture] = useState<Capture | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const captureRef = useRef<Capture | null>(null);
  const dialogOrigin = useRef<string | null>(null);
  const locked = useRef(false);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const currentIds = useRef<string[]>([]);
  const previousIds = useRef<string[]>([]);
  const listOwnedFocus = useRef(false);
  const [focusedScan, setFocusedScan] = useState<string | null>(null);
  const focusedScanRef = useRef<string | null>(null);
  focusedScanRef.current = focusedScan;
  const scanIds = useMemo(() => scans.map((scan) => `scan:${scan.id}`), [scans]);
  const scanIdsRef = useRef<string[]>(scanIds);
  scanIdsRef.current = scanIds;
  const previousScanIds = useRef<string[]>([]);
  const scanFocusOwned = useRef(false);
  const scanNav = useRef<DataTableNavigationHandle | null>(null);
  const viewRoot = useRef<HTMLDivElement>(null);
  const scanGeneration = useRef(0);
  const scanMounted = useRef(true);
  const clearRequest = useRef(false);

  const invalidate = () => {
    generation.current += 1;
    locked.current = false;
    captureRef.current = null;
    setCapture(null);
    setActionError(null);
    setPending(false);
  };
  useEffect(() => () => { generation.current += 1; locked.current = false; }, []);
  const restore = (id: string | null) => {
    if (!searchRef.current?.isConnected) return false;
    if (document.querySelector('[aria-modal="true"], [role="menu"], [role="listbox"]')) return true;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.matches('.row-select') && !active.closest('.peek')) return true;
    (id && currentIds.current.includes(id) ? rows.current.get(id) : searchRef.current)?.focus();
    return true;
  };
  async function execute(action: Capture) {
    if (locked.current || action.generation !== generation.current) return;
    locked.current = true;
    action.confirmed = true;
    setPending(true);
    setActionError(null);
    try {
      if (!action.written) {
        if (action.read === undefined) await onDismissEvents?.([...action.ids]);
        else await onSetEventReadState?.([...action.ids], action.read);
        if (action.generation !== generation.current) return;
        action.written = true;
      }
      await onChanged?.();
      if (action.generation !== generation.current) return;
      captureRef.current = null;
      setCapture(null);
      requestAnimationFrame(() => { if (action.generation === generation.current) restore(action.origin); });
    } catch (err) {
      if (action.generation === generation.current) setActionError(`${action.written ? "Changes saved; refresh failed" : "Changes could not be saved"}: ${String(err)}`);
    } finally {
      if (action.generation === generation.current) { locked.current = false; setPending(false); }
    }
  }

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const courseOptions = useMemo(
    () => [
      { value: "all", label: "All courses" },
      ...courses.map((c) => ({ value: String(c.id), label: courseTitle(c.id, c.name) })),
    ],
    [courses],
  );

  const filtered = useMemo(() => filterHistoryEvents(events, {
    type: typeFilter,
    courseId: courseFilter === "all" ? "all" : Number(courseFilter),
    search,
    range,
    from: dateFrom || undefined,
    to: dateTo || undefined,
  }), [events, typeFilter, courseFilter, search, range, dateFrom, dateTo]);

  const groups = useMemo(() => groupHistoryEvents(filtered), [filtered]);
  const navigationIds = useMemo(() => groups.flatMap(group => group.items.map(e => `change:${e.id}`)), [groups]);
  currentIds.current = navigationIds;

  useEffect(() => {
    const recovered = recoverFocusedId(previousIds.current, navigationIds, focused);
    const ownedFocus = listOwnedFocus.current && (document.activeElement === document.body || (document.activeElement instanceof HTMLElement && document.activeElement.matches('.row-select')));
    previousIds.current = navigationIds;
    if (recovered !== focused) {
      setFocused(recovered);
      if (ownedFocus) (recovered ? rows.current.get(recovered) : searchRef.current)?.focus();
    }
    setSelected(old => {
      const matching = new Set(navigationIds);
      const next = old.filter(id => matching.has(id));
      return next.length === old.length ? old : next;
    });
  }, [navigationIds, focused]);

  useEffect(() => {
    scanMounted.current = true;
    return () => {
      scanMounted.current = false;
      scanGeneration.current += 1;
    };
  }, []);

  const scansTabControl = () =>
    [...(viewRoot.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
      .find((node) => /Scan/i.test(node.textContent ?? "")) ?? null;

  function scanModalOpen() {
    return Boolean(document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .sidebar-drawer',
    ));
  }

  /** Focus the inspected scan's current row, its surviving neighbor, or the Scans tab. */
  function scanRestore(scanId: number): RestoreDetailFocus {
    scanGeneration.current += 1;
    const gen = scanGeneration.current;
    const activeAtRequest = document.activeElement;
    return () => {
      if (gen !== scanGeneration.current || !scanMounted.current || scanModalOpen()) return false;
      const known = scanIdsRef.current.includes(`scan:${scanId}`);
      const resolved = known
        ? null
        : recoverFocusedId(previousScanIds.current, scanIdsRef.current, focusedScanRef.current);
      const key = known ? scanId : resolved == null ? null : Number(resolved.slice(5));
      const nav = scanNav.current;
      if (key == null || !nav) {
        const control = scansTabControl();
        if (!control) return false;
        scanFocusOwned.current = false;
        control.focus();
        return true;
      }
      const element = nav.getRowElement(key);
      if (element) { element.focus(); return true; }
      const current = document.activeElement;
      if (current !== activeAtRequest && current !== document.body) return true;
      queueMicrotask(() => {
        if (gen !== scanGeneration.current || !scanMounted.current || scanModalOpen()) return;
        if (document.activeElement !== activeAtRequest && document.activeElement !== document.body) return;
        scanNav.current?.focusKey(key);
      });
      return true;
    };
  }

  function onScansKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const rowId = target?.dataset.rowKey == null ? null : Number(target.dataset.rowKey);
    const directRow = rowId != null && scanNav.current?.getRowElement(rowId) === target;
    const id = directRow && rowId != null ? `scan:${rowId}` : focusedScan;
    const intent = getListNavigationIntent({
      ids: scanIds, focusedId: id, inspectedId: selectedScanId == null ? null : `scan:${selectedScanId}`, selectedIds: [],
      key: event.key, activeSurface: tab === "scans" && directRow,
      editableTarget: !!target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
      nestedControl: !directRow,
      modalOpen: scanModalOpen(),
      isComposing: event.nativeEvent.isComposing, imeKeyCode229: event.keyCode === 229,
      repeat: event.repeat, defaultPrevented: event.defaultPrevented,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
      completeEventIds: [],
    });
    if (intent?.type !== "focus" && intent?.type !== "inspect") return;
    const key = Number(intent.id.slice(5));
    if (intent.type === "focus") {
      event.preventDefault(); event.stopPropagation();
      setFocusedScan(intent.id);
      scanNav.current?.focusKey(key);
      return;
    }
    const recorded = scans.find((scan) => scan.id === key);
    const origin = scanNav.current?.getRowElement(key) ?? null;
    if (!recorded || !origin) return;
    event.preventDefault(); event.stopPropagation();
    details.selectScan(recorded, origin, scanRestore(recorded.id));
  }

  function onChangesKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const rowControl = target?.closest<HTMLButtonElement>('.row-select');
    const id = [...rows.current].find(([, node]) => node === rowControl)?.[0] ?? focused;
    const eligible = (ids: readonly string[]) => {
      const matching = new Set(ids);
      return filtered.filter(e => matching.has(`change:${e.id}`) && Number.isSafeInteger(e.id) && e.id > 0 && e.changeType !== "baseline").map(e => e.id);
    };
    const intent = getListNavigationIntent({
      ids: navigationIds, focusedId: id, inspectedId: selectedChangeId == null ? null : `change:${selectedChangeId}`, selectedIds: selected,
      key: event.key, activeSurface: tab === "changes" && !!rowControl,
      editableTarget: !!target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
      nestedControl: !rowControl,
      modalOpen: !!document.querySelector('[aria-modal="true"], [role="menu"], [role="listbox"], [data-state="open"][role="dialog"]'),
      isComposing: event.nativeEvent.isComposing, imeKeyCode229: event.keyCode === 229,
      repeat: event.repeat, defaultPrevented: event.defaultPrevented,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
      completeEventIds: eligible(navigationIds),
    });
    if (!intent) return;
    event.preventDefault(); event.stopPropagation();
    if (intent.type === "focus") { setFocused(intent.id); rows.current.get(intent.id)?.focus(); return; }
    if (intent.type === "toggleSelection") { setSelected(old => old.includes(intent.id) ? old.filter(i => i !== intent.id) : [...old, intent.id]); return; }
    if (intent.type === "inspect" || intent.type === "preview") {
      const recorded = filtered.find(e => `change:${e.id}` === intent.id);
      if (!recorded) return;
      const resource = resources.find(r => r.id === recorded.resourceId) ?? null;
      if (intent.type === "preview") destinations?.(resource, recorded).find(item => item.id === "preview" && !("disabled" in item && item.disabled))?.onSelect?.();
      else { const origin = rows.current.get(intent.id); if (origin) details.selectChange(recorded, origin, resource, () => restore(intent.id)); }
      return;
    }
    if (!eventScopeReady || loading || error || captureRef.current || locked.current || !onChanged) return;
    const ids = intent.type === "openCapturedScope" ? [...intent.eventIds] : eligible(intent.ids);
    const read = intent.type === "confirmDelete" ? undefined : intent.type === "setReadState" ? intent.isRead : true;
    if (!ids.length || (read === undefined ? !onDismissEvents : !onSetEventReadState)) return;
    const action: Capture = { ids: Object.freeze([...new Set(ids)]), read, generation: generation.current, origin: id, dialog: intent.type !== "setReadState", confirmed: intent.type === "setReadState", written: false };
    captureRef.current = action;
    dialogOrigin.current = id;
    setCapture(action);
    if (action.confirmed) void execute(action);
  }

  const hasUnread = events.some((e) => !e.read);
  const selectedChangeId = details.selected?.kind === "change" ? details.selected.change.id : null;
  const selectedScanId = details.selected?.kind === "scan" ? details.selected.scan.id : null;
  const selection = details.selected;

  useEffect(() => {
    details.clear();
  }, [tab, details.clear]);
  useEffect(() => {
    if (selection?.kind === "change" && !filtered.some((event) => event.id === selection.change.id)) details.clear();
    if (selection?.kind === "scan" && !scans.some((scan) => scan.id === selection.scan.id)) details.clear();
  }, [details.clear, filtered, scans, selection]);

  useEffect(() => {
    const recovered = recoverFocusedId(previousScanIds.current, scanIds, focusedScan);
    previousScanIds.current = scanIds;
    if (recovered === focusedScan) return;
    setFocusedScan(recovered);
    if (!scanFocusOwned.current) return;
    if (recovered) scanNav.current?.focusKey(Number(recovered.slice(5)));
    else scansTabControl()?.focus();
  }, [scanIds, focusedScan]);

  async function markAllRead() {
    if (readRequest.current || !hasUnread) return;
    readRequest.current = true;
    setMarkingRead(true);
    try {
      await onMarkAllRead();
    } catch {
      // The app shell reports backend failures in its shared toast.
    } finally {
      readRequest.current = false;
      setMarkingRead(false);
    }
  }

  const openDelete = useCallback(async () => {
    if (clearRequest.current) return;
    clearRequest.current = true;
    setDeleteError(null);
    setDeleteScope(null);
    setDeleteLoading(true);
    setConfirmClear(true);
    try {
      const scope = await api.snapshotHistoryDeletion(true);
      setDeleteScope(scope);
    } catch (err) {
      setDeleteError(`Could not prepare history deletion: ${String(err)}`);
    } finally {
      setDeleteLoading(false);
      clearRequest.current = false;
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (clearRequest.current) return;
    clearRequest.current = true;
    setDeleteError(null);
    try {
      if (deleteScope) {
        await api.deleteHistorySnapshot(deleteScope);
        await onChanged?.();
      } else {
        await onClearAll();
      }
      setConfirmClear(false);
      setDeleteScope(null);
    } catch (err) {
      setDeleteError(`History could not be deleted: ${String(err)}`);
      throw err;
    } finally {
      clearRequest.current = false;
    }
  }, [deleteScope, onChanged, onClearAll]);

  const scanColumns: DataColumn<ScanRun>[] = [
    {
      id: "started",
      header: "Started",
      cell: (s) => (
        <span className="cell-title">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Show details for scan of ${formatCompact(s.startedAt)}`}
            onClick={(event) => details.selectScan(s, event.currentTarget)}
          >
            {timestampLabel(s.startedAt)}
          </Button>
          {s.isBaseline && (
            <Tooltip content={BASELINE_TIP}>
              <span className="status-pill">Baseline</span>
            </Tooltip>
          )}
        </span>
      ),
      title: (s) => formatCompact(s.startedAt),
    },
    {
      id: "duration",
      header: "Duration",
      cell: (s) => {
        const duration = Date.parse(s.completedAt ?? "") - Date.parse(s.startedAt);
        return <span className="mono">{Number.isFinite(duration) && duration >= 0 && duration < 60_000 ? `${(duration / 1_000).toFixed(1)} s` : scanDurationText(s)}</span>;
      },
    },
    {
      id: "status",
      header: "Result",
      cell: (s) => {
        const meta = scanStatusMeta(s.status);
        return (
          <span className={`tag tag-${meta.kind}`}>
            {meta.running && <span className="spinner" aria-hidden="true" />}
            {scanResultLabel(s.status)}
          </span>
        );
      },
    },
    { id: "courses", header: "Courses", numeric: true, cell: (s) => <span className="mono">{Math.max(0, s.coursesScanned - s.coursesFailed)} / {s.coursesScanned}</span> },
    { id: "unavailable", header: "New / Updated / Removed", numeric: true, cell: (s) => <span className="mono">{scanResultLabel(s.status) === "Failed" ? "—" : <>{numberCell(s.newCount)} / {numberCell(s.updatedCount)} / {numberCell(s.unavailableCount)}</>}</span> },
  ];

  const recordedDay = scans[0] ? localDayKey(scans[0].startedAt) : "";
  const oneScanDay = recordedDay && scans.every(scan => localDayKey(scan.startedAt) === recordedDay);

  const deleteCopy = deleteScope
    ? frozenDeleteCopy(deleteScope)
    : { title: "Delete recorded history?", body: "Preparing the exact events and scan records that will be removed…" };
  const activityEmptyTitle = loading && events.length === 0 ? "Loading History…" : error && events.length === 0 ? "History unavailable" : events.length === 0 ? "No history yet" : "No changes match these filters";
  const activityEmptyBody = events.length === 0
    ? (error ? "Retry to load recorded changes." : "Recorded changes and scans appear here after your first scan.")
    : "Try changing the type, course, date range, or search.";
  const scansEmptyTitle = loading ? "Loading scans…" : error ? "Scans unavailable" : recordedScans.length ? "No scans match these filters" : "No history yet";
  const scansEmptyBody = error ? "Retry to load recorded scans." : "Recorded changes and scans appear here after your first scan.";

  return (
    <div ref={viewRoot} className="history-view workspace-view" onKeyDown={event => {
      if (tab === "changes" && event.key === "/" && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, [role="dialog"], [role="menu"]'))) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }}>
      <WorkspaceViewHeader title="History" actions={headerActions} tabs={
        <ViewTabs
          items={[{ id: "changes", label: "Activity" }, { id: "scans", label: "Scans", accessibleLabel: "Scan history" }]}
          value={tab}
          onChange={(next) => { invalidate(); scanGeneration.current += 1; setTab(next as "changes" | "scans"); }}
          ariaLabel="History views"
        />
      } />
      <div className="filter-bar workspace-view-toolbar">
        <div className="filter-bar-left">
          <Button variant="ghost" size="sm" leadingIcon={<ListFilter aria-hidden="true" />} onClick={() => viewRoot.current?.querySelector<HTMLElement>('.workspace-view-toolbar [role="combobox"]')?.focus()}>
            Filter
          </Button>
          {tab === "scans" && <div className="workspace-filter-selector"><span>Result</span><Select ariaLabel="Filter by scan result" value={scanResult} onValueChange={setScanResult} options={[{ value: "all", label: "Any" }, ...["success", "partial", "failed", "running"].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} /></div>}
          {tab === "changes" && <>
            <div className="workspace-filter-selector"><span>Type</span><Select value={typeFilter} onValueChange={(next) => { invalidate(); setTypeFilter(next as HistoryTypeFilter); }} options={HISTORY_TYPE_OPTIONS.map(o => ({ ...o }))} ariaLabel="Filter by change type" /></div>
            <div className="workspace-filter-selector"><span>Course</span><Select value={courseFilter} onValueChange={(next) => { invalidate(); setCourseFilter(next); }} options={courseOptions} ariaLabel="Filter by course" /></div>
          </>}
          <div className="workspace-filter-selector"><span>Date</span><Select value={range} onValueChange={(next) => { invalidate(); setRange(next as HistoryDateRange); }} options={HISTORY_RANGE_OPTIONS.map(o => ({ ...o }))} ariaLabel="Filter by date range" /></div>
          {range === "custom" && (
            <div className="history-date-range" aria-label="Custom date range">
              <label className="history-date-field"><span>From</span><input type="date" value={dateFrom} onChange={(e) => { invalidate(); setDateFrom(e.target.value); }} /></label>
              <label className="history-date-field"><span>To</span><input type="date" value={dateTo} onChange={(e) => { invalidate(); setDateTo(e.target.value); }} /></label>
            </div>
          )}
          {tab === "changes" && <SearchField className="workspace-local-search" value={search} onChange={(next) => { invalidate(); setSearch(next); }} inputRef={searchRef} debounceMs={0} placeholder="Search changes…" label="Search changes" />}
        </div>
        <Menu
          label="History actions"
          items={[
            { id: "clear", label: "Delete history…", danger: true, onSelect: () => void openDelete() },
            { id: "mark-read", label: markingRead ? "Marking read" : "Mark loaded history read", disabled: !hasUnread || markingRead, onSelect: () => void markAllRead() },
          ]}
          trigger={<Button variant="ghost" size="sm" leadingIcon={<SlidersHorizontal aria-hidden="true" />} aria-label="History actions">Display</Button>}
        />
      </div>
      {loading && (tab === "changes" ? events.length > 0 : scans.length > 0) && <span className="sr-only" role="status">Refreshing History…</span>}
      {error && (tab === "changes" ? events.length > 0 : scans.length > 0) && (
        <Banner kind="error" action={{ label: "Retry History", onClick: onRetry }}>{error}</Banner>
      )}

      {tab === "changes" ? (
        <div
          className="history-activity workspace-view-list"
          onKeyDown={onChangesKey}
          onFocusCapture={(event) => { listOwnedFocus.current = event.target instanceof HTMLElement && event.target.matches('.row-select'); }}
          onBlurCapture={(event) => { if (event.relatedTarget) listOwnedFocus.current = false; }}
        >
          {capture?.confirmed && !capture.dialog && <div role={actionError ? "alert" : "status"} className="result-count history-capture-status">{actionError ?? "Saving captured changes…"}{actionError && <Button disabled={pending} onClick={() => void execute(capture)}>{capture.written ? "Retry refresh" : "Retry captured action"}</Button>}</div>}
          {filtered.length === 0 ? (
            <div className="workspace-view-empty"><span className="workspace-empty-icon" aria-hidden="true"><History /></span><EmptyState
              title={activityEmptyTitle}
              body={activityEmptyBody}
              action={events.length === 0 && error ? { label: "Retry History", onClick: onRetry } : events.length === 0 ? { label: "Sync now", onClick: onSyncNow } : undefined}
            /></div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="history-day-group">
                <GroupHeader label={group.label} count={group.items.length} />
                {group.items.map((e) => {
                  const meta = eventKindMeta(e.changeType);
                  const course = e.courseId != null ? courseById.get(e.courseId) : undefined;
                  const currentResource = resources.find((resource) => resource.id === e.resourceId);
                  return (
                    <ResourceRow
                      resource={currentResource ?? null}
                      recorded={e}
                      key={e.id}
                      title={eventTitle(e)}
                      type={e.resourceType}
                      courseId={e.courseId}
                      courseCode={courseTitle(e.courseId, course?.shortName ?? e.courseName ?? course?.name)}
                      courseName={e.courseName}
                      unread={!e.read} workspaceVariant="history"
                      selected={selectedChangeId === e.id}
                      keyboardFocused={focused === `change:${e.id}`}
                      multiSelected={selected.includes(`change:${e.id}`)}
                      tabStop={focused === `change:${e.id}`}
                      selectRef={(node) => { if (node) rows.current.set(`change:${e.id}`, node); else rows.current.delete(`change:${e.id}`); }}
                      onKeyboardFocus={() => setFocused(`change:${e.id}`)}
                      unavailable={e.changeType === "unavailable"}
                      status={{ kind: STATUS_KIND[e.changeType] ?? "new", label: meta.label }}
                      timeLabel={formatTimeOfDay(e.detectedAt)}
                      onCourse={e.courseId != null && onOpenCourse ? () => onOpenCourse(e.courseId as number) : undefined}
                      local={currentResource && !currentResource.isExternal ? mirror?.statusOf(currentResource.id) : undefined}
                      onSelect={(origin) => details.selectChange(e, origin, currentResource ?? null, () => restore(`change:${e.id}`))}
                      menu={[{ id: "copy", label: "Copy link", icon: <Copy aria-hidden="true" />, onSelect: () => void navigator.clipboard?.writeText(e.sourcePageUrl ?? e.resourceUrl ?? "") }]}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : scans.length === 0 ? (
        <div className="workspace-view-list"><div className="workspace-view-empty"><span className="workspace-empty-icon" aria-hidden="true"><History /></span><EmptyState
          title={scansEmptyTitle}
          body={scansEmptyBody}
          action={error ? { label: "Retry History", onClick: onRetry } : { label: "Sync now", onClick: onSyncNow }}
        /></div></div>
      ) : (
        <div
          className="history-scans workspace-view-list"
          onKeyDown={onScansKey}
          onFocusCapture={(event) => { scanFocusOwned.current = event.target instanceof HTMLElement && event.target.matches('tr[data-row-key]'); }}
          onBlurCapture={(event) => { if (event.relatedTarget) scanFocusOwned.current = false; }}
        >
          <DataTable
            columns={scanColumns}
            rows={scans}
            getKey={(s) => s.id}
            selectedKey={selectedScanId}
            focusedKey={focusedScan == null ? null : Number(focusedScan.slice(5))}
            onRowFocus={(s) => setFocusedScan(`scan:${s.id}`)}
            navigationRef={scanNav}
            virtual
            groupHeader={oneScanDay ? <GroupHeader label={historyDayLabel(recordedDay)} count={scans.length} /> : undefined}
            ariaLabel="Scan history"
          />
        </div>
      )}

      <WorkspaceViewStatus hints={ACTIVITY_HINTS}>{tab === "changes" ? `${filtered.length} events` : `${scans.length} scans`}{range !== "all" && ` · ${HISTORY_RANGE_OPTIONS.find(option => option.value === range)?.label}`}</WorkspaceViewStatus>

      <Dialog
        open={!!capture?.dialog}
        onOpenChange={(open) => { if (!open && !locked.current) { captureRef.current = null; setCapture(null); setActionError(null); } }}
        role="alertdialog"
        label={capture?.read === undefined ? "Dismiss captured changes from Inbox?" : "Mark captured changes read?"}
        className="dialog-confirm"
        initialFocusRef={capture?.read === undefined ? cancelRef : undefined}
        onCloseAutoFocus={(event) => { event.preventDefault(); restore(dialogOrigin.current); }}
      >
        <h2 className="dialog-title">{capture?.read === undefined ? "Dismiss captured changes from Inbox?" : "Mark captured changes read?"}</h2>
        <div className="dialog-body">
          <p>{capture?.ids.length ?? 0} captured changes</p>
          <p>{capture?.read === undefined ? "Dismiss these captured changes from Inbox? History, resources, saved files and your baseline are kept." : "Mark only these captured changes read. Later arrivals are excluded."}</p>
          {actionError && <p role="alert">{actionError}</p>}
        </div>
        <div className="dialog-footer">
          <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={() => { captureRef.current = null; setCapture(null); setActionError(null); }}>Cancel</Button>
          <Button className="dialog-primary" variant={capture?.read === undefined ? "danger" : "primary"} disabled={pending} onClick={() => { if (capture) void execute(capture); }}>{capture?.written ? "Retry refresh" : capture?.read === undefined ? "Dismiss from Inbox" : "Mark captured changes read"}</Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={(next) => {
          if (!next) {
            if (clearRequest.current) return;
            setConfirmClear(false);
            setDeleteError(null);
          }
        }}
        title={deleteCopy.title}
        body={
          <>
            <p>{deleteCopy.body}</p>
            {deleteLoading && <p>Loading deletion scope…</p>}
            <p>Saved files and your baseline are not affected.</p>
            {deleteError && <p role="alert">{deleteError}</p>}
          </>
        }
        confirmLabel={deleteScope ? "Delete history" : "Delete recorded history"}
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

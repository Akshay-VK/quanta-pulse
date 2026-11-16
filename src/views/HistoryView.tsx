// History: the full log of changes and scans.
//
// Changes are the same canonical `change_events` rows Today and the Calendar
// read, grouped by local calendar day so a change looks identical everywhere.
// Scans are the persisted `scan_runs` table, shown as a data table.

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { getListNavigationIntent, recoverFocusedId } from "../lib/listNavigation";
import { useMaterialActions } from "../hooks/useMaterialActions";
import { Dialog } from "../components/ui/Dialog";
import { Copy, MoreHorizontal } from "lucide-react";
import type { ChangeEvent, Course, Resource, ScanRun } from "../lib/types";
import { dayKeyOf, eventKindMeta, groupEventsByDay, todayKey } from "../lib/events";
import { formatCompact, formatTimeOfDay } from "../lib/format";
import { courseTitle } from "../lib/courseName";
import { scanStatusMeta, type DetailsAdapter, type RestoreDetailFocus } from "../lib/details";
import PageHeader from "../components/PageHeader";
import ResourceRow from "../components/ResourceRow";
import { useMirror } from "../hooks/useMirror";
import GroupHeader from "../components/GroupHeader";
import DataTable, { type DataColumn, type DataTableNavigationHandle } from "../components/DataTable";
import ConfirmDialog from "../components/ConfirmDialog";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Menu } from "../components/ui/Menu";
import { ViewTabs } from "../components/ui/Tabs";
import { Select } from "../components/ui/Select";
import { SearchField } from "../components/ui/SearchField";
import { EmptyState } from "../components/ui/EmptyState";
import type { StatusKind } from "../components/ui/StatusTag";
import { Tooltip } from "../components/ui/Tooltip";

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
}

const TYPE_FILTERS = [
  { value: "all", label: "All changes" },
  { value: "new", label: "New" },
  { value: "updated", label: "Updated" },
  { value: "announcement", label: "Announcement" },
  { value: "deadline", label: "Deadline" },
  { value: "unavailable", label: "Unavailable" },
  { value: "restored", label: "Restored" },
];

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

function dayLabel(key: string): string {
  const now = new Date();
  const today = todayKey(now);
  if (key === today) return "Today";
  const yesterday = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
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
  scans,
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
}: HistoryViewProps) {
  const mirror = useMirror();
  const [tab, setTab] = useState("changes");
  const [typeFilter, setTypeFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
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
      // Dialog's close callback resolves the current event identity.
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

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const courseId = courseFilter === "all" ? null : Number(courseFilter);
    return events.filter((e) => {
      if (typeFilter !== "all" && e.changeType !== typeFilter) return false;
      if (courseId != null && e.courseId !== courseId) return false;
      if (needle) {
        const haystack = `${eventTitle(e)} ${e.courseName ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [events, typeFilter, courseFilter, search]);

  const groups = useMemo(() => {
    const byDay = groupEventsByDay(filtered);
    return [...byDay.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({ key, label: dayLabel(key), items: byDay.get(key) ?? [] }));
  }, [filtered]);

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
      // Tab, route and unmount invalidate deferred focus requests.
      scanGeneration.current += 1;
    };
  }, []);

  const scansTabControl = () =>
    [...(viewRoot.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
      .find((node) => node.textContent?.trim() === "Scan history") ?? null;

  function scanModalOpen() {
    return Boolean(document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .sidebar-drawer',
    ));
  }

  /** Focus the inspected scan's current row, its surviving neighbor, or the Scans tab. */
  function scanRestore(scanId: number): RestoreDetailFocus {
    scanGeneration.current += 1;
    const generation = scanGeneration.current;
    const activeAtRequest = document.activeElement;
    return () => {
      if (generation !== scanGeneration.current || !scanMounted.current || scanModalOpen()) return false;
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
        if (generation !== scanGeneration.current || !scanMounted.current || scanModalOpen()) return;
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
    // Scan rows expose navigation and inspection only; every other intent is inert.
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

  // Runs after stale-inspection clearing so a removed row can still resolve its neighbor.
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
            {formatCompact(s.startedAt)}
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
      id: "status",
      header: "Status",
      cell: (s) => {
        const meta = scanStatusMeta(s.status);
        return (
          <span className={`tag tag-${meta.kind}`}>
            {meta.running && <span className="spinner" aria-hidden="true" />}
            {meta.label}
          </span>
        );
      },
    },
    { id: "found", header: "Found", numeric: true, cell: (s) => numberCell(s.discoveredCount) },
    { id: "new", header: "New", numeric: true, cell: (s) => numberCell(s.newCount) },
    { id: "updated", header: "Updated", numeric: true, cell: (s) => numberCell(s.updatedCount) },
    {
      id: "unavailable",
      header: "Unavailable",
      numeric: true,
      cell: (s) => numberCell(s.unavailableCount),
    },
    { id: "courses", header: "Courses", numeric: true, cell: (s) => `${Math.max(0, s.coursesScanned - s.coursesFailed)}/${s.coursesScanned}` },
    {
      id: "errors",
      header: "Errors",
      numeric: true,
      cell: (s) => numberCell(s.errorSummary ? s.errorSummary.split(";").filter((part) => part.trim()).length : 0),
    },
  ];

  return (
    <div ref={viewRoot}>
      <PageHeader
        title="History"
        summary="Every recorded change and scan"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={markingRead}
              disabled={!hasUnread}
              onClick={() => void markAllRead()}
            >
              {markingRead ? "Marking read" : "Mark loaded history read"}
            </Button>
            <Menu
              label="History actions"
              items={[
                {
                  id: "clear",
                  label: "Delete recorded history…",
                  danger: true,
                  onSelect: () => setConfirmClear(true),
                },
              ]}
              trigger={
                <IconButton label="History actions" size={28} tooltip={false}>
                  <MoreHorizontal aria-hidden="true" />
                </IconButton>
              }
            />
          </>
        }
      />

      <div className="history-tabs">
        <ViewTabs
          items={[
            { id: "changes", label: "Activity" },
            { id: "scans", label: "Scan history" },
          ]}
          value={tab}
          onChange={(next) => { invalidate(); scanGeneration.current += 1; setTab(next); }}
          ariaLabel="History views"
        />
      </div>

      {loading && (tab === "changes" ? events.length > 0 : scans.length > 0) && <div role="status" className="result-count">Refreshing History…</div>}
      {error && (tab === "changes" ? events.length > 0 : scans.length > 0) && (
        <div role="alert" className="empty-state">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>Retry History</Button>
        </div>
      )}

      {tab === "changes" ? (
        <div
          onKeyDown={onChangesKey}
          onFocusCapture={(event) => { listOwnedFocus.current = event.target instanceof HTMLElement && event.target.matches('.row-select'); }}
          onBlurCapture={(event) => { if (event.relatedTarget) listOwnedFocus.current = false; }}
        >
          {capture?.confirmed && !capture.dialog && <div role={actionError ? "alert" : "status"} className="result-count">{actionError ?? "Saving captured changes…"}{actionError && <Button disabled={pending} onClick={() => void execute(capture)}>{capture.written ? "Retry refresh" : "Retry captured action"}</Button>}</div>}
          <div className="filter-bar">
            <div className="filter-bar-left">
              <Select
                value={typeFilter}
                onValueChange={(next) => { invalidate(); setTypeFilter(next); }}
                options={TYPE_FILTERS}
                ariaLabel="Filter by change type"
              />
              <Select
                value={courseFilter}
                onValueChange={(next) => { invalidate(); setCourseFilter(next); }}
                options={courseOptions}
                ariaLabel="Filter by course"
              />
            </div>
            <div className="filter-bar-right">
              <SearchField
                value={search}
                onChange={(next) => { invalidate(); setSearch(next); }}
                inputRef={searchRef}
                debounceMs={0}
                placeholder="Search changes…"
                label="Search changes"
              />
              <span className="result-count">
                {filtered.length} of {events.length}
              </span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={loading && events.length === 0 ? "Loading History…" : error && events.length === 0 ? "History unavailable" : events.length === 0 ? "No changes recorded" : "No changes match these filters"}
              body={
                events.length === 0
                  ? error ? "Retry to load recorded changes." : "Changes appear after the first scan finishes. The first scan only sets a baseline."
                  : "Try changing the filters or search terms."
              }
              action={events.length === 0 && error ? { label: "Retry History", onClick: onRetry } : undefined}
            />
          ) : (
            groups.map((group) => (
              <div key={group.key}>
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
                      unread={!e.read}
                      selected={selectedChangeId === e.id}
                      keyboardFocused={focused === `change:${e.id}`}
                      multiSelected={selected.includes(`change:${e.id}`)}
                      tabStop={focused === `change:${e.id}`}
                      selectRef={(node) => { if (node) rows.current.set(`change:${e.id}`, node); else rows.current.delete(`change:${e.id}`); }}
                      onKeyboardFocus={() => setFocused(`change:${e.id}`)}
                      unavailable={e.changeType === "unavailable"}
                      status={{ kind: STATUS_KIND[e.changeType] ?? "new", label: meta.label }}
                      timeLabel={formatTimeOfDay(e.detectedAt)}
                      onCourse={
                        e.courseId != null && onOpenCourse
                          ? () => onOpenCourse(e.courseId as number)
                          : undefined
                      }
                      local={
                        currentResource && !currentResource.isExternal ? mirror?.statusOf(currentResource.id) : undefined
                      }
                      onSelect={(origin) => details.selectChange(e, origin, currentResource ?? null, () => restore(`change:${e.id}`))}
                      menu={[
                        {
                          id: "copy",
                          label: "Copy link",
                          icon: <Copy aria-hidden="true" />,
                          onSelect: () =>
                            void navigator.clipboard?.writeText(
                              e.sourcePageUrl ?? e.resourceUrl ?? "",
                            ),
                        },
                      ]}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : scans.length === 0 ? (
        <EmptyState
          title={loading ? "Loading scans…" : error ? "Scans unavailable" : "No scans yet"}
          body={error ? "Retry to load recorded scans." : "Run your first scan to set a baseline"}
          action={error ? { label: "Retry History", onClick: onRetry } : { label: "Sync now", onClick: onSyncNow }}
        />
      ) : (
        <div
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
            ariaLabel="Scan history"
          />
        </div>
      )}

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
        onOpenChange={setConfirmClear}
        title="Permanently delete recorded history?"
        body={<><p>This permanently removes every recorded change and scan from this machine, including dismissed Inbox changes. Resources and saved files remain.</p>{deleteError && <p role="alert">{deleteError}</p>}</>}
        confirmLabel="Delete changes and scans"
        destructive
        onConfirm={async () => { setDeleteError(null); try { await onClearAll(); } catch (err) { setDeleteError(`History could not be deleted: ${String(err)}`); throw err; } }}
      />
    </div>
  );
}

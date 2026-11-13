// History: the full log of changes and scans.
//
// Changes are the same canonical `change_events` rows Today and the Calendar
// read, grouped by local calendar day so a change looks identical everywhere.
// Scans are the persisted `scan_runs` table, shown as a data table.

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, MoreHorizontal } from "lucide-react";
import type { ChangeEvent, Course, Resource, ScanRun } from "../lib/types";
import { dayKeyOf, eventKindMeta, groupEventsByDay, todayKey } from "../lib/events";
import { formatCompact, formatTimeOfDay } from "../lib/format";
import { courseTitle } from "../lib/courseName";
import { eventLinks, primaryUrl } from "../lib/open";
import type { DetailsAdapter } from "../lib/details";
import PageHeader from "../components/PageHeader";
import ResourceRow from "../components/ResourceRow";
import { useMirror } from "../hooks/useMirror";
import GroupHeader from "../components/GroupHeader";
import DataTable, { type DataColumn } from "../components/DataTable";
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

interface ScanStatusMeta {
  kind: StatusKind;
  label: string;
  running?: boolean;
}

function scanStatusMeta(status: string): ScanStatusMeta {
  switch (status) {
    case "running":
      return { kind: "new", label: "Running", running: true };
    case "ok":
      return { kind: "restored", label: "Completed" };
    case "partial":
      return { kind: "updated", label: "Completed with errors" };
    case "cancelled":
      return { kind: "deadline", label: "Failed" };
    default:
      return { kind: "deadline", label: status };
  }
}

function numberCell(value: number) {
  return value === 0 ? <span className="num zero">0</span> : value;
}

export default function HistoryView({
  courses,
  events,
  scans,
  onOpen,
  onOpenLocal,
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
  const [markingRead, setMarkingRead] = useState(false);
  const readRequest = useRef(false);

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
    <div>
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
              {markingRead ? "Marking read" : "Mark all read"}
            </Button>
            <Menu
              label="History actions"
              items={[
                {
                  id: "clear",
                  label: "Clear history…",
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
            { id: "changes", label: "Changes" },
            { id: "scans", label: "Scans" },
          ]}
          value={tab}
          onChange={setTab}
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
        <>
          <div className="filter-bar">
            <div className="filter-bar-left">
              <Select
                value={typeFilter}
                onValueChange={setTypeFilter}
                options={TYPE_FILTERS}
                ariaLabel="Filter by change type"
              />
              <Select
                value={courseFilter}
                onValueChange={setCourseFilter}
                options={courseOptions}
                ariaLabel="Filter by course"
              />
            </div>
            <div className="filter-bar-right">
              <SearchField
                value={search}
                onChange={setSearch}
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
                  const primary = primaryUrl(eventLinks(e));
                  const currentResource = resources.find((resource) => resource.id === e.resourceId);
                  return (
                    <ResourceRow
                      key={e.id}
                      title={eventTitle(e)}
                      type={e.resourceType}
                      courseId={e.courseId}
                      courseCode={courseTitle(e.courseId, course?.shortName ?? e.courseName ?? course?.name)}
                      courseName={e.courseName}
                      unread={!e.read}
                      selected={selectedChangeId === e.id}
                      unavailable={e.changeType === "unavailable"}
                      status={{ kind: STATUS_KIND[e.changeType] ?? "new", label: meta.label }}
                      timeLabel={formatTimeOfDay(e.detectedAt)}
                      onCourse={
                        e.courseId != null && onOpenCourse
                          ? () => onOpenCourse(e.courseId as number)
                          : undefined
                      }
                      openLabel={
                        e.changeType === "deadline"
                          ? "Open course"
                          : e.changeType === "announcement"
                            ? "Read post"
                            : "Open file"
                      }
                      showOpen={Boolean(primary)}
                      local={
                        currentResource ? mirror?.statusOf(currentResource.id) : undefined
                      }
                      onOpenLocal={
                        currentResource && onOpenLocal
                          ? () => onOpenLocal(currentResource.id)
                          : undefined
                      }
                      onSelect={(origin) => details.selectChange(e, origin, currentResource ?? null)}
                      onOpen={primary ? () => onOpen(primary) : undefined}
                      menu={[
                        ...(e.resourceUrl
                          ? [
                              {
                                id: "open-file",
                                label: "Open file",
                                icon: <ExternalLink aria-hidden="true" />,
                                onSelect: () => onOpen(e.resourceUrl as string),
                              },
                            ]
                          : []),
                        ...(e.sourcePageUrl
                          ? [
                              {
                                id: "open-page",
                                label: "Open Quanta page",
                                icon: <ExternalLink aria-hidden="true" />,
                                onSelect: () => onOpen(e.sourcePageUrl as string),
                              },
                            ]
                          : []),
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
        </>
      ) : scans.length === 0 ? (
        <EmptyState
          title={loading ? "Loading scans…" : error ? "Scans unavailable" : "No scans yet"}
          body={error ? "Retry to load recorded scans." : "Run your first scan to set a baseline"}
          action={error ? { label: "Retry History", onClick: onRetry } : { label: "Sync now", onClick: onSyncNow }}
        />
      ) : (
        <DataTable
          columns={scanColumns}
          rows={scans}
          getKey={(s) => s.id}
          selectedKey={selectedScanId}
          ariaLabel="Scan history"
        />
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear history?"
        body="This permanently removes every recorded change and scan from this machine. Course resources are not affected."
        confirmLabel="Clear history"
        destructive
        onConfirm={onClearAll}
      />
    </div>
  );
}

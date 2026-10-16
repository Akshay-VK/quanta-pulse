import { useMemo, useState } from "react";
import { Copy, ExternalLink, MailOpen, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import ResourceRow from "../components/ResourceRow";
import GroupHeader from "../components/GroupHeader";
import ConfirmDialog from "../components/ConfirmDialog";
import { Button } from "../components/ui/Button";
import { Menu } from "../components/ui/Menu";
import { IconButton } from "../components/ui/IconButton";
import { FilterTabs } from "../components/ui/Tabs";
import { SearchField } from "../components/ui/SearchField";
import { Select } from "../components/ui/Select";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Banner } from "../components/ui/Banner";
import { MoreHorizontal } from "lucide-react";
import {
  FEED_KINDS,
  activityTimestamp,
  filterResources,
  groupByDate,
  isBaselineResource,
  matchesKind,
  type FeedKind,
} from "../lib/filter";
import { canPreview } from "../lib/preview";
import { useMirror } from "../hooks/useMirror";
import { courseTitle } from "../lib/courseName";
import { primaryUrl, resourceLinks } from "../lib/open";
import { parseTimestamp, formatDate, formatTimeOfDay, todayLabel } from "../lib/format";
import { summarySentence } from "../lib/summary";
import type { Course, Resource } from "../lib/types";
import type { StatusKind } from "../components/ui/StatusTag";

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function rowTime(resource: Resource): string {
  const ts = parseTimestamp(activityTimestamp(resource));
  if (!ts) return "—";
  const now = new Date();
  if (sameLocalDay(ts, now)) return formatTimeOfDay(activityTimestamp(resource));
  return formatDate(activityTimestamp(resource));
}

function rowStatus(
  resource: Resource,
  eventKinds: Map<number, Set<string>>,
): { kind: StatusKind; label: string } | null {
  const kinds = eventKinds.get(resource.id);
  if (resource.availabilityStatus !== "available") {
    return { kind: "unavailable", label: "Unavailable" };
  }
  if (kinds?.has("announcement")) return { kind: "note", label: "Announcement" };
  if (kinds?.has("updated")) return { kind: "updated", label: "Updated" };
  if (kinds?.has("new")) return { kind: "new", label: "New" };
  if (resource.dueAt) {
    const due = parseTimestamp(resource.dueAt);
    if (due && due.getTime() - Date.now() < 1000 * 60 * 60 * 24 * 14) {
      return { kind: "deadline", label: "Deadline" };
    }
  }
  return null;
}

function openLabel(resource: Resource, eventKinds: Map<number, Set<string>>): string {
  const kinds = eventKinds.get(resource.id);
  if (resource.dueAt) return "Open course";
  if (kinds?.has("announcement")) return "Read post";
  return "Open file";
}

function nearestDeadlineDays(resources: Resource[]): number | null {
  const now = Date.now();
  let nearest: number | null = null;
  for (const resource of resources) {
    if (!resource.dueAt) continue;
    const due = parseTimestamp(resource.dueAt);
    if (!due) continue;
    const days = Math.ceil((due.getTime() - now) / 86_400_000);
    if (days < 0) continue;
    if (nearest === null || days < nearest) nearest = days;
  }
  return nearest;
}

export default function TodayView({
  resources,
  hasStoredResources,
  courses,
  eventKinds,
  unreadIds,
  lastSyncLabel,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  onOpen,
  onPreview,
  onOpenLocal,
  onToggleRead,
  onMarkAllRead,
  onClearActivity,
  onSyncNow,
  onOpenCourse,
}: {
  resources: Resource[];
  hasStoredResources: boolean;
  courses: Course[];
  eventKinds: Map<number, Set<string>>;
  unreadIds: Set<number>;
  lastSyncLabel?: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedId: number | null;
  onSelect: (resource: Resource) => void;
  onOpen: (url: string) => void;
  onOpenLocal: (resourceId: number) => void;
  onPreview: (resource: Resource) => void;
  onToggleRead: (resource: Resource) => void;
  onMarkAllRead: () => void;
  onClearActivity: () => Promise<void>;
  onSyncNow: () => void;
  /** Opens a course page from a row's course pill. */
  onOpenCourse: (courseId: number) => void;
}) {
  const mirror = useMirror();

  const [kind, setKind] = useState<FeedKind>("all");
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);

  // Today is a feed of change events. Everything the baseline scan discovered
  // but that has never changed is summarised once, below, instead of listed.
  const [events, baselineCount] = useMemo(() => {
    let baseline = 0;
    const live = resources.filter((resource) => {
      if (isBaselineResource(resource, eventKinds)) {
        baseline += 1;
        return false;
      }
      return true;
    });
    return [live, baseline] as const;
  }, [resources, eventKinds]);

  const scoped = useMemo(
    () => filterResources(events, { kind: "all", courseId: courseFilter === "all" ? null : Number(courseFilter) }),
    [events, courseFilter],
  );

  const tabs = useMemo(
    () =>
      FEED_KINDS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        count: scoped.filter((r) => matchesKind(r, entry.id, eventKinds)).length,
      })),
    [scoped, eventKinds],
  );

  const filtered = useMemo(
    () =>
      filterResources(events, {
        kind,
        courseId: courseFilter === "all" ? null : Number(courseFilter),
        search,
        eventKinds,
      }),
    [events, kind, courseFilter, search, eventKinds],
  );
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  const summary = useMemo(() => {
    const hasKinds = (r: Resource, k: string) => Boolean(eventKinds.get(r.id)?.has(k));
    return summarySentence({
      counts: {
        new: scoped.filter((r) => hasKinds(r, "new")).length,
        updated: scoped.filter((r) => hasKinds(r, "updated")).length,
        announcement: scoped.filter((r) => hasKinds(r, "announcement")).length,
        deadline: scoped.filter((r) => matchesKind(r, "deadlines", eventKinds)).length,
        unavailable: scoped.filter((r) => matchesKind(r, "unavailable", eventKinds)).length,
      },
      nearestDeadlineDays: nearestDeadlineDays(scoped),
      lastSyncLabel,
    });
  }, [scoped, eventKinds, lastSyncLabel]);

  const courseLabelOf = (id: number | null) =>
    id == null ? null : courseTitle(id, courses.find((c) => c.id === id)?.name);

  const courseOptions = useMemo(
    () => [
      { value: "all", label: "All courses" },
      ...courses.map((course) => ({
        value: String(course.id),
        label: courseTitle(course.id, course.name),
      })),
    ],
    [courses],
  );

  let empty: { title: string; body: string; action?: { label: string; onClick: () => void } };
  if (resources.length === 0) {
    if (!hasStoredResources) {
      empty = {
        title: "Nothing tracked yet",
        body: "Run a scan and Pulse will list your course files here",
        action: { label: "Sync now", onClick: onSyncNow },
      };
    } else {
      empty = { title: "You're all caught up", body: "New uploads appear after the next scan" };
    }
  } else {
    empty = { title: "No matches", body: "Try a different filter" };
  }

  return (
    <div>
      <PageHeader
        caption={todayLabel()}
        title="Today"
        summary={summary}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onMarkAllRead}>
              Mark all read
            </Button>
            <Menu
              label="Activity actions"
              items={[
                {
                  id: "clear",
                  label: "Clear activity…",
                  danger: true,
                  onSelect: () => setConfirmClear(true),
                },
              ]}
              trigger={
                <IconButton label="Activity actions" size={28} tooltip={false}>
                  <MoreHorizontal aria-hidden="true" />
                </IconButton>
              }
            />
          </>
        }
      />

      <div className="filter-bar">
        <div className="filter-bar-left">
          <FilterTabs
            items={tabs}
            value={kind}
            onChange={(id) => setKind(id as FeedKind)}
            ariaLabel="Activity filters"
          />
        </div>
        <div className="filter-bar-right">
          <Select
            value={courseFilter}
            onValueChange={setCourseFilter}
            options={courseOptions}
            ariaLabel="Filter by course"
          />
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search titles…"
            label="Search activity"
          />
        </div>
      </div>

      {courseFilter !== "all" && (
        <div className="chip-row">
          <button
            type="button"
            className="chip"
            onClick={() => setCourseFilter("all")}
            title="Clear course filter"
          >
            <span className="chip-label">
              {courseTitle(Number(courseFilter), courses.find((c) => c.id === Number(courseFilter))?.name)}
            </span>
            <X className="chip-x" aria-hidden="true" />
            <span className="sr-only">Clear course filter</span>
          </button>
        </div>
      )}

      {error && (
        <Banner kind="error" action={{ label: "Try again", onClick: onRetry }}>
          Could not load activity
        </Banner>
      )}

      {loading ? (
        <Skeleton rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState title={empty.title} body={empty.body} action={empty.action} />
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            <GroupHeader label={group.label} count={group.items.length} />
            {group.items.map((resource) => (
              <ResourceRow
                key={resource.id}
                title={resource.title}
                type={resource.resourceType}
                courseId={resource.courseId}
                courseCode={courseLabelOf(resource.courseId)}
                courseName={resource.courseName}
                unread={unreadIds.has(resource.id)}
                selected={selectedId === resource.id}
                unavailable={resource.availabilityStatus !== "available"}
                status={rowStatus(resource, eventKinds)}
                timeLabel={rowTime(resource)}
                openLabel={openLabel(resource, eventKinds)}
                previewAvailable={canPreview(resource.resourceType, resource.url)}
                local={resource.isExternal ? undefined : mirror?.statusOf(resource.id)}
                onSelect={() => onSelect(resource)}
                onCourse={
                  resource.courseId != null
                    ? () => onOpenCourse(resource.courseId as number)
                    : undefined
                }
                onOpenLocal={() => onOpenLocal(resource.id)}
                onOpen={() => onOpen(primaryUrl(resourceLinks(resource)) ?? resource.url)}
                onPreview={() => onPreview(resource)}
                menu={[
                  ...(resource.courseId != null
                    ? [
                        {
                          id: "open-course",
                          label: `Open ${courseLabelOf(resource.courseId) ?? "course"}`,
                          icon: <ExternalLink aria-hidden="true" />,
                          onSelect: () => onOpenCourse(resource.courseId as number),
                        },
                      ]
                    : []),
                  {
                    id: "open-file",
                    label: "Open file",
                    icon: <ExternalLink aria-hidden="true" />,
                    onSelect: () => onOpen(resource.url),
                  },
                  ...(resource.sourcePageUrl
                    ? [
                        {
                          id: "open-page",
                          label: "Open Quanta page",
                          icon: <ExternalLink aria-hidden="true" />,
                          onSelect: () => onOpen(resource.sourcePageUrl as string),
                        },
                      ]
                    : []),
                  {
                    id: "copy",
                    label: "Copy link",
                    icon: <Copy aria-hidden="true" />,
                    onSelect: () =>
                      void navigator.clipboard?.writeText(
                        resource.sourcePageUrl ?? resource.url,
                      ),
                  },
                  {
                    id: "read",
                    label: unreadIds.has(resource.id) ? "Mark as read" : "Mark as unread",
                    icon: <MailOpen aria-hidden="true" />,
                    onSelect: () => onToggleRead(resource),
                  },
                ]}
              />
            ))}
          </div>
        ))
      )}

      {baselineCount > 0 && (
        <p className="baseline-note">
          First scan recorded {baselineCount.toLocaleString()}{" "}
          {baselineCount === 1 ? "file" : "files"} as known
        </p>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear activity?"
        body="This clears the activity list and History for your monitored courses. Course resources will remain unchanged."
        confirmLabel="Clear activity"
        destructive
        onConfirm={onClearActivity}
      />
    </div>
  );
}
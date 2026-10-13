import Summary from "../components/Summary";
import Filters from "../components/Filters";
import ResourceList from "../components/ResourceList";
import PageHeader from "../components/PageHeader";
import ClearActivityButton from "../components/ClearActivityButton";
import { filterResources, groupByDate, matchesKind, type FeedKind } from "../lib/filter";
import { parseTimestamp } from "../lib/format";
import type { Course, Resource } from "../lib/types";

interface Props {
  resources: Resource[];
  hasStoredResources: boolean;
  courses: Course[];
  eventKinds: Map<number, Set<string>>;
  kind: FeedKind;
  onKind: (k: FeedKind) => void;
  courseId: number | null;
  onCourse: (id: number | null) => void;
  search: string;
  onSearch: (s: string) => void;
  onOpen: (url: string) => void;
  onClearAll: () => Promise<void>;
}

export default function Dashboard({
  resources,
  hasStoredResources,
  courses,
  eventKinds,
  kind,
  onKind,
  courseId,
  onCourse,
  search,
  onSearch,
  onOpen,
  onClearAll,
}: Props) {
  const now = Date.now();
  const deadlineCount = resources.filter(
    (r) => r.dueAt && (parseTimestamp(r.dueAt)?.getTime() ?? 0) > now,
  ).length;
  const unavailableCount = resources.filter((r) => r.availabilityStatus !== "available").length;
  // Counts come from the same canonical change events (via `eventKinds`) that
  // drive the activity list below, so the number always equals the rows the
  // matching filter shows — never a scan-relative total.
  const newCount = resources.filter((r) => matchesKind(r, "new", eventKinds)).length;
  const updatedCount = resources.filter((r) => matchesKind(r, "updated", eventKinds)).length;
  const courseCount = courses.filter((c) => c.monitoringStatus === "monitored").length;

  const filtered = filterResources(resources, { kind, courseId, search, eventKinds });
  const groups = groupByDate(filtered);
  let emptyMessage = "Nothing matches these filters.";
  if (resources.length === 0) {
    if (!hasStoredResources) emptyMessage = "No resources yet. Run a sync to discover your courses.";
    else if (kind === "all" && courseId == null && search.trim() === "") {
      emptyMessage = "No current Dashboard activity. New activity will appear here after a sync.";
    }
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Recent activity across your monitored courses"
      >
        <ClearActivityButton scope="Dashboard" onConfirm={onClearAll} />
      </PageHeader>
      <Summary
        newCount={newCount}
        updatedCount={updatedCount}
        deadlineCount={deadlineCount}
        unavailableCount={unavailableCount}
        courseCount={courseCount}
      />
      <Filters
        kind={kind}
        onKind={onKind}
        courses={courses}
        courseId={courseId}
        onCourse={onCourse}
        search={search}
        onSearch={onSearch}
      />
      <ResourceList
        groups={groups}
        eventKinds={eventKinds}
        onOpen={onOpen}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}

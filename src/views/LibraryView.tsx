import { EmptyState } from "../components/ui/EmptyState";
import { useSessionScroll, useSessionValue } from "../hooks/useSessionViews";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownUp, ListFilter, X } from "lucide-react";
import { Button } from "../components/ui/Button";
import { useCourseActivity } from "../hooks/useCourseActivity";
import PreviewDialog from "../components/PreviewDialog";
import { SearchField } from "../components/ui/SearchField";
import { ToggleGroup } from "../components/ui/ToggleGroup";
import type { ChangeEvent, Course, Resource } from "../lib/types";
import type { SearchQueryState, SearchScope } from "../lib/desktopSearch";
import type { DetailsAdapter } from "../lib/details";
import { Banner } from "../components/ui/Banner";
import { Skeleton } from "../components/ui/Skeleton";
import AllFiles from "./library/AllFiles";
import CourseList from "./library/CourseList";
import CoursePage from "./library/CoursePage";
import { LibraryFooter, LibraryHeader } from "./library/LibraryFrame";
import { splitCourseAttention } from "../lib/courseLibrary";
import { cx } from "../lib/cx";

export interface LibraryViewProps {
  courses: Course[];
  resources: Resource[];
  /** The course page to show, or null for the course list. */
  courseId: number | null;
  /** Section path the breadcrumb opened at, or null for the course root. */
  folderPath: string[] | null;
  /** The one navigation entry point: a course (or null for the list). */
  onNavigate: (courseId: number | null, folderPath?: string[] | null) => void;
  onChanged: () => void | Promise<void>;
  /** Independent complete course Activity publication; owner may be retained. */
  activityEvents?: ChangeEvent[];
  activityCourseId?: number;
  activityPending?: boolean;
  activityError?: string | null;
  activityScopeReady?: boolean;
  onActivityChanged?: () => Promise<void>;
  onOpen: (url: string) => void;
  /** Empty-state "Sync now" buttons; wired to the app's sync action. */
  onSyncNow?: () => void;
  /** courseId -> unread change count, for the course list badges. */
  unreadByCourse?: Map<number, number> | null;
  details?: DetailsAdapter;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  timeZone?: string;
  initialSearch?: string;
  initialSearchQuery?: SearchQueryState;
  /** Distinguishes repeated palette requests with the same query. */
  initialSearchKey?: number;
  onSeeAllFiles?: (raw: string, options?: { scope?: SearchScope; sourceFrom?: string | null; sourceThrough?: string | null }) => void;
  headerActions?: ReactNode;
  compact?: boolean;
  unreadResourceIds?: ReadonlySet<number>;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** Library: the course hub, one course's page, and the flat all-files table. */
export default function LibraryView({
  courses,
  resources,
  courseId,
  folderPath,
  onNavigate,
  onChanged,
  onActivityChanged,
  onOpen,
  onSyncNow,
  unreadByCourse,
  details,
  loading = false,
  error = null,
  onRetry,
  initialSearch, timeZone,
  initialSearchQuery,
  initialSearchKey = 0,
  onSeeAllFiles,
  headerActions,
  compact = false,
  unreadResourceIds,
}: LibraryViewProps) {
  // The Courses | All files choice survives navigating into a course page.
  const [tab, setTab] = useSessionValue<"courses" | "files">("library:tab", "courses");
  const searchRef = useRef<HTMLInputElement>(null);
  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current !== tab) details?.clear();
    previousTab.current = tab;
  }, [tab, details]);
  const [search, setSearch] = useSessionValue("library:query", "");
  const [showCourseFilter, setShowCourseFilter] = useState(false);
  const [courseSort, setCourseSort] = useSessionValue<"original" | "name">("library:course-sort", "original");
  const [appliedSearch, setAppliedSearch] = useSessionValue<string | undefined>("library:applied-search", undefined);
  const requestedRaw = initialSearchQuery?.raw ?? initialSearch;
  const searchRequest = JSON.stringify([initialSearchKey, initialSearchQuery?.requestId, requestedRaw]);
  useEffect(() => {
    if (requestedRaw !== undefined && searchRequest !== appliedSearch) {
      setTab("files");
      setSearch(requestedRaw);
      setAppliedSearch(searchRequest);
    }
  }, [requestedRaw, searchRequest, appliedSearch, setAppliedSearch, setSearch, setTab]);
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);
  const activity = useCourseActivity(courseId);
  const { refresh: refreshActivityPublication, ...activityPublication } = activity;
  // A mutation retry must refresh the Activity publication and App collections
  // together; failure of either rejects so the view never claims success.
  const handleActivityChanged = useCallback(async () => {
    await Promise.all([refreshActivityPublication(), onActivityChanged?.()]);
  }, [refreshActivityPublication, onActivityChanged]);

  const course = courseId == null ? null : courses.find((c) => c.id === courseId) ?? null;

  const mainScroll = useRef<HTMLDivElement>(null);
  useSessionScroll(`library:${tab}`, mainScroll, !course && (!loading || resources.length > 0 || courses.length > 0));

  if (courseId != null && !course && !loading && !error) return <div className="library-panel"><EmptyState title="Course unavailable" body="This course is no longer in the local inventory." /><Button onClick={() => onNavigate(null)}>Back to Library</Button></div>;

  if (course) {
    return (
      <>
        <CoursePage
          key={course.id}
          course={course}
          inventory={resources}
          inventoryPending={loading}
          inventoryError={error}
          folderPath={folderPath}
          onOpen={onOpen}
          onPreview={setPreviewResource}
          onChanged={onChanged}
          sidebarNavigation
          headerActions={headerActions}
          compact={compact}
          activityEvents={activityPublication.items}
          activityCourseId={activityPublication.courseId}
          activityPending={activityPublication.pending}
          activityError={activityPublication.error}
          activityScopeReady={activityPublication.scopeReady}
          onActivityChanged={handleActivityChanged}
          onSyncNow={onSyncNow}
          details={details}
          onNavigate={onNavigate}
          searchCourses={courses}
          searchUnreadIds={unreadResourceIds}
          timeZone={timeZone}
          onSeeAllFiles={onSeeAllFiles}
        />
        <PreviewDialog
          resource={previewResource}
          open={previewResource !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewResource(null);
          }}
          onOpen={onOpen}
        />
      </>
    );
  }

  return (
    <div className={cx("library-panel", details?.selected && "has-library-inspector")}>
      <LibraryHeader
        title="Library"
        actions={headerActions}
        tabs={
          <ToggleGroup
            className="library-tabs"
            value={tab}
            onValueChange={(value) => setTab(value as "courses" | "files")}
            ariaLabel="Library view"
            options={[
              { value: "courses", label: "Courses" },
              { value: "files", label: "All files" },
            ]}
          />
        }
      />
      <div className="library-panel-scroll" ref={mainScroll}>
        {error && (
          <Banner kind="error" action={onRetry ? { label: "Retry", onClick: onRetry } : undefined}>
            {error}
          </Banner>
        )}
        {loading && courses.length === 0 && resources.length === 0 ? (
          <Skeleton rows={8} />
        ) : error && courses.length === 0 && resources.length === 0 ? null : tab === "courses" ? (
          <>
            <div className="library-toolbar">
              <Button variant="ghost" size="sm" leadingIcon={<ListFilter aria-hidden="true" />} aria-expanded={showCourseFilter} onClick={() => setShowCourseFilter((open) => !open)}>Filter</Button>
              {search && <Button variant="secondary" size="sm" trailingIcon={<X aria-hidden="true" />} onClick={() => setSearch("")}>Search “{search}”</Button>}
              <Button className="library-toolbar-end" variant="ghost" size="sm" leadingIcon={<ArrowDownUp aria-hidden="true" />} aria-pressed={courseSort === "name"} onClick={() => setCourseSort((value) => value === "name" ? "original" : "name")}>Sort</Button>
            </div>
            <div className={showCourseFilter ? "library-course-search" : "library-course-search library-search-collapsed"}>
              <SearchField inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search courses" label="Search library" debounceMs={0} />
            </div>
            <CourseList
              onFocusSearch={() => { setShowCourseFilter(true); searchRef.current?.focus(); }}
              courses={courses}
              resources={resources}
              search={search}
              unreadByCourse={unreadByCourse}
              onOpenCourse={(selected) => onNavigate(selected.id)}
              onOpen={onOpen}
              onChanged={onChanged}
              onSyncNow={onSyncNow}
              alphabetical={courseSort === "name"}
            />
          </>
        ) : (
          <AllFiles
            onChanged={onChanged}
            onFocusSearch={() => searchRef.current?.focus()}
            inventoryPending={loading}
            inventoryError={error}
            resources={resources}
            courses={courses}
            search={search}
            searchField={<SearchField inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search files" label="Search library" debounceMs={0} />}
            onOpen={onOpen}
            onPreview={setPreviewResource}
            details={details}
            initialSearchQuery={initialSearchQuery}
            onSearchChange={setSearch}
            timeZone={timeZone}
            unreadResourceIds={unreadResourceIds}
            onCourse={(id) => onNavigate(id)}
            onClearSearch={() => setSearch("")}
          />
        )}
      </div>
      {tab === "courses" && <LibraryFooter>{plural(courses.length, "course")} · {splitCourseAttention(courses).attention.length.toLocaleString()} needs attention</LibraryFooter>}

      <PreviewDialog
        resource={previewResource}
        open={previewResource !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewResource(null);
        }}
        onOpen={onOpen}
      />
    </div>
  );
}

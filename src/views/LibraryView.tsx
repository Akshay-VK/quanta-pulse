import { useSessionScroll, useSessionValue } from "../hooks/useSessionViews";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCourseActivity } from "../hooks/useCourseActivity";
import PageHeader from "../components/PageHeader";
import PreviewDialog from "../components/PreviewDialog";
import { SearchField } from "../components/ui/SearchField";
import { ToggleGroup } from "../components/ui/ToggleGroup";
import type { ChangeEvent, Course, Resource } from "../lib/types";
import type { DetailsAdapter } from "../lib/details";
import { Banner } from "../components/ui/Banner";
import { Skeleton } from "../components/ui/Skeleton";
import AllFiles from "./library/AllFiles";
import CourseList from "./library/CourseList";
import CoursePage from "./library/CoursePage";

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
  initialSearch?: string;
  /** Distinguishes repeated palette requests with the same query. */
  initialSearchKey?: number;
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
  initialSearch,
  initialSearchKey = 0,
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
  const [appliedSearch, setAppliedSearch] = useSessionValue<string | undefined>("library:applied-search", undefined);
  const searchRequest = JSON.stringify([initialSearchKey, initialSearch]);
  useEffect(() => {
    if (initialSearch !== undefined && searchRequest !== appliedSearch) {
      setTab("files");
      setSearch(initialSearch);
      setAppliedSearch(searchRequest);
    }
  }, [initialSearch, searchRequest, appliedSearch, setAppliedSearch, setSearch, setTab]);
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);
  const activity = useCourseActivity(courseId);
  const { refresh: refreshActivityPublication, ...activityPublication } = activity;
  // A mutation retry must refresh the Activity publication and App collections
  // together; failure of either rejects so the view never claims success.
  const handleActivityChanged = useCallback(async () => {
    await Promise.all([refreshActivityPublication(), onActivityChanged?.()]);
  }, [refreshActivityPublication, onActivityChanged]);

  const course = courseId == null ? null : courses.find((c) => c.id === courseId) ?? null;

  const mainScroll = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { mainScroll.current = document.querySelector("main"); }, []);
  useSessionScroll(`library:${tab}`, mainScroll, !course && (!loading || resources.length > 0 || courses.length > 0));

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
          activityEvents={activityPublication.items}
          activityCourseId={activityPublication.courseId}
          activityPending={activityPublication.pending}
          activityError={activityPublication.error}
          activityScopeReady={activityPublication.scopeReady}
          onActivityChanged={handleActivityChanged}
          onSyncNow={onSyncNow}
          details={details}
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
    <div>
      <PageHeader
        title="Library"
        summary={`${plural(courses.length, "course")}, ${plural(resources.length, "file")}`}
        actions={
          <div className="library-head-row">
            <ToggleGroup
              value={tab}
              onValueChange={(value) => setTab(value as "courses" | "files")}
              ariaLabel="Library view"
              options={[
                { value: "courses", label: "Courses" },
                { value: "files", label: "All files" },
              ]}
            />
            <SearchField
              inputRef={searchRef}
              value={search}
              onChange={setSearch}
              placeholder="Search…"
              label="Search library"
              debounceMs={0}
            />
          </div>
        }
      />
      {error && (
        <Banner kind="error" action={onRetry ? { label: "Retry", onClick: onRetry } : undefined}>
          {error}
        </Banner>
      )}
      {loading && courses.length === 0 && resources.length === 0 ? (
        <Skeleton rows={8} />
      ) : error && courses.length === 0 && resources.length === 0 ? null : tab === "courses" ? (
        <CourseList
          onFocusSearch={() => searchRef.current?.focus()}
          courses={courses}
          resources={resources}
          search={search}
          unreadByCourse={unreadByCourse}
          onOpenCourse={(selected) => onNavigate(selected.id)}
          onOpen={onOpen}
          onChanged={onChanged}
          onSyncNow={onSyncNow}
        />
      ) : (
        <AllFiles
          onChanged={onChanged}
          onFocusSearch={() => searchRef.current?.focus()}
          inventoryPending={loading}
          inventoryError={error}
          resources={resources}
          courses={courses}
          search={search}
          onOpen={onOpen}
          onPreview={setPreviewResource}
          details={details}
          onCourse={(id) => onNavigate(id)}
          onClearSearch={() => setSearch("")}
        />
      )}

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

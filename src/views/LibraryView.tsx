import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import PreviewDialog from "../components/PreviewDialog";
import { SearchField } from "../components/ui/SearchField";
import { ToggleGroup } from "../components/ui/ToggleGroup";
import type { Course, Resource } from "../lib/types";
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
  onChanged: () => void;
  onOpen: (url: string) => void;
  /** Empty-state "Sync now" buttons; wired to the app's sync action. */
  onSyncNow?: () => void;
  /** courseId -> unread change count, for the course list badges. */
  unreadByCourse?: Map<number, number> | null;
  details?: DetailsAdapter;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** Library: the course hub, one course's page, and the flat all-files table. */
export default function LibraryView({
  courses,
  resources,
  courseId,
  onNavigate,
  onChanged,
  onOpen,
  onSyncNow,
  unreadByCourse,
  details,
  loading = false,
  error = null,
  onRetry,
}: LibraryViewProps) {
  // The Courses | All files choice survives navigating into a course page.
  const [tab, setTab] = useState<"courses" | "files">(courseId == null ? "courses" : "files");
  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current !== tab) details?.clear();
    previousTab.current = tab;
  }, [tab, details]);
  const [search, setSearch] = useState("");
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);

  const course = courseId == null ? null : courses.find((c) => c.id === courseId) ?? null;

  if (course) {
    return (
      <>
        <CoursePage
          course={course}
          onOpen={onOpen}
          onPreview={setPreviewResource}
          onChanged={onChanged}
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
              value={search}
              onChange={setSearch}
              placeholder="Search…"
              label="Search library"
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
          resources={resources}
          courses={courses}
          search={search}
          onOpen={onOpen}
          onPreview={setPreviewResource}
          details={details}
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

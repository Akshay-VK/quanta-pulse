import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatCompact, relativeLabel } from "../lib/format";
import type { Course, Resource, SyncStatus } from "../lib/types";
import PageHeader from "../components/PageHeader";
import CourseLibrary from "../components/CourseLibrary";

interface Props {
  courses: Course[];
  resources: Resource[];
  sync: SyncStatus | null;
  onChanged: () => void;
  onOpen: (url: string) => void;
}

interface LibraryState {
  loading: boolean;
  error: string | null;
  items: Resource[] | null;
}

/** The course's real Quanta homepage URL, when it is a usable http(s) link. */
function courseHomeUrl(course: Course): string | null {
  const raw = course.url?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The course hub: every monitored course expands to an internal, searchable
 * resource library. Course names open the library; a separate control links to
 * the real Quanta course homepage.
 */
export default function CoursesView({ courses, resources, sync, onChanged, onOpen }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [libs, setLibs] = useState<Record<number, LibraryState>>({});

  const load = useCallback(async (courseId: number) => {
    setLibs((prev) => ({
      ...prev,
      [courseId]: { loading: true, error: null, items: prev[courseId]?.items ?? null },
    }));
    try {
      // A course is capped at 2000 discovered resources in the backend, so this
      // returns the complete library for the course.
      const items = await api.listResources({ courseId, limit: 2000 });
      setLibs((prev) => ({ ...prev, [courseId]: { loading: false, error: null, items } }));
    } catch (err) {
      setLibs((prev) => ({
        ...prev,
        [courseId]: {
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          items: null,
        },
      }));
    }
  }, []);

  const toggle = useCallback(
    (course: Course) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(course.id)) {
          next.delete(course.id);
        } else {
          next.add(course.id);
          void load(course.id);
        }
        return next;
      });
    },
    [load],
  );

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // The App replaces the `resources` array after every sync / auth change. That
  // identity change means "data changed", so re-fetch any open library and let
  // new monitoring results appear without a manual reopen.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    for (const id of expandedRef.current) void load(id);
  }, [resources, load]);

  async function setMonitoring(course: Course) {
    const next = course.monitoringStatus === "paused" ? "monitored" : "paused";
    await api.setMonitoring(course.id, next);
    onChanged();
  }

  async function rebaseline(course: Course) {
    const ok = window.confirm(
      `Re-baseline "${course.name}"? Existing history is kept, but current content ` +
        `will be treated as the new starting point.`,
    );
    if (!ok) return;
    await api.rebuildBaseline(course.id);
    onChanged();
  }

  if (courses.length === 0) {
    return (
      <div>
        <PageHeader title="Courses" subtitle="0 courses monitored" />
        <div className="empty">No courses discovered yet.</div>
      </div>
    );
  }

  const paused = courses.filter((c) => c.monitoringStatus === "paused").length;

  return (
    <div>
      <PageHeader
        title="Courses"
        subtitle={`${courses.length} monitored · ${paused} paused`}
      />

      <div className="course-list">
        {courses.map((course) => {
          const isOpen = expanded.has(course.id);
          const state = libs[course.id] ?? { loading: false, error: null, items: null };
          const isPaused = course.monitoringStatus === "paused";
          const home = courseHomeUrl(course);

          return (
            <article className={`course-card${isOpen ? " open" : ""}`} key={course.id}>
              <div className="course-head">
                <button
                  type="button"
                  className="course-title-btn"
                  aria-expanded={isOpen}
                  onClick={() => toggle(course)}
                  title="Open the in-app resource library for this course"
                >
                  <span className={`caret${isOpen ? " open" : ""}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="course-name">{course.name}</span>
                  {course.shortName && <span className="label course-code">{course.shortName}</span>}
                </button>

                <div className="course-stats">
                  <span className="mono num">{course.resourceCount} resources</span>
                  <span className="sep">·</span>
                  <span>
                    {course.lastScannedAt
                      ? `scanned ${formatCompact(course.lastScannedAt)}`
                      : "never scanned"}
                  </span>
                  {course.lastScannedAt && (
                    <span className="faint small">{relativeLabel(course.lastScannedAt)}</span>
                  )}
                  <span className="sep">·</span>
                  {isPaused ? (
                    <span className="status-text text-warn">
                      <span className="dot" />
                      Paused
                    </span>
                  ) : (
                    <span className="status-text text-ok">
                      <span className="dot" />
                      Monitoring
                    </span>
                  )}
                  {course.lastScanStatus && course.lastScanStatus !== "ok" && (
                    <span className="status-text text-danger">
                      <span className="dot" />
                      {course.lastScanStatus}
                    </span>
                  )}
                </div>

                <div className="course-controls">
                  <button className="btn-link" onClick={() => void setMonitoring(course)}>
                    {isPaused ? "Resume" : "Pause"}
                  </button>
                  <button className="btn-link" onClick={() => void rebaseline(course)}>
                    Re-baseline
                  </button>
                  {home ? (
                    <button
                      className="btn-link"
                      onClick={() => onOpen(home)}
                      title={`Open the Quanta course homepage (${home}) in your browser`}
                    >
                      Open Quanta Course <span aria-hidden="true">↗</span>
                    </button>
                  ) : (
                    <span className="faint small" title="No course homepage URL was discovered">
                      Open Quanta Course unavailable
                    </span>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="course-body">
                  <nav className="breadcrumb" aria-label="Breadcrumb">
                    <button type="button" className="btn-link" onClick={() => toggle(course)}>
                      Courses
                    </button>
                    <span className="sep">/</span>
                    <span>{course.name}</span>
                  </nav>
                  <CourseLibrary
                    course={course}
                    resources={state.items ?? []}
                    loading={state.loading}
                    error={state.error}
                    onRetry={() => void load(course.id)}
                    onOpen={onOpen}
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="hint">
        Monitoring status for the whole app:{" "}
        <span className={sync?.authState === "authenticated" ? "text-ok" : "text-danger"}>
          {sync?.authState === "authenticated" ? "active" : sync?.authState ?? "unknown"}
        </span>
        . A course name opens its in-app resource library; “Open Quanta Course” opens the
        original homepage in your browser.
      </p>
    </div>
  );
}

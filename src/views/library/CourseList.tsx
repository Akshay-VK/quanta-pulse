import { useMemo, useState } from "react";
import {
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
} from "lucide-react";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { activityTimestamp } from "../../lib/filter";
import { parseTimestamp, relativeLabel } from "../../lib/format";
import {
  courseLabel,
  courseTitle,
  loadAliases,
  saveAliases,
} from "../../lib/courseName";
import type { Course, Resource } from "../../lib/types";
import { courseDotClass } from "../../components/ui/CoursePill";
import { IconButton } from "../../components/ui/IconButton";
import { Menu, type MenuItemSpec } from "../../components/ui/Menu";
import { EmptyState } from "../../components/ui/EmptyState";
import ConfirmDialog from "../../components/ConfirmDialog";
import { courseHomeUrl } from "./courseUrl";

interface CourseListProps {
  courses: Course[];
  resources: Resource[];
  search?: string;
  /** courseId -> unread change count, for the row badges. */
  unreadByCourse?: Map<number, number> | null;
  onOpenCourse: (course: Course) => void;
  onOpen: (url: string) => void;
  onChanged: () => void;
  onSyncNow?: () => void;
}

type Status = { kind: "ok" | "warn" | "error"; label: string };

function courseStatus(course: Course): Status {
  if (course.monitoringStatus === "paused") return { kind: "warn", label: "Paused" };
  if (course.lastScanStatus && course.lastScanStatus !== "ok") {
    return { kind: "error", label: "Last scan failed" };
  }
  return { kind: "ok", label: "Monitoring" };
}

/** The course hub: one row per monitored course, opening its in-app library. */
export default function CourseList({
  courses,
  resources,
  search = "",
  unreadByCourse,
  onOpenCourse,
  onOpen,
  onChanged,
  onSyncNow,
}: CourseListProps) {
  const [confirmCourse, setConfirmCourse] = useState<Course | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<Course | null>(null);

  const lastChangeByCourse = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of resources) {
      if (r.courseId == null) continue;
      const at = activityTimestamp(r);
      if (!at) continue;
      const prev = map.get(r.courseId);
      if (!prev || (parseTimestamp(at)?.getTime() ?? 0) > (parseTimestamp(prev)?.getTime() ?? 0)) {
        map.set(r.courseId, at);
      }
    }
    return map;
  }, [resources]);

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? courses.filter((course) => {
        const label = courseLabel(course.id);
        return `${label?.name ?? ""} ${course.name} ${course.shortName ?? ""} ${course.externalCourseId}`
          .toLowerCase()
          .includes(needle);
      })
    : courses;

  async function setMonitoring(course: Course) {
    setBusyId(course.id);
    try {
      const next = course.monitoringStatus === "paused" ? "monitored" : "paused";
      await api.setMonitoring(course.id, next);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  function commitRename() {
    if (!renaming) return;
    const value = renaming.shortName?.trim() ?? "";
    const aliases = loadAliases();
    if (value) aliases[String(renaming.id)] = value;
    else delete aliases[String(renaming.id)];
    saveAliases(aliases);
    setRenaming(null);
    // Display names come from the shared registry; rebuild it in place.
    onChanged();
  }

  function courseMenu(course: Course): MenuItemSpec[] {
    const paused = course.monitoringStatus === "paused";
    const items: MenuItemSpec[] = [
      {
        id: "monitor",
        label: paused ? "Resume monitoring" : "Pause monitoring",
        icon: paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />,
        onSelect: () => void setMonitoring(course),
      },
      {
        id: "rename",
        label: "Rename…",
        icon: <Pencil aria-hidden="true" />,
        onSelect: () => setRenaming(course),
      },
      {
        id: "rebaseline",
        label: "Re-baseline course…",
        icon: <RotateCcw aria-hidden="true" />,
        onSelect: () => setConfirmCourse(course),
      },
    ];
    const home = courseHomeUrl(course);
    if (home) {
      items.push({
        id: "open",
        label: "Open Quanta course",
        icon: <ExternalLink aria-hidden="true" />,
        onSelect: () => onOpen(home),
      });
    }
    return items;
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        title="No courses found"
        body="Pulse discovers your courses on the first scan"
        action={onSyncNow ? { label: "Sync now", onClick: onSyncNow } : undefined}
      />
    );
  }

  return (
    <>
      <div>
        {visible.map((course) => {
          const status = courseStatus(course);
          const lastChange = lastChangeByCourse.get(course.id);
          const unread = unreadByCourse?.get(course.id) ?? 0;
          const label = courseLabel(course.id);
          const display = courseTitle(course.id, course.name);
          const raw = label?.raw ?? course.name;
          const showRaw = raw !== display;
          return (
            <div className="course-row" key={course.id}>
              {/* One button for the whole row; the menu stays outside it so no
                  interactive element is nested inside another. */}
              <button
                type="button"
                className="course-row-main"
                onClick={() => onOpenCourse(course)}
                aria-label={`Open ${display} library`}
              >
                <span
                  className={cx("course-dot", courseDotClass(course.id))}
                  aria-hidden="true"
                />
                <span className="course-row-copy">
                  <span className="course-row-name" title={raw}>
                    {display}
                  </span>
                  {showRaw && <span className="course-row-code">{raw}</span>}
                </span>
                <span className="course-row-stat" title={`${course.resourceCount} files`}>
                  {course.resourceCount} files
                </span>
                {unread > 0 && (
                  <span className="course-row-new">{unread} new</span>
                )}
                <span className="course-row-last">
                  {lastChange ? relativeLabel(lastChange) : "No activity yet"}
                </span>
                <span className={cx("status-pill", status.kind)}>
                  <span className="s-dot" aria-hidden="true" />
                  {status.label}
                </span>
                <ChevronRight className="course-row-chevron" aria-hidden="true" />
              </button>
              <div className="course-row-actions">
                <Menu
                  label={`Actions for ${display}`}
                  items={courseMenu(course)}
                  trigger={
                    <IconButton
                      label={`Actions for ${display}`}
                      size={28}
                      tooltip={false}
                      disabled={busyId === course.id}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </IconButton>
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title="Rename course"
        body={
          <>
            <label className="setting-desc" htmlFor="course-alias-input">
              Shown everywhere in place of the course code. Leave empty to restore the
              default.
            </label>
            <input
              id="course-alias-input"
              className="text-field"
              value={renaming?.shortName ?? ""}
              autoFocus
              onChange={(e) =>
                setRenaming((current) =>
                  current ? { ...current, shortName: e.target.value } : current,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
              }}
            />
          </>
        }
        confirmLabel="Save"
        onConfirm={commitRename}
      />

      <ConfirmDialog
        open={confirmCourse !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmCourse(null);
        }}
        title="Re-baseline course?"
        body={
          <>
            Existing history is kept, but everything currently in{" "}
            <strong>{confirmCourse?.name}</strong> will be treated as the new starting
            point, so it will not surface as new changes.
          </>
        }
        confirmLabel="Re-baseline"
        destructive
        onConfirm={async () => {
          if (!confirmCourse) return;
          await api.rebuildBaseline(confirmCourse.id);
          onChanged();
        }}
      />
    </>
  );
}
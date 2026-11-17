import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { splitCourseAttention } from "../../lib/courseLibrary";
import { cx } from "../../lib/cx";
import { activityTimestamp } from "../../lib/filter";
import { parseTimestamp, relativeLabel } from "../../lib/format";
import {
  courseLabel,
  courseTitle,
  loadAliases,
  saveAliases,
} from "../../lib/courseName";
import { getListNavigationIntent, recoverFocusedId } from "../../lib/listNavigation";
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
  onFocusSearch?: () => void;
}

type Status = { kind: "ok" | "warn" | "error"; label: string };

function courseStatus(course: Course): Status {
  if (course.monitoringStatus === "paused") return { kind: "warn", label: "Paused" };
  if (course.lastScanStatus && course.lastScanStatus !== "ok") {
    return { kind: "error", label: "Error" };
  }
  return { kind: "ok", label: "Active" };
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
  onFocusSearch,
}: CourseListProps) {
  const [confirmCourse, setConfirmCourse] = useState<Course | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<Course | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const previousIds = useRef<string[]>([]);
  const focusedId = useRef<string | null>(null);
  const focusedButton = useRef<HTMLButtonElement | null>(null);
  const ownedFocus = useRef(false);

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
  const { attention, rest } = splitCourseAttention(visible);
  const ordered = attention.length ? [...attention, ...rest] : visible;

  const ids = ordered.map((course) => `course:${course.id}`);
  const overlayOpen = () => Boolean(document.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sidebar-drawer',
  ));

  function focusCourse(id: string) {
    const button = buttons.current.get(id);
    if (!button?.isConnected) return;
    button.focus();
    button.scrollIntoView({ block: "nearest" });
  }

  // Run before the empty-state return too: removal can leave no primary button.
  // A disconnected former owner is distinct from focus moved to another surface.
  useLayoutEffect(() => {
    const changed = previousIds.current.join("\0") !== ids.join("\0");
    const next = recoverFocusedId(previousIds.current, ids, focusedId.current);
    const active = document.activeElement;
    const ownsActive = active === focusedButton.current ||
      (active === document.body && focusedButton.current !== null && !focusedButton.current.isConnected);
    previousIds.current = ids;
    focusedId.current = next;
    if (!changed) return;
    if (!ownedFocus.current || !ownsActive || overlayOpen()) {
      ownedFocus.current = false;
      return;
    }
    if (next) focusCourse(next);
    else {
      ownedFocus.current = false;
      onFocusSearch?.();
    }
  });

  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const intent = getListNavigationIntent({
      ids, focusedId: id, inspectedId: null, selectedIds: [], completeEventIds: [],
      key: event.key,
      activeSurface: event.currentTarget.isConnected && document.activeElement === event.currentTarget,
      nestedControl: event.target !== event.currentTarget,
      editableTarget: event.currentTarget.isContentEditable,
      modalOpen: overlayOpen(),
      isComposing: event.nativeEvent.isComposing,
      imeKeyCode229: event.keyCode === 229,
      repeat: event.repeat, defaultPrevented: event.defaultPrevented,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
    });
    // Course buttons retain their own native activation and every native Tab stop.
    if (intent?.type !== "focus") return;
    event.preventDefault();
    event.stopPropagation();
    focusCourse(intent.id);
  }

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

  if (ordered.length === 0) {
    return (
      <EmptyState
        title="No courses found"
        body="Pulse discovers your courses on the first scan"
        action={onSyncNow ? { label: "Sync now", onClick: onSyncNow } : undefined}
      />
    );
  }

  const renderCourse = (course: Course) => {
    const status = courseStatus(course);
    const lastChange = lastChangeByCourse.get(course.id);
    const unread = unreadByCourse?.get(course.id) ?? 0;
    const label = courseLabel(course.id);
    const display = courseTitle(course.id, course.name);
    const raw = label?.raw ?? course.name;
    return (
      <div className="course-row" key={course.id}>
        <button
          type="button"
          className="course-row-main"
          ref={(button) => {
            const id = `course:${course.id}`;
            if (button) buttons.current.set(id, button);
            else buttons.current.delete(id);
          }}
          onFocus={(event) => {
            focusedId.current = `course:${course.id}`;
            focusedButton.current = event.currentTarget;
            ownedFocus.current = true;
          }}
          onBlur={() => { ownedFocus.current = false; }}
          onKeyDown={(event) => navigate(event, `course:${course.id}`)}
          onClick={() => onOpenCourse(course)}
          aria-label={`Open ${display} library`}
        >
          <span className={cx("course-dot", courseDotClass(course.id))} aria-hidden="true" />
          <span className="course-row-code mono">{course.shortName ?? course.externalCourseId}</span>
          <span className="course-row-copy">
            <span className="course-row-name" title={raw}>{display}</span>
          </span>
          <span className="course-row-unread">{unread > 0 ? `${unread}` : "—"}</span>
          <span className="course-row-last mono">
            {lastChange ? relativeLabel(lastChange) : "—"}
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
              <IconButton label={`Actions for ${display}`} size={28} tooltip={false} disabled={busyId === course.id}>
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
            }
          />
        </div>
      </div>
    );
  };

  return (
    <>
      <div>
        {attention.length > 0 && (
          <div className="course-attention-group">
            <div className="group-header course-attention-header">Needs attention</div>
            {attention.map(renderCourse)}
          </div>
        )}
        {rest.map(renderCourse)}
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

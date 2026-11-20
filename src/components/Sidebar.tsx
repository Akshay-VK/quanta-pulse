import {
  ChevronDown,
  Clock,
  Calendar,
  Folder,
  Inbox,
  PanelLeftOpen,
  Pause,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cx } from "../lib/cx";
import { NAV, type ViewId } from "../lib/nav";
import { courseDotClass } from "./ui/CoursePill";
import { IconButton } from "./ui/IconButton";
import { courseLabel } from "../lib/courseName";
import { formatShortcut } from "../lib/platform";
import { Tooltip } from "./ui/Tooltip";
import SyncStatus from "./SyncStatus";
import SyncButton from "./SyncButton";
import type { Course, SyncStatus as SyncStatusModel } from "../lib/types";

const NAV_ICON: Record<ViewId, ReactNode> = {
  today: <Inbox aria-hidden="true" />,
  calendar: <Calendar aria-hidden="true" />,
  library: <Folder aria-hidden="true" />,
  history: <Clock aria-hidden="true" />,
  settings: <SlidersHorizontal aria-hidden="true" />,
};

function NavItem({
  icon,
  label,
  active,
  badge,
  collapsed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: number | "–";
  collapsed: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      className="nav-item"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {(badge === "–" || (badge ?? 0) > 0) && (
        <span className="nav-badge">{typeof badge === "number" && badge > 99 ? "99+" : badge}</span>
      )}
    </button>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/**
 * A sidebar course entry. It is a real navigation target: clicking it opens
 * the course page from any view, so it is never a toggle.
 */
function CourseNavItem({
  course,
  unread,
  active,
  collapsed,
  onSelect,
}: {
  course: Course;
  unread: number | "–";
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const paused = course.monitoringStatus !== "monitored";
  const label = courseLabel(course.id);
  const text = label?.name ?? course.shortName ?? course.name;
  const button = (
    <button
      type="button"
      className={cx("course-nav-item", paused && "paused")}
      aria-current={active ? "page" : undefined}
      title={label?.raw ?? course.name}
      onClick={onSelect}
    >
      {paused ? (
        <Pause className="course-warn" aria-hidden="true" />
      ) : (
        <span className={cx("course-dot", courseDotClass(course.id))} aria-hidden="true" />
      )}
      <span className="course-nav-code">{text}</span>
      {(unread === "–" || unread > 0) && <span className="course-nav-count">{unread}</span>}
    </button>
  );
  return collapsed ? (
    <Tooltip content={text} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/** The primary sidebar: brand, palette trigger, nav, courses and the sync block. */
export default function Sidebar({
  view,
  onView,
  courses,
  unreadByCourse,
  unreadTotal,
  activeCourseId,
  onCourse,
  sync,
  onSync,
  onOpenScans,
  onOpenPalette,
  collapsed,
  onToggle,
  overlay = false,
  sessionExpired,
  appearanceActions,
}: {
  view: ViewId;
  onView: (id: ViewId) => void;
  courses: Course[];
  unreadByCourse: Map<number, number>;
  unreadTotal: number | "–";
  activeCourseId: number | null;
  onCourse: (id: number | null) => void;
  sync: SyncStatusModel | null;
  onSync: () => void;
  onOpenScans: () => void;
  onOpenPalette: () => void;
  /** Rail mode: icons only, tooltips carry the names. */
  collapsed: boolean;
  /** In the rail this expands; when expanded it collapses. */
  onToggle: () => void;
  /** The narrow-width drawer is open over the content. */
  overlay?: boolean;
  sessionExpired?: boolean;
  appearanceActions?: ReactNode;
}) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const wasOverlay = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (overlay && !wasOverlay.current) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      sidebarRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"])',
      )?.focus();
    } else if (!overlay && wasOverlay.current) {
      const active = document.activeElement;
      const anotherModalOpen = document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      );
      const focusStayedInDrawer = sidebarRef.current?.contains(active) || active === document.body;
      if (returnFocus.current?.isConnected && focusStayedInDrawer && !anotherModalOpen) {
        returnFocus.current.focus();
      }
      returnFocus.current = null;
    }
    wasOverlay.current = overlay;
  }, [overlay]);

  const trapDrawerFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!overlay || event.key !== "Tab") return;
    const focusable = [...(sidebarRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  const topCourses = [...courses]
    .sort((a, b) => {
      const code = (course: Course) => courseLabel(course.id)?.name ?? course.shortName ?? course.name;
      const byCode = code(a).localeCompare(code(b), undefined, { sensitivity: "base", numeric: true });
      return byCode || a.id - b.id;
    })
    .slice(0, 8);

  return (
    <div
      ref={sidebarRef}
      className={cx("sidebar", overlay && "overlay")}
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay ? true : undefined}
      aria-label={overlay ? "Primary navigation" : undefined}
      onKeyDown={trapDrawerFocus}
    >
      <div className="sidebar-header">
        <button
          type="button"
          className={cx("sidebar-brand", !collapsed && "sidebar-collapse")}
          onClick={onToggle}
          aria-label={overlay ? "Close navigation" : `${collapsed ? "Expand" : "Collapse"} sidebar (${formatShortcut("Mod+\\")})`}
        >
          <span className="brand-mark" aria-hidden="true">P</span>
          <span className="brand-name">Pulse</span>
          <span className="sr-only">{collapsed ? "Expand" : "Collapse"}</span>
          <ChevronDown className="brand-chevron" aria-hidden="true" />
        </button>
        <IconButton label="Open command palette" className="search-trigger" onClick={onOpenPalette}>
          <Search aria-hidden="true" />
        </IconButton>
      </div>

      <div className="sidebar-scroll">
        <nav aria-label="Primary">
          {NAV.map((item) => (
            <NavItem
              key={item.id}
              icon={NAV_ICON[item.id]}
              label={item.label}
              // Library is the course list only; a course page is its own place.
              active={view === item.id && (item.id !== "library" || activeCourseId == null)}
              badge={item.id === "today" ? unreadTotal : undefined}
              collapsed={collapsed && !overlay}
              onClick={() => onView(item.id)}
            />
          ))}
        </nav>

        {(!collapsed || overlay) && courses.length > 0 && (
          <div className="course-nav-section">
            <p className="nav-section-label">Courses</p>
            <div className="course-nav-list">
              {topCourses.map((course) => (
                <CourseNavItem
                  key={course.id}
                  course={course}
                  unread={unreadTotal === "–" ? "–" : unreadByCourse.get(course.id) ?? 0}
                  active={view === "library" && activeCourseId === course.id}
                  collapsed={collapsed && !overlay}
                  onSelect={() => onCourse(course.id)}
                />
              ))}
            </div>
            {courses.length > topCourses.length && (
              <button type="button" className="all-courses-link" onClick={() => onCourse(null)}>
                All courses
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <SyncStatus sync={sync} onOpenScans={onOpenScans} sessionExpired={sessionExpired} />
        <div className="sidebar-footer-actions">
          <SyncButton running={Boolean(sync?.running)} onSync={onSync} collapsed />
          {appearanceActions}
          {collapsed && (
            <IconButton label={overlay ? "Close navigation" : `Expand sidebar (${formatShortcut("Mod+\\")})`} onClick={onToggle}>
              <PanelLeftOpen aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

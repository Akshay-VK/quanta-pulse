import {
  Activity,
  Calendar,
  History,
  Library,
  PanelLeft,
  PanelLeftOpen,
  Pause,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cx } from "../lib/cx";
import { NAV, type ViewId } from "../lib/nav";
import { courseDotClass } from "./ui/CoursePill";
import { IconButton } from "./ui/IconButton";
import { courseLabel } from "../lib/courseName";
import { Kbd } from "./ui/Kbd";
import { formatShortcut } from "../lib/platform";
import { Tooltip } from "./ui/Tooltip";
import SyncStatus from "./SyncStatus";
import SyncButton from "./SyncButton";
import type { Course, SyncStatus as SyncStatusModel } from "../lib/types";

const NAV_ICON: Record<ViewId, ReactNode> = {
  today: <Sun aria-hidden="true" />,
  calendar: <Calendar aria-hidden="true" />,
  library: <Library aria-hidden="true" />,
  history: <History aria-hidden="true" />,
  settings: <Settings aria-hidden="true" />,
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
  badge?: number;
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
      {badge !== undefined && badge > 0 && (
        <span className="nav-badge">{badge > 99 ? "99+" : badge}</span>
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
  unread: number;
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
      {unread > 0 && <span className="course-nav-count">{unread}</span>}
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
}: {
  view: ViewId;
  onView: (id: ViewId) => void;
  courses: Course[];
  unreadByCourse: Map<number, number>;
  unreadTotal: number;
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
      {/* The logo doubles as the expand affordance in the rail. */}
      <button
        type="button"
        className="sidebar-brand"
        data-tauri-drag-region
        onClick={collapsed ? onToggle : undefined}
        aria-label={collapsed ? (overlay ? "Close navigation" : `Expand sidebar (${formatShortcut("Mod+\\")})`) : undefined}
        tabIndex={collapsed ? 0 : -1}
      >
        <Activity className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Quanta Pulse</span>
      </button>

      <div className="sidebar-scroll">
        <button type="button" className="search-trigger" onClick={onOpenPalette}>
          <Search aria-hidden="true" />
          <span className="st-hint">Search</span>
          <Kbd keys="Mod+K" />
        </button>

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
                  unread={unreadByCourse.get(course.id) ?? 0}
                  active={view === "library" && activeCourseId === course.id}
                  collapsed={collapsed && !overlay}
                  onSelect={() => onCourse(course.id)}
                />
              ))}
            </div>
            <button
              type="button"
              className="all-courses-link"
              onClick={() => onCourse(null)}
            >
              All courses
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <SyncStatus sync={sync} onOpenScans={onOpenScans} />
        <SyncButton running={Boolean(sync?.running)} onSync={onSync} collapsed={collapsed && !overlay} />

        {collapsed ? (
          // Always visible: the rail must always offer a way back out.
          <Tooltip content="Expand sidebar (Ctrl+\\)" side="right">
            <IconButton label={overlay ? "Close navigation" : "Expand sidebar (Ctrl+\\)"} size={28} tooltip={false} onClick={onToggle}>
              <PanelLeftOpen aria-hidden="true" />
            </IconButton>
          </Tooltip>
        ) : (
          <button type="button" className="sidebar-collapse" onClick={onToggle}>
            <PanelLeft aria-hidden="true" />
            Collapse
          </button>
        )}
      </div>
    </div>
  );
}

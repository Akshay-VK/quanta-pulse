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
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { NAV, type ViewId } from "../lib/nav";
import { courseDotClass } from "./ui/CoursePill";
import { IconButton } from "./ui/IconButton";
import { courseLabel } from "../lib/courseName";
import { Kbd } from "./ui/Kbd";
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
  const topCourses = [...courses]
    .sort((a, b) => {
      const ua = unreadByCourse.get(a.id) ?? 0;
      const ub = unreadByCourse.get(b.id) ?? 0;
      if (ub !== ua) return ub - ua;
      return (a.shortName || a.name).localeCompare(b.shortName || b.name);
    })
    .slice(0, 8);

  return (
    <div className={cx("sidebar", overlay && "overlay")}>
      {/* The logo doubles as the expand affordance in the rail. */}
      <button
        type="button"
        className="sidebar-brand"
        data-tauri-drag-region
        onClick={collapsed ? onToggle : undefined}
        aria-label={collapsed ? "Expand sidebar (Ctrl+\\)" : undefined}
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
              badge={item.id === "history" ? unreadTotal : undefined}
              collapsed={collapsed}
              onClick={() => onView(item.id)}
            />
          ))}
        </nav>

        {!collapsed && courses.length > 0 && (
          <div className="course-nav-section">
            <p className="nav-section-label">Courses</p>
            <div className="course-nav-list">
              {topCourses.map((course) => (
                <CourseNavItem
                  key={course.id}
                  course={course}
                  unread={unreadByCourse.get(course.id) ?? 0}
                  active={view === "library" && activeCourseId === course.id}
                  collapsed={collapsed}
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
        <SyncButton running={Boolean(sync?.running)} onSync={onSync} collapsed={collapsed} />

        {collapsed ? (
          // Always visible: the rail must always offer a way back out.
          <Tooltip content="Expand sidebar (Ctrl+\\)" side="right">
            <IconButton label="Expand sidebar (Ctrl+\\)" size={28} tooltip={false} onClick={onToggle}>
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
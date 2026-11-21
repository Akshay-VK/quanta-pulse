import { ChevronDown, ChevronRight, Folder, FolderOpen, Pause } from "lucide-react";
import { useEffect, useMemo, type KeyboardEvent, type ReactElement } from "react";
import { useSessionValue } from "../hooks/useSessionViews";
import { buildDisplayNames, loadAliases } from "../lib/courseName";
import { buildCourseTree, type CourseTreeNode } from "../lib/courseTree";
import { cx } from "../lib/cx";
import type { Course, Resource } from "../lib/types";
import { courseDotClass } from "./ui/CoursePill";

function branchKey(courseId: number, path: string[]) {
  return JSON.stringify([courseId, ...path]);
}

/** Course navigation with independent disclosure and folder selection. */
export default function SidebarCourseTree({ courses, resources, activeCourseId, activeFolderPath, unreadByCourse, unreadTotal, onCourse }: {
  courses: Course[];
  resources: Resource[];
  activeCourseId: number | null;
  activeFolderPath: string[] | null;
  unreadByCourse: Map<number, number>;
  unreadTotal: number | "–";
  onCourse: (id: number, folderPath?: string[]) => void;
}) {
  const [expanded, setExpanded] = useSessionValue<Set<string>>("sidebar:expanded-courses", () => new Set());
  const trees = useMemo(() => {
    const byCourse = new Map<number, Resource[]>();
    for (const resource of resources) {
      if (resource.courseId == null) continue;
      const items = byCourse.get(resource.courseId) ?? [];
      items.push(resource);
      byCourse.set(resource.courseId, items);
    }
    const names = buildDisplayNames(courses, loadAliases());
    return courses.map(course => {
      const name = names.get(course.id) ?? course.name;
      return { course, name, tree: buildCourseTree(byCourse.get(course.id) ?? [], name) };
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.course.id - b.course.id);
  }, [courses, resources]);

  useEffect(() => {
    if (activeCourseId == null) return;
    const path = activeFolderPath ?? [];
    const branches = [branchKey(activeCourseId, []), ...path.map((_, index) => branchKey(activeCourseId, path.slice(0, index + 1)))];
    setExpanded(previous => branches.every(key => previous.has(key)) ? previous : new Set([...previous, ...branches]));
  }, [activeCourseId, activeFolderPath, setExpanded]);

  const activeKey = activeCourseId == null ? null : branchKey(activeCourseId, activeFolderPath ?? []);

  const toggle = (key: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.courseTreeItem) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-course-tree-item]")];
    const index = rows.indexOf(target);
    const branch = target.parentElement?.querySelector<HTMLButtonElement>(".course-tree-disclosure");
    let destination: HTMLButtonElement | undefined;
    switch (event.key) {
      case "ArrowDown": destination = rows[index + 1]; break;
      case "ArrowUp": destination = rows[index - 1]; break;
      case "Home": destination = rows[0]; break;
      case "End": destination = rows.at(-1); break;
      case "ArrowRight":
        if (branch?.getAttribute("aria-expanded") === "false") branch.click();
        else if (rows[index + 1]?.dataset.courseTreeParent === target.dataset.courseTreeItem) destination = rows[index + 1];
        break;
      case "ArrowLeft":
        if (branch?.getAttribute("aria-expanded") === "true") branch.click();
        else destination = rows.find(row => row.dataset.courseTreeItem === target.dataset.courseTreeParent);
        break;
      default: return;
    }
    event.preventDefault();
    destination?.focus();
  };

  function renderBranch(course: Course, node: CourseTreeNode, title: string, level: number): ReactElement {
    const key = branchKey(course.id, node.path);
    const isRoot = level === 0;
    const hasChildren = node.children.length > 0;
    const open = hasChildren && expanded.has(key);
    const paused = course.monitoringStatus !== "monitored";
    const unread = unreadTotal === "–" ? "–" : unreadByCourse.get(course.id) ?? 0;
    const count = isRoot ? unread : node.count;
    const FolderIcon = open ? FolderOpen : Folder;
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
      <li key={key}>
        <div className={cx("course-tree-row", activeKey === key && "is-current")}>
          {hasChildren ? (
            <button type="button" className="course-tree-disclosure"
              aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
              aria-expanded={open} onClick={() => toggle(key)}>
              <Chevron aria-hidden="true" />
            </button>
          ) : <span className="course-tree-spacer" aria-hidden="true" />}
          <button
            type="button"
            className={cx(isRoot ? "course-nav-item" : "course-folder-item", isRoot && paused && "paused")}
            title={title}
            aria-label={node.name}
            aria-current={activeKey === key ? "page" : undefined}
            data-course-tree-item={key}
            data-course-tree-parent={isRoot ? undefined : branchKey(course.id, node.path.slice(0, -1))}
            onClick={() => isRoot ? onCourse(course.id) : onCourse(course.id, node.path)}
          >
            {isRoot ? paused ? <Pause className="course-warn" aria-hidden="true" /> :
              <span className={cx("course-dot", courseDotClass(course.id))} aria-hidden="true" /> :
              <FolderIcon className="course-tree-folder-icon" aria-hidden="true" />}
            <span className="course-nav-code">{node.name}</span>
            {(count === "–" || count > 0) && <span className="course-nav-count">{count}</span>}
          </button>
        </div>
        {open && <ul className="course-tree-children">{node.children.map(child => renderBranch(course, child, child.path.join(" / "), level + 1))}</ul>}
      </li>
    );
  }

  return (
    <nav className="course-nav-section" aria-label="Courses" onKeyDown={onKeyDown}>
      <p className="nav-section-label">Courses</p>
      <ul className="course-nav-list">{trees.map(({ course, tree }) => renderBranch(course, tree, course.name, 0))}</ul>
    </nav>
  );
}

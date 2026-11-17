import { useMirror } from "../hooks/useMirror";
import { isLocal, mirrorTip } from "../lib/mirrorState";
import { formatSectionPath } from "../lib/sectionPath";
import { Command } from "cmdk";
import { Calendar, History, Library, Search, Settings, Sun } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { NAV, type ViewId } from "../lib/nav";
import { courseTitle } from "../lib/courseName";
import { Kbd } from "./ui/Kbd";
import { Dialog } from "./ui/Dialog";
import type { Course, Resource } from "../lib/types";
import { rankMaterialMatches } from "../lib/materialActions";
import { splitLiteralMatches } from "../lib/filter";
import { parseTimestamp } from "../lib/format";
import { parsePaletteQuery, type PaletteQuery } from "../lib/paletteQuery";

const VIEW_ICON: Record<ViewId, ReactNode> = {
  today: <Sun aria-hidden="true" />,
  calendar: <Calendar aria-hidden="true" />,
  library: <Library aria-hidden="true" />,
  history: <History aria-hidden="true" />,
  settings: <Settings aria-hidden="true" />,
};

const GO_SHORTCUT: Record<ViewId, string> = { today: "G I", calendar: "G C", library: "G L", history: "G H", settings: "Mod+5" };

export interface PaletteAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = splitLiteralMatches(text, query);
  if (parts.length === 1 && !parts[0].match) return <>{text}</>;
  return <>{parts.map((part, i) => part.match ? <mark key={i} className="palette-mark">{part.text}</mark> : <span key={i}>{part.text}</span>)}</>;
}

function courseMatchesQuery(course: Course, parsed: PaletteQuery) {
  if (parsed.filters.courseIds && !parsed.filters.courseIds.includes(course.id)) return false;
  const needle = parsed.freeText.toLowerCase();
  if (!needle) return true;
  return `${course.name} ${course.shortName ?? ""} ${courseTitle(course.id, course.name)}`.toLowerCase().includes(needle);
}

function resourceMatchesQuery(resource: Resource, parsed: PaletteQuery, saved: boolean) {
  if (parsed.filters.courseIds && (resource.courseId === null || !parsed.filters.courseIds.includes(resource.courseId))) return false;
  if (parsed.filters.types && !parsed.filters.types.includes(resource.resourceType)) return false;
  // ponytail: read/unread tokens parse but cannot filter — palette props carry no read state. Add a read-state prop when palette-level read filtering is required.
  if (parsed.filters.is?.includes("saved") && !saved) return false;
  if (parsed.filters.is?.includes("unsaved") && saved) return false;
  const dueValues = parsed.filters.due ?? [];
  if (dueValues.length) {
    const dueAt = resource.dueAt ? parseTimestamp(resource.dueAt) : null;
    if (dueValues.includes("none")) {
      if (dueAt) return false;
    } else if (!dueAt) {
      return false;
    } else {
      const today = new Date();
      const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const time = dueAt.getTime();
      const isToday = time >= dayStart && time < dayStart + 86_400_000;
      const isWeek = time >= dayStart && time < dayStart + 7 * 86_400_000;
      const isOverdue = time < dayStart;
      const matches = (dueValues.includes("today") && isToday)
        || (dueValues.includes("week") && isWeek)
        || (dueValues.includes("overdue") && isOverdue);
      if (!matches) return false;
    }
  }
  return true;
}

/** The command palette: views, courses, best file matches and app actions. */
export default function CommandPalette({
  open,
  onOpenChange,
  onView,
  courses,
  onCourse,
  resources,
  onInspectResource,
  onSeeAllFiles,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: (id: ViewId) => void;
  courses: Course[];
  onCourse: (id: number) => void;
  resources: Resource[];
  onInspectResource: (resource: Resource) => void;
  onSeeAllFiles: (query: string) => void;
  actions: PaletteAction[];
}) {
  const mirror = useMirror();
  const [query, setQuery] = useState("");
  const parsed = useMemo(() => parsePaletteQuery(query, { courses, resources }), [query, courses, resources]);
  const needle = parsed.freeText.toLowerCase();
  const hasQuery = query.trim().length > 0;

  const isSaved = (resource: Resource) => Boolean(
    !resource.isExternal && mirror && isLocal(mirror.statusOf(resource.id)),
  );
  const navItems = NAV.filter((item) => !needle || item.label.toLowerCase().includes(needle));
  const courseMatches = courses.filter((c) => courseMatchesQuery(c, parsed));
  const scopedResources = resources.filter((r) => resourceMatchesQuery(r, parsed, isSaved(r)));
  const files = hasQuery
    ? (needle ? rankMaterialMatches(scopedResources, needle).slice(0, 8) : scopedResources.slice(0, 8))
    : [];
  const actionMatches = actions.filter((a) => !needle || a.label.toLowerCase().includes(needle));
  const anyFileMatch = files.length > 0;

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const noResults = hasQuery && files.length === 0 && courseMatches.length === 0 && actionMatches.length === 0 && navItems.length === 0 && !anyFileMatch;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
      label="Command palette"
      className="palette"
    >
      <Command shouldFilter={false} label="Command palette">
        <div className="palette-input-row">
          <Search aria-hidden="true" />
          {parsed.tokens.length > 0 && (
            <span className="palette-tokens" aria-hidden="true">
              {parsed.tokens.map((token, i) => (
                <span key={`${token.raw}-${i}`} className={`palette-token${token.valid ? "" : " is-invalid"}`}>{token.raw}</span>
              ))}
            </span>
          )}
          <Command.Input
            className="palette-input"
            value={parsed.tokens.length ? parsed.freeText : query}
            onValueChange={(value) => {
              if (parsed.tokens.length) {
                const prefix = parsed.tokens.map((t) => t.raw).join(" ");
                setQuery((prefix + (value ? ` ${value}` : "")).trim());
              } else {
                setQuery(value);
              }
            }}
            placeholder={hasQuery ? "" : "Search commands, courses and files…"}
            autoFocus
          />
          <span className="palette-extra"><Kbd keys="Esc" /></span>
        </div>
        <Command.List className="palette-list">
          {noResults && (
            <div className="palette-empty-state">
              <div className="palette-empty-title">No results for “{query.trim()}”</div>
              <div className="palette-empty-copy">Try fewer words, or search all files.</div>
            </div>
          )}

          {!hasQuery && navItems.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Navigate</div>
              {navItems.map((item) => (
                <Command.Item key={item.id} className="palette-item" onSelect={() => run(() => onView(item.id))}>
                  <span className="icon">{VIEW_ICON[item.id]}</span>
                  <span>Go to {item.label}</span>
                  <span className="palette-extra"><Kbd keys={GO_SHORTCUT[item.id]} /></span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {hasQuery && navItems.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Navigate</div>
              {navItems.map((item) => (
                <Command.Item key={item.id} className="palette-item" onSelect={() => run(() => onView(item.id))}>
                  <span className="icon">{VIEW_ICON[item.id]}</span>
                  <span>{item.label}</span>
                  <span className="palette-extra"><Kbd keys={`Mod+${NAV.findIndex((view) => view.id === item.id) + 1}`} /></span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {hasQuery && files.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Files</div>
              {files.map((resource) => (
                <Command.Item
                  key={resource.id}
                  className="palette-item"
                  value={`${resource.title} ${resource.courseName ?? ""}`}
                  onSelect={() => run(() => onInspectResource(resource))}
                >
                  <span className="icon"><Search aria-hidden="true" /></span>
                  <span className="palette-main"><Highlight text={resource.title} query={needle || query.trim()} /></span>
                  <span className="palette-extra">
                    <span className="faint">{resource.courseName}{formatSectionPath(resource) ? ` / ${formatSectionPath(resource)}` : ""}</span>
                    {!resource.isExternal && mirror?.statusOf(resource.id) && <span className="faint">{isLocal(mirror.statusOf(resource.id)) ? "Saved copy" : mirrorTip(mirror.statusOf(resource.id))}</span>}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {hasQuery && courseMatches.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Courses</div>
              {courseMatches.map((course) => (
                <Command.Item key={course.id} className="palette-item" value={course.name} onSelect={() => run(() => onCourse(course.id))}>
                  <span className="icon"><Library aria-hidden="true" /></span>
                  <span className="palette-main"><Highlight text={courseTitle(course.id, course.name)} query={needle} /></span>
                  <span className="palette-extra"><span className="faint">{course.resourceCount} files</span></span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {anyFileMatch && (
            <Command.Group className="palette-group">
              {!hasQuery ? null : <div className="palette-heading">Actions</div>}
              <Command.Item className="palette-item" value={`See all results ${query.trim()}`} onSelect={() => run(() => onSeeAllFiles(query.trim()))}>
                <span className="icon"><Search aria-hidden="true" /></span>
                <span>See all results for “{query.trim()}”</span>
                <span className="palette-extra"><Kbd keys="Enter" /></span>
              </Command.Item>
            </Command.Group>
          )}

          {noResults && (
            <Command.Group className="palette-group">
              <Command.Item className="palette-item" value={`Search all files ${query.trim()}`} onSelect={() => run(() => onSeeAllFiles(query.trim()))}>
                <span className="icon"><Search aria-hidden="true" /></span>
                <span>Search all files</span>
                <span className="palette-extra"><Kbd keys="Enter" /></span>
              </Command.Item>
            </Command.Group>
          )}

          {actionMatches.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Actions</div>
              {actionMatches.map((action) => (
                <Command.Item key={action.id} className="palette-item" onSelect={() => run(action.onSelect)}>
                  {action.icon && <span className="icon">{action.icon}</span>}
                  <span>{action.label}</span>
                  {action.shortcut && <span className="palette-extra"><Kbd keys={action.shortcut} /></span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="palette-footer">
          <span className="hint"><Kbd keys="Up" /><Kbd keys="Down" /> Navigate</span>
          <span className="hint"><Kbd keys="Enter" /> Open</span>
          {hasQuery && <span className="palette-footer-note">Try course: type: is: due:</span>}
        </div>
      </Command>
    </Dialog>
  );
}

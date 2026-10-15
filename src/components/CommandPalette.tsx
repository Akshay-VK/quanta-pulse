import { Command } from "cmdk";
import { Calendar, History, Library, Search, Settings, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NAV, type ViewId } from "../lib/nav";
import { courseTitle } from "../lib/courseName";
import { formatSectionPath } from "../lib/sectionPath";
import { Kbd } from "./ui/Kbd";
import { Dialog } from "./ui/Dialog";
import type { Course, Resource } from "../lib/types";

const VIEW_ICON: Record<ViewId, ReactNode> = {
  today: <Sun aria-hidden="true" />,
  calendar: <Calendar aria-hidden="true" />,
  library: <Library aria-hidden="true" />,
  history: <History aria-hidden="true" />,
  settings: <Settings aria-hidden="true" />,
};

export interface PaletteAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

/** The command palette: views, courses, best file matches and app actions. */
export default function CommandPalette({
  open,
  onOpenChange,
  onView,
  courses,
  onCourse,
  resources,
  onOpenResource,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: (id: ViewId) => void;
  courses: Course[];
  onCourse: (id: number) => void;
  resources: Resource[];
  onOpenResource: (url: string) => void;
  actions: PaletteAction[];
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const views = NAV.filter((item) => matches(item.label));
  const courseMatches = courses.filter((c) =>
    matches(`${c.name} ${c.shortName ?? ""} ${courseTitle(c.id, c.name)}`),
  );
  const files = needle
    ? resources
        .filter((r) =>
          matches(`${r.title} ${r.courseName ?? ""} ${formatSectionPath(r)}`),
        )
        .slice(0, 8)
    : [];
  const actionMatches = actions.filter((a) => matches(a.label));

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

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
          <Command.Input
            className="palette-input"
            value={query}
            onValueChange={setQuery}
            placeholder="Search or jump to…"
            autoFocus
          />
        </div>
        <Command.List className="palette-list">
          {views.length + courseMatches.length + files.length + actionMatches.length ===
            0 && (
            <div className="palette-empty">No matches for that search</div>
          )}

          {views.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Views</div>
              {views.map((item, index) => (
                <Command.Item
                  key={item.id}
                  className="palette-item"
                  onSelect={() => run(() => onView(item.id))}
                >
                  <span className="icon">{VIEW_ICON[item.id]}</span>
                  <span>{item.label}</span>
                  <span className="palette-extra">
                    <Kbd keys={`Mod+${index + 1}`} />
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {courseMatches.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Courses</div>
              {courseMatches.map((course) => (
                <Command.Item
                  key={course.id}
                  className="palette-item"
                  value={course.name}
                  onSelect={() => run(() => onCourse(course.id))}
                >
                  <span>{courseTitle(course.id, course.name)}</span>
                  <span className="palette-extra">
                    <span className="faint">{course.resourceCount} files</span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {files.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Files</div>
              {files.map((resource) => (
                <Command.Item
                  key={resource.id}
                  className="palette-item"
                  value={`${resource.title} ${resource.courseName ?? ""}`}
                  onSelect={() => run(() => onOpenResource(resource.url))}
                >
                  <span>{resource.title}</span>
                  <span className="palette-extra">
                    <span className="faint">{resource.courseName}</span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {actionMatches.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Actions</div>
              {actionMatches.map((action) => (
                <Command.Item
                  key={action.id}
                  className="palette-item"
                  onSelect={() => run(action.onSelect)}
                >
                  {action.icon && <span className="icon">{action.icon}</span>}
                  <span>{action.label}</span>
                  {action.shortcut && (
                    <span className="palette-extra">
                      <Kbd keys={action.shortcut} />
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="palette-footer">
          <span>
            <Kbd keys="Up" /> <Kbd keys="Down" /> to navigate
          </span>
          <span>
            <Kbd keys="Enter" /> to select
          </span>
          <span>
            <Kbd keys="Esc" /> to close
          </span>
        </div>
      </Command>
    </Dialog>
  );
}
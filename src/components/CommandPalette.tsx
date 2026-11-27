import { BodyMatch, SavedContentControls } from "./SavedContentSearch";
import { useSavedContent } from "../hooks/useSavedContent";
import { Banner } from "./ui/Banner";
import { SearchControls } from "./SearchControls";
import type { SearchFilters } from "../lib/desktopSearch";
import { useMirror } from "../hooks/useMirror";
import { isLocal } from "../lib/mirrorState";
import { Command } from "cmdk";
import { Calendar, Folder, History, Inbox, Library, Search, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NAV, type ViewId } from "../lib/nav";
import { courseTitle } from "../lib/courseName";
import { Kbd } from "./ui/Kbd";
import { FileTypeIcon } from "./ui/FileTypeIcon";
import { Dialog } from "./ui/Dialog";
import type { Course, Resource } from "../lib/types";
import { searchDesktop } from "../lib/desktopSearch";
import type { SearchScope } from "../lib/desktopSearch";
import { splitLiteralMatches } from "../lib/filter";
import { parsePaletteQuery } from "../lib/paletteQuery";
import { loadAliases, buildDisplayNames } from "../lib/courseName";

const VIEW_ICON: Record<ViewId, ReactNode> = {
  today: <Inbox aria-hidden="true" />,
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
  searchableOnly?: boolean;
  onSelect: () => void;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = splitLiteralMatches(text, query);
  if (parts.length === 1 && !parts[0].match) return <>{text}</>;
  return <>{parts.map((part, i) => part.match ? <mark key={i} className="palette-mark">{part.text}</mark> : <span key={i}>{part.text}</span>)}</>;
}

/** The command palette: views, courses, best file matches and app actions. */
export default function CommandPalette({
  open,
  onOpenChange,
  onView,
  courses,
  onCourse,
  onFolder,
  resources, timeZone, now, inventoryPending, inventoryError,
  unreadResources,
  onInspectResource,
  onSeeAllFiles,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: (id: ViewId) => void;
  courses: Course[];
  onCourse: (id: number) => void;
  onFolder?: (courseId: number, path: string[]) => void;
  resources: Resource[];
  timeZone?: string;
  now?: Date;
  inventoryPending?: boolean;
  inventoryError?: string | null;
  unreadResources?: ReadonlySet<number>;
  onInspectResource: (resource: Resource) => void;
  onSeeAllFiles: (query: string, options?: SearchFilters & { scope?: SearchScope }) => void;
  actions: PaletteAction[];
}) {
  const mirror = useMirror();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [tokens, setTokens] = useState<string[]>([]);
  const [recentId, setRecentId] = useState<number>();
  const [scope, setScope] = useState<SearchScope>({ kind: "everywhere" });
  const [filters, setFilters] = useState<SearchFilters>({});
  useEffect(() => { if (open) setScope({ kind: "everywhere" }); }, [open]);
  const query = [...tokens, draft].filter(Boolean).join(" ");
  const aliases = useMemo(() => loadAliases(), [courses]);
  const displayNames = useMemo(() => buildDisplayNames(courses, aliases), [courses, aliases]);
  const parsed = useMemo(() => parsePaletteQuery(query, { courses, resources, displayNames, aliases }), [query, courses, resources, displayNames, aliases]);
  const needle = parsed.freeText.toLowerCase();
  const hasQuery = query.trim().length > 0 || Boolean(filters.sourceFrom || filters.sourceThrough);

  const isSaved = (resource: Resource) => Boolean(
    !resource.isExternal && mirror && isLocal(mirror.statusOf(resource.id)),
  );
  const savedIds = useMemo(() => new Set(resources.filter((r) => isSaved(r)).map((r) => r.id)), [resources, mirror]);
  const content = useSavedContent(open && Boolean(filters.includeSavedText), query, { courses, resources, displayNames }, mirror);
  const searchResult = useMemo(() => searchDesktop(
    { raw: query, scope, filters, timeZone, now },
    { courses, resources, displayNames, unreadIds: unreadResources, savedIds, bodyHits: content.hits, revision: undefined },
  ), [query, courses, resources, displayNames, unreadResources, savedIds, scope, filters, timeZone, now, content.hits]);
  const navItems = NAV.filter((item) => (!hasQuery || needle) && (!needle || item.label.toLowerCase().includes(needle)));
  const courseMatches = hasQuery && !parsed.hasKnownInvalid ? searchResult.courses : [];
  const files = hasQuery && !parsed.hasKnownInvalid ? searchResult.files.slice(0, 8) : [];
  const folderMatches = hasQuery && !parsed.hasKnownInvalid ? searchResult.folders : [];
  const actionMatches = actions.filter((action) => hasQuery
    ? Boolean(needle && action.label.toLowerCase().includes(needle))
    : !action.searchableOnly);
  const anyFileMatch = files.length > 0;
  const viewAllFiles = () => {
    onSeeAllFiles(query, { scope, ...filters });
  };
  const recent = resources.find((resource) => resource.id === recentId)
    ?? resources.reduce<Resource | undefined>((latest, resource) => !latest || latest.firstSeenAt < resource.firstSeenAt ? resource : latest, undefined);

  const resetQuery = () => {
    setDraft("");
    setTokens([]);
    setFilters({});
  };

  const run = (fn: () => void) => {
    resetQuery();
    onOpenChange(false);
    fn();
  };

  const noResults = hasQuery && files.length === 0 && courseMatches.length === 0 && actionMatches.length === 0 && navItems.length === 0 && folderMatches.length === 0 && !anyFileMatch && searchResult.errors.length === 0 && !inventoryError && !inventoryPending && !content.pending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetQuery();
      }}
      label="Command palette"
      className="palette"
    >
      <Command shouldFilter={false} label="Command palette">
        <div className="palette-input-row">
          <Search aria-hidden="true" />
          {tokens.length > 0 && (
            <span className="palette-tokens">
              {tokens.map((token, i) => (
                <button key={`${token}-${i}`} type="button" className="palette-token" aria-label={`Remove ${token} filter`}
                  onClick={() => {
                    setTokens((current) => current.filter((_, index) => index !== i));
                    inputRef.current?.focus();
                  }}>{token}</button>
              ))}
            </span>
          )}
          <Command.Input
            ref={inputRef}
            className="palette-input"
            value={draft}
            onValueChange={(value) => {
              if (/\s$/.test(value)) {
                const token = parsePaletteQuery(value, { courses, resources, displayNames, aliases });
                if (!token.freeText && token.tokens.length > 0 && token.tokens.every((entry) => entry.valid)) {
                  setTokens((current) => [...current, ...token.tokens.map((entry) => entry.raw)]);
                  setDraft("");
                  return;
                }
              }
              setDraft(value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !draft && tokens.length) {
                setTokens((current) => current.slice(0, -1));
              } else if (event.key === "Tab" && !event.shiftKey && draft && !parsed.freeText) {
                const token = parsed.tokens.at(-1);
                if (token?.valid && token.raw === draft.trim()) {
                  event.preventDefault();
                  setTokens((current) => [...current, token.raw]);
                  setDraft("");
                }
              }
            }}
            placeholder={hasQuery ? "" : "Search commands, courses and files…"}
            autoFocus
          />
          <span className="palette-extra"><Kbd keys="Esc" /></span>
        </div>
        <SearchControls raw={query} onRaw={raw => { setTokens([]); setDraft(raw); }} scope={scope} onScope={setScope} filters={filters} onFilters={setFilters} courses={courses} resources={resources} />
        <SavedContentControls enabled={Boolean(filters.includeSavedText)} onToggle={() => setFilters(value => ({ ...value, includeSavedText: !value.includeSavedText }))} content={content} />
        <Command.List className="palette-list">
          {inventoryError ? <Banner kind="error">Search refresh failed. Retained results are shown. {inventoryError}</Banner> : inventoryPending && <Banner kind="info">Search inventory is refreshing. Retained results are shown.</Banner>}
          {searchResult.errors.length > 0 && (
            <div className="palette-empty-state" role="alert">
              <div className="palette-empty-title">Invalid search</div>
              <div className="palette-empty-copy">{searchResult.errors.join(" ")}</div>
            </div>
          )}
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
                  <span className="palette-extra">{GO_SHORTCUT[item.id].split(" ").map((key) => <Kbd key={key} keys={key} />)}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {!hasQuery && recent && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Recent</div>
              <Command.Item className="palette-item" value={`Recent ${recent.id} ${recent.title}`}
                onSelect={() => run(() => { setRecentId(recent.id); onInspectResource(recent); })}>
                <FileTypeIcon type={recent.resourceType} />
                <span className="palette-main">{recent.title}</span>
                {recent.courseName && <span className="palette-extra mono faint">{recent.courseName}</span>}
              </Command.Item>
            </Command.Group>
          )}
          {hasQuery && files.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Files</div>
              {files.map((resource) => (
                <Command.Item
                  key={resource.id}
                  className="palette-item"
                  value={`File ${resource.id} ${resource.title}`}
                  onSelect={() => run(() => { setRecentId(resource.id); onInspectResource(resource); })}
                >
                  <FileTypeIcon type={resource.resourceType} />
                  <span className="palette-main"><Highlight text={resource.title} query={needle || query.trim()} /><BodyMatch snippet={content.hits?.get(resource.id)} /></span>
                  <span className="palette-extra">
                    <span className="mono faint">{resource.courseName}</span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {hasQuery && folderMatches.length > 0 && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Folders</div>
              {folderMatches.map((folder) => (
                <Command.Item key={folder.id} className="palette-item" value={`Folder ${folder.id} ${folder.name}`}
                  onSelect={() => run(() => onFolder?.(folder.courseId, folder.path))}>
                  <span className="icon"><Folder aria-hidden="true" /></span>
                  <span className="palette-main"><Highlight text={folder.name} query={needle || query.trim()} /></span>
                  <span className="palette-extra"><span className="mono faint">{displayNames.get(folder.courseId) || courseTitle(folder.courseId, courses.find(c => c.id === folder.courseId)?.name ?? "")} / {folder.path.join(" / ")}</span></span>
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

          {noResults && (
            <Command.Group className="palette-group">
              {parsed.tokens.length > 0 && (
                <Command.Item className="palette-item" value="Clear filters" onSelect={() => {
                  setTokens([]);
                  setDraft(parsed.freeText);
                  inputRef.current?.focus();
                }}>Clear filters</Command.Item>
              )}
              <Command.Item className="palette-item" value={`Search all files ${query.trim()}`} onSelect={() => run(() => onSeeAllFiles(query, { scope, ...filters }))}>
                <span className="icon"><Search aria-hidden="true" /></span>
                <span>Search all files</span>
                <span className="palette-extra"><Kbd keys="Enter" /></span>
              </Command.Item>
            </Command.Group>
          )}

          {(actionMatches.length > 0 || (hasQuery && navItems.length > 0) || anyFileMatch) && (
            <Command.Group className="palette-group">
              <div className="palette-heading">Actions</div>
              {hasQuery && navItems.map((item) => (
                <Command.Item key={item.id} className="palette-item" onSelect={() => run(() => onView(item.id))}>
                  <span className="icon">{VIEW_ICON[item.id]}</span>
                  <span>{item.label}</span>
                  <span className="palette-extra"><Kbd keys={`Mod+${NAV.findIndex((view) => view.id === item.id) + 1}`} /></span>
                </Command.Item>
              ))}
              {actionMatches.map((action) => (
                <Command.Item key={action.id} className="palette-item" onSelect={() => run(action.onSelect)}>
                  {action.icon && <span className="icon">{action.icon}</span>}
                  <span>{action.label}</span>
                  {action.shortcut && <span className="palette-extra"><Kbd keys={action.shortcut} /></span>}
                </Command.Item>
              ))}
              {anyFileMatch && (
                <Command.Item className="palette-item" value={`See all results ${query.trim()}`} onSelect={() => run(viewAllFiles)}>
                  <span className="icon"><Search aria-hidden="true" /></span>
                  <span>See all results for “{query.trim()}”</span>
                  <span className="palette-extra"><Kbd keys="Enter" /></span>
                </Command.Item>
              )}
            </Command.Group>
          )}
        </Command.List>
        <div className="palette-footer">
          <span className="hint"><Kbd keys="↑↓" /> Navigate</span>
          <span className="hint"><Kbd keys="Enter" /> Open</span>
          {parsed.tokens.length > 0 && <span className="hint"><Kbd keys="Tab" /> Add filter</span>}
          <span className="palette-footer-note">{parsed.tokens.length > 0 ? "Try course: type: is: due:" : "Pulse command"}</span>
        </div>
      </Command>
    </Dialog>
  );
}

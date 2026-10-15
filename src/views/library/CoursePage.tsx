import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ExternalLink,
  FolderTree,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import {
  buildCourseTree,
  dedupeCourseResources,
  type CourseTreeNode,
} from "../../lib/courseTree";
import {
  RESOURCE_SORTS,
  categoryOptions,
  filterCourseResources,
  sortResources,
  typeOptions,
  type ResourceCategoryId,
  type ResourceSort,
} from "../../lib/courseLibrary";
import { groupEventsByDay, eventKindMeta, longDayLabel } from "../../lib/events";
import { activityTimestamp } from "../../lib/filter";
import { formatTimeOfDay, parseTimestamp, relativeLabel } from "../../lib/format";
import { courseLabel, courseTitle } from "../../lib/courseName";
import { courseDotClass } from "../../components/ui/CoursePill";
import type { ChangeEvent, Course, Resource } from "../../lib/types";
import type { StatusKind } from "../../components/ui/StatusTag";
import PageHeader from "../../components/PageHeader";
import ResourceRow from "../../components/ResourceRow";
import GroupHeader from "../../components/GroupHeader";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Select } from "../../components/ui/Select";
import { SearchField } from "../../components/ui/SearchField";
import { ViewTabs } from "../../components/ui/Tabs";
import { Menu, type MenuItemSpec } from "../../components/ui/Menu";
import { EmptyState } from "../../components/ui/EmptyState";
import { Banner } from "../../components/ui/Banner";
import { Skeleton } from "../../components/ui/Skeleton";
import ConfirmDialog from "../../components/ConfirmDialog";
import TreeRow, { type FlatRow } from "./TreeRow";
import { courseHomeUrl } from "./courseUrl";

interface CoursePageProps {
  course: Course;
  onOpen: (url: string) => void;
  onPreview: (resource: Resource) => void;
  onChanged: () => void;
  onSyncNow?: () => void;
}

const VIRTUAL_THRESHOLD = 200;
const TREE_HEIGHT = 560;

const STATUS_KIND: Record<string, StatusKind> = {
  new: "new",
  updated: "updated",
  deadline: "deadline",
  announcement: "note",
  unavailable: "unavailable",
  restored: "restored",
};

/**
 * Which top-level sections start open: all of them in a short course,
 * otherwise the two whose contents changed most recently.
 */
export function pickDefaultSections(
  sections: CourseTreeNode[],
  latestChange: (node: CourseTreeNode) => number,
): string[] {
  if (sections.length <= 3) return sections.map((section) => section.id);
  return [...sections]
    .sort((a, b) => latestChange(b) - latestChange(a))
    .slice(0, 2)
    .map((section) => section.id);
}

/** Newest activity timestamp anywhere under a node. */
function latestIn(node: CourseTreeNode): number {
  let latest = 0;
  const walk = (current: CourseTreeNode) => {
    for (const resource of current.resources) {
      const at = parseTimestamp(activityTimestamp(resource))?.getTime() ?? 0;
      if (at > latest) latest = at;
    }
    current.children.forEach(walk);
  };
  walk(node);
  return latest;
}

/** Section expansion, remembered per course for the session. */
const sessionExpansion = new Map<number, Set<string>>();

function countNewThisWeek(events: ChangeEvent[]): number {
  const since = Date.now() - 7 * 86_400_000;
  return events.filter(
    (event) =>
      (event.changeType === "new" || event.changeType === "announcement") &&
      (parseTimestamp(event.detectedAt)?.getTime() ?? 0) >= since,
  ).length;
}

/** One course's page: contents tree and per-course activity. */
export default function CoursePage({
  course,
  onOpen,
  onPreview,
  onChanged,
  onSyncNow = () => {},
}: CoursePageProps) {
  const [items, setItems] = useState<Resource[] | null>(null);
  const [events, setEvents] = useState<ChangeEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRebaseline, setConfirmRebaseline] = useState(false);

  const [tab, setTab] = useState<"contents" | "activity">("contents");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ResourceSort>("newest");
  const [type, setType] = useState("all");
  const [category, setCategory] = useState<ResourceCategoryId | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const initialisedFor = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // A course is capped at 2000 discovered resources in the backend.
      const [resources, courseEvents] = await Promise.all([
        api.listResources({ courseId: course.id, limit: 2000 }),
        api.eventsRange(undefined, undefined, course.id, 2000),
      ]);
      setItems(resources);
      setEvents(courseEvents);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setItems(null);
      setEvents(null);
    } finally {
      setLoading(false);
    }
  }, [course.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const unique = useMemo(() => dedupeCourseResources(items ?? []), [items]);
  const types = useMemo(() => typeOptions(unique), [unique]);
  const categories = useMemo(() => categoryOptions(unique), [unique]);

  const needle = search.trim();
  const searching = needle !== "";
  const typeFilter = type === "all" ? "" : type;

  const filtered = useMemo(
    () => filterCourseResources(unique, { type: typeFilter, category }),
    [unique, typeFilter, category],
  );
  const searchResults = useMemo(
    () =>
      searching
        ? sortResources(filterCourseResources(unique, { search, type: typeFilter, category }), sort)
        : [],
    [searching, unique, search, typeFilter, category, sort],
  );
  const tree = useMemo(() => buildCourseTree(filtered, course.name), [filtered, course.name]);

  const rows = useMemo<FlatRow[]>(() => {
    if (searching) {
      return searchResults.map((resource, index) => ({
        kind: "file",
        id: `search:${resource.id}:${index}`,
        resource,
        depth: 0,
        searching: true,
      }));
    }
    const out: FlatRow[] = [];
    const walk = (node: CourseTreeNode, depth: number) => {
      for (const resource of sortResources(node.resources, sort)) {
        out.push({ kind: "file", id: `f:${resource.id}`, resource, depth, searching: false });
      }
      for (const child of node.children) {
        out.push({
          kind: "folder",
          id: child.id,
          node: child,
          depth,
          expanded: expanded.has(child.id),
        });
        if (expanded.has(child.id)) walk(child, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [searching, searchResults, tree, sort, expanded]);

  // Open the two most recently changed sections the first time this course is
  // shown in a session, then remember whatever the user does.
  useEffect(() => {
    if (loading || items === null) return;
    if (initialisedFor.current === course.id) return;
    initialisedFor.current = course.id;
    setExpanded(new Set(sessionExpansion.get(course.id) ?? pickDefaultSections(tree.children, latestIn)));
  }, [loading, items, course.id, tree]);

  const shown = searching ? searchResults.length : filtered.length;
  const total = unique.length;
  const filtersActive = type !== "all" || category !== "all" || searching;

  const toggle = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        sessionExpansion.set(course.id, next);
        return next;
      });
    },
    [course.id],
  );

  const allFolderIds = useCallback(() => {
    const ids: string[] = [];
    const walk = (node: CourseTreeNode) => {
      node.children.forEach((child) => {
        ids.push(child.id);
        walk(child);
      });
    };
    walk(tree);
    return ids;
  }, [tree]);

  const setAllExpanded = (expand: boolean) => {
    const next = new Set(expand ? allFolderIds() : []);
    sessionExpansion.set(course.id, next);
    setExpanded(next);
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [needle, type, category, tab]);

  useEffect(() => {
    setActiveIndex((index) =>
      rows.length === 0 ? 0 : Math.min(index, rows.length - 1),
    );
  }, [rows.length]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef(false);
  const virtualActive = rows.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: virtualActive ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });
  const virtualItems = virtualActive ? virtualizer.getVirtualItems() : [];

  const move = useCallback(
    (index: number) => {
      if (rows.length === 0) return;
      const clamped = Math.max(0, Math.min(rows.length - 1, index));
      setActiveIndex(clamped);
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[role="treeitem"][data-index="${clamped}"]`,
      );
      if (el) {
        el.focus();
      } else {
        pendingFocus.current = true;
        if (virtualActive) virtualizer.scrollToIndex(clamped, { align: "auto" });
      }
    },
    [rows.length, virtualActive, virtualizer],
  );

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[role="treeitem"][data-index="${activeIndex}"]`,
    );
    if (el) {
      el.focus();
      pendingFocus.current = false;
    }
  });

  const typed = useRef({ text: "", at: 0 });
  const typeahead = useCallback(
    (char: string, from: number) => {
      const now = Date.now();
      const state = typed.current;
      state.text = now - state.at > 800 ? char : state.text + char;
      state.at = now;
      const prefix = state.text.toLowerCase();
      for (let step = 1; step <= rows.length; step += 1) {
        const index = (from + step) % rows.length;
        const row = rows[index];
        const label = row.kind === "folder" ? row.node.name : row.resource.title;
        if (label.toLowerCase().startsWith(prefix)) {
          move(index);
          break;
        }
      }
    },
    [rows, move],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const current = rows[activeIndex];
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(rows.length - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (current?.kind === "folder") {
          if (current.expanded) move(activeIndex + 1);
          else toggle(current.id);
        }
        break;
      case "ArrowLeft": {
        event.preventDefault();
        if (current?.kind === "folder" && current.expanded) {
          toggle(current.id);
          break;
        }
        const depth = current?.depth ?? 0;
        for (let i = activeIndex - 1; i >= 0; i -= 1) {
          if (rows[i].depth < depth) {
            move(i);
            break;
          }
        }
        break;
      }
      case "Enter":
        event.preventDefault();
        if (current?.kind === "folder") toggle(current.id);
        else if (current?.kind === "file") onOpen(current.resource.url);
        break;
      default:
        if (
          event.key.length === 1 &&
          /\S/.test(event.key) &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          typeahead(event.key, activeIndex);
        }
    }
  };

  const paused = course.monitoringStatus === "paused";
  const home = courseHomeUrl(course);
  const label = courseLabel(course.id);
  const display = courseTitle(course.id, course.name);
  const raw = label?.raw ?? course.name;
  const showRaw = raw !== display;

  const lastChange = useMemo(() => {
    let latest: number | null = null;
    for (const event of events ?? []) {
      const at = parseTimestamp(event.detectedAt)?.getTime() ?? 0;
      if (at > (latest ?? 0)) latest = at;
    }
    return latest;
  }, [events]);

  const activityGroups = useMemo(() => {
    const byDay = groupEventsByDay(events ?? []);
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [events]);

  async function toggleMonitoring() {
    setBusy(true);
    try {
      await api.setMonitoring(course.id, paused ? "monitored" : "paused");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const menuItems: MenuItemSpec[] = [
    {
      id: "rebaseline",
      label: "Re-baseline course…",
      icon: <RotateCcw aria-hidden="true" />,
      onSelect: () => setConfirmRebaseline(true),
    },
    ...(home
      ? [
          {
            id: "open-page",
            label: "Open Quanta page",
            icon: <ExternalLink aria-hidden="true" />,
            onSelect: () => onOpen(home),
          },
        ]
      : []),
  ];

  const clearFilters = () => {
    setSearch("");
    setType("all");
    setCategory("all");
  };

  const renderTree = () => (
    <>
      {rows.length === 0 ? (
        <EmptyState
          title="No files match"
          body="Try a different search term or clear the filters."
          action={{ label: "Clear filters", onClick: clearFilters }}
        />
      ) : (
        <div
          className="tree-branch"
          ref={scrollRef}
          role="tree"
          aria-label={`Resources in ${display}`}
          onKeyDown={onKeyDown}
          style={virtualActive ? { maxHeight: TREE_HEIGHT, overflowY: "auto" } : undefined}
        >
          {virtualActive ? (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItems.map((item) => (
                <div
                  key={rows[item.index].id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TreeRow
                    row={rows[item.index]}
                    index={item.index}
                    focused={item.index === activeIndex}
                    query={search}
                    onToggle={toggle}
                    onOpen={onOpen}
                    onPreview={onPreview}
                    onActivate={setActiveIndex}
                  />
                </div>
              ))}
            </div>
          ) : (
            rows.map((row, index) => (
              <TreeRow
                key={row.id}
                row={row}
                index={index}
                focused={index === activeIndex}
                query={search}
                onToggle={toggle}
                onOpen={onOpen}
                onPreview={onPreview}
                onActivate={setActiveIndex}
              />
            ))
          )}
        </div>
      )}
    </>
  );

  return (
    <div>
      <PageHeader
        title={
          <span className="course-title">
            <span
              className={cx("course-dot", courseDotClass(course.id))}
              aria-hidden="true"
            />
            <span className="course-title-text" title={raw}>
              {display}
            </span>
          </span>
        }
        caption={showRaw ? raw : undefined}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={
                paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />
              }
              onClick={() => void toggleMonitoring()}
              disabled={busy}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
            {home && (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ExternalLink aria-hidden="true" />}
                onClick={() => onOpen(home)}
              >
                Open in Quanta
              </Button>
            )}
            <Menu
              label="Course actions"
              items={menuItems}
              trigger={
                <IconButton label="Course actions" size={28} tooltip={false}>
                  <MoreHorizontal aria-hidden="true" />
                </IconButton>
              }
            />
          </>
        }
      />

      <div className="stat-strip">
        <span className="stat-strip-item">
          <span className="mono">{total.toLocaleString()}</span>{" "}
          {total === 1 ? "file" : "files"}
        </span>
        <span className="stat-strip-sep" aria-hidden="true">
          ·
        </span>
        <span className="stat-strip-item">
          <span className="mono">{countNewThisWeek(events ?? [])}</span> new this week
        </span>
        <span className="stat-strip-sep" aria-hidden="true">
          ·
        </span>
        <span className="stat-strip-item">
          last change{" "}
          {lastChange == null ? "—" : relativeLabel(new Date(lastChange).toISOString())}
        </span>
        <span className="stat-strip-sep" aria-hidden="true">
          ·
        </span>
        <span className="stat-strip-item">{paused ? "Paused" : "Monitoring"}</span>
      </div>

      <div className="history-tabs">
        <ViewTabs
          items={[
            { id: "contents", label: "Contents" },
            { id: "activity", label: "Activity" },
          ]}
          value={tab}
          onChange={(id) => setTab(id as "contents" | "activity")}
          ariaLabel="Course views"
        />
      </div>

      {loadError ? (
        <Banner
          kind="error"
          action={{ label: "Retry", onClick: () => void load() }}
        >
          {loadError}
        </Banner>
      ) : loading && items === null ? (
        <Skeleton rows={8} />
      ) : total === 0 ? (
        <EmptyState
          title="This course has not been scanned yet"
          body="Quanta Pulse has not discovered any resources here. Run a sync to check again."
          action={{ label: "Sync now", onClick: onSyncNow }}
        />
      ) : tab === "contents" ? (
        <>
          <div className="course-page-toolbar">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search resources…"
              label="Search resources in this course"
            />
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as ResourceSort)}
              options={RESOURCE_SORTS.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              ariaLabel="Sort resources"
            />
            <Select
              value={type}
              onValueChange={setType}
              options={[
                { value: "all", label: "All types" },
                ...types.map((option) => ({
                  value: option.type,
                  label: `${option.type} (${option.count})`,
                })),
              ]}
              ariaLabel="Filter by file type"
            />
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as ResourceCategoryId | "all")}
              options={[
                { value: "all", label: "All categories" },
                ...categories.map((option) => ({
                  value: option.id,
                  label: `${option.label} (${option.count})`,
                })),
              ]}
              ariaLabel="Filter by category"
            />
            <span className="result-count">
              {shown} of {total}
            </span>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <span className="course-page-expand">
              {expanded.size > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setAllExpanded(false)}>
                  <FolderTree aria-hidden="true" />
                  Collapse all
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setAllExpanded(true)}>
                  <FolderTree aria-hidden="true" />
                  Expand all
                </Button>
              )}
            </span>
          </div>

          {renderTree()}
        </>
      ) : activityGroups.length === 0 ? (
        <EmptyState
          title="No recorded activity"
          body="Changes for this course appear here once a scan finds them."
        />
      ) : (
        activityGroups.map(([key, group]) => (
          <div key={key}>
            <GroupHeader label={longDayLabel(key)} count={group.length} />
            {group.map((event) => {
              const meta = eventKindMeta(event.changeType);
              return (
                <ResourceRow
                  key={event.id}
                  title={event.resourceTitle ?? event.title}
                  type={event.resourceType}
                  courseId={event.courseId}
                  courseCode={courseTitle(event.courseId, event.courseName)}
                  courseName={event.courseName}
                  unread={false}
                  selected={false}
                  unavailable={event.changeType === "unavailable"}
                  status={{ kind: STATUS_KIND[event.changeType] ?? "new", label: meta.label }}
                  timeLabel={formatTimeOfDay(event.detectedAt)}
                  openLabel={meta.label}
                  showOpen={Boolean(event.resourceUrl)}
                  onSelect={() => event.resourceUrl && onOpen(event.resourceUrl)}
                  onOpen={
                    event.resourceUrl ? () => onOpen(event.resourceUrl as string) : undefined
                  }
                  menu={[
                    {
                      id: "open-file",
                      label: "Open file",
                      onSelect: () => event.resourceUrl && onOpen(event.resourceUrl),
                    },
                  ]}
                />
              );
            })}
          </div>
        ))
      )}

      <ConfirmDialog
        open={confirmRebaseline}
        onOpenChange={setConfirmRebaseline}
        title="Re-baseline course?"
        body={
          <>
            Existing history is kept, but everything currently in{" "}
            <strong>{raw}</strong> will be treated as the new starting point,
            so it will not surface as new changes.
          </>
        }
        confirmLabel="Re-baseline"
        destructive
        onConfirm={async () => {
          await api.rebuildBaseline(course.id);
          onChanged();
        }}
      />
    </div>
  );
}
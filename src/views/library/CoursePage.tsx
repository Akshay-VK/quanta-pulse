import { resourceSectionPath } from "../../lib/sectionPath";
import { useMaterialActions } from "../../hooks/useMaterialActions";
import { getListNavigationIntent, recoverFocusedId, type ListNavigationInput } from "../../lib/listNavigation";
import { useSessionScroll, useSessionValue } from "../../hooks/useSessionViews";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMirror } from "../../hooks/useMirror";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  ExternalLink,
  Folder,
  FolderTree,
  ListFilter,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { api } from "../../lib/api";
import type { DetailsAdapter } from "../../lib/details";
import { cx } from "../../lib/cx";
import {
  buildCourseTree,
  dedupeCourseResources,
  findNode,
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
import { formatTimeOfDay, parseTimestamp } from "../../lib/format";
import { courseLabel, courseTitle, displayName } from "../../lib/courseName";
import { isLocal } from "../../lib/mirrorState";
import type { ChangeEvent, Course, Resource } from "../../lib/types";
import type { StatusKind } from "../../components/ui/StatusTag";
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
import CourseRenameDialog from "./CourseRenameDialog";
import { LibraryFooter, LibraryHeader } from "./LibraryFrame";

interface CoursePageProps {
  course: Course;
  folderPath?: string[] | null;
  /** Last complete inventory published by App; never queried again here. */
  inventory?: Resource[];
  inventoryPending?: boolean;
  inventoryError?: string | null;
  onOpen: (url: string) => void;
  onPreview: (resource: Resource) => void;
  onChanged: () => void | Promise<void>;
  /** Independent complete course Activity publication; owner may be retained. */
  activityEvents?: ChangeEvent[];
  activityCourseId?: number;
  activityPending?: boolean;
  activityError?: string | null;
  activityScopeReady?: boolean;
  onActivityChanged?: () => Promise<void>;
  onSyncNow?: () => void;
  details?: DetailsAdapter;
  /** App-managed folder navigation in the primary sidebar. */
  sidebarNavigation?: boolean;
  headerActions?: ReactNode;
  compact?: boolean;
}

const identity = (resource: Resource) => `resource:${resource.externalResourceId || `local:${resource.id}`}`;
const modalOpen = () => Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sidebar-drawer'));
interface Capture {
  generation: number;
  resourceIds: number[];
  eventIds: number[];
  action: "read" | "unread" | "dismiss";
  done: boolean;
  activity?: boolean;
}

const VIRTUAL_THRESHOLD = 200;
const EMPTY_EVENTS: ChangeEvent[] = [];

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

/** One course's page: contents tree and per-course activity. */
export default function CoursePage({
  course,
  folderPath,
  inventory,
  inventoryPending = false,
  inventoryError,
  onOpen,
  onPreview,
  onChanged,
  activityEvents,
  activityCourseId,
  activityPending = false,
  activityError,
  activityScopeReady = false,
  onActivityChanged,
  onSyncNow = () => {},
  details,
  sidebarNavigation = false,
  headerActions,
  compact = false,
}: CoursePageProps) {
  const items = useMemo(() => inventory?.filter(resource => resource.courseId === course.id) ?? null, [inventory, course.id]);
  const activityMatchingCourse = activityCourseId === course.id;
  const activityEventsList = activityMatchingCourse && Array.isArray(activityEvents) ? activityEvents : EMPTY_EVENTS;
  const events = activityMatchingCourse ? (activityEvents ?? null) : null;
  const activityGroups = useMemo(() => {
    const byDay = groupEventsByDay(activityEventsList);
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [activityEventsList]);
  const unreadResourceIds = useMemo(() => new Set(activityEventsList.filter((event) => !event.read).map((event) => event.resourceId)), [activityEventsList]);
  const activityIds = useMemo(() => activityGroups.flatMap(([, group]) => group.map((event) => `change:${event.id}`)), [activityGroups]);
  const activityScopeReadyEffective = activityMatchingCourse && Boolean(activityScopeReady) && !activityPending && !activityError && Array.isArray(activityEvents);
  const loading = inventoryPending;
  const loadError = activityMatchingCourse ? (activityError ?? null) : null;
  const [busy, setBusy] = useState(false);
  const [confirmRebaseline, setConfirmRebaseline] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const [tab, setTab] = useSessionValue<"contents" | "activity">(`course:${course.id}:tab`, "contents");
  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current !== tab) details?.clear();
    previousTab.current = tab;
  }, [tab, details]);
  const [search, setSearch] = useSessionValue(`course:${course.id}:search`, "");
  const [sort, setSort] = useSessionValue<ResourceSort>(`course:${course.id}:sort`, "newest");
  const [type, setType] = useSessionValue(`course:${course.id}:type`, "all");
  const [category, setCategory] = useSessionValue<ResourceCategoryId | "all">(`course:${course.id}:category`, "all");
  const [expanded, setExpanded] = useSessionValue<Set<string>>(`course:${course.id}:expanded`, new Set());
  const [selectedFolder, setSelectedFolder] = useSessionValue<string[]>(`course:${course.id}:folder`, []);
  const [showFilters, setShowFilters] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [initialised, setInitialised] = useSessionValue(`course:${course.id}:initialised`, false);

  const unique = useMemo(() => dedupeCourseResources(items ?? []), [items]);
  const types = useMemo(() => typeOptions(unique), [unique]);
  const categories = useMemo(() => categoryOptions(unique), [unique]);

  const needle = search.trim();
  const searching = needle !== "";
  const typeFilter = type === "all" ? "" : type;
  const pathInSidebar = sidebarNavigation ? folderPath : undefined;
  const folderName = pathInSidebar?.at(-1);
  const scoped = useMemo(() => {
    if (!pathInSidebar?.length) return unique;
    return unique.filter(resource => {
      const path = resourceSectionPath(resource);
      return pathInSidebar.every((segment, index) => path[index] === segment);
    });
  }, [unique, pathInSidebar]);

  const filtered = useMemo(
    () => filterCourseResources(scoped, { type: typeFilter, category }),
    [scoped, typeFilter, category],
  );
  const searchResults = useMemo(
    () =>
      searching
        ? sortResources(filterCourseResources(scoped, { search, type: typeFilter, category }), sort)
        : [],
    [searching, scoped, search, typeFilter, category, sort],
  );
  const tree = useMemo(() => buildCourseTree(filtered, course.name), [filtered, course.name]);
  const activeFolder = findNode(tree, sidebarNavigation ? folderPath ?? [] : selectedFolder) ?? tree;
  const compactFolders = useMemo(() => {
    const flatten = (node: CourseTreeNode): CourseTreeNode[] => [node, ...node.children.flatMap(flatten)];
    return flatten(tree);
  }, [tree]);

  const rows = useMemo<FlatRow[]>(() => {
    if (searching) {
      return searchResults.map((resource) => ({
        kind: "file",
        id: identity(resource),
        resource,
        depth: 0,
        searching: true,
      }));
    }
    if (sidebarNavigation) {
      return sortResources(filtered, sort).map(resource => ({
        kind: "file", id: identity(resource), resource, depth: 0, searching: false,
      }));
    }
    const out: FlatRow[] = [];
    const addFiles = (node: CourseTreeNode, depth: number) => {
      for (const resource of sortResources(node.resources, sort)) {
        out.push({ kind: "file", id: identity(resource), resource, depth, searching: false });
      }
    };
    const walk = (node: CourseTreeNode, depth: number) => {
      if (activeFolder === tree) addFiles(node, depth);
      else if (node === activeFolder) {
        const walkFiles = (folder: CourseTreeNode, level: number) => {
          addFiles(folder, level);
          folder.children.forEach((child) => walkFiles(child, level + 1));
        };
        walkFiles(node, depth);
      }
      for (const child of node.children) {
        if (!compact) {
          out.push({
            kind: "folder",
            id: `folder:${child.id}`,
            node: child,
            depth,
            expanded: expanded.has(child.id),
          });
        }
        if (expanded.has(child.id)) walk(child, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [searching, searchResults, tree, sort, expanded, activeFolder, compact, sidebarNavigation, filtered]);

  const selectedResourceId = details?.selected?.kind === "resource" ? details.selected.resource.id : null;
  const selectedDetails = details?.selected;
  useEffect(() => {
    if (details && selectedResourceId !== null && !rows.some((row) => row.kind === "file" && row.resource.id === selectedResourceId)) {
      details?.clear();
    }
  }, [details, rows, selectedResourceId]);

  useEffect(() => {
    if (selectedDetails?.kind === "resource" && selectedDetails.owner === "library" && selectedDetails.resource.courseId !== course.id) {
      details?.clear();
    }
    if (selectedDetails?.kind === "change" && selectedDetails.owner === "library" && !events?.some((event) => event.id === selectedDetails.change.id)) {
      details?.clear();
    }
  }, [course.id, details, events, selectedDetails]);

  const isSelectedResourceRow = (row: FlatRow) => row.kind === "file" && selectedResourceId === row.resource.id;

  // Open the two most recently changed sections the first time this course is
  // shown in a session, then remember whatever the user does.
  useEffect(() => {
    if (sidebarNavigation || loading || items === null) return;
    if (initialised) return;
    setInitialised(true);
    setExpanded(new Set(pickDefaultSections(tree.children, latestIn)));
  }, [sidebarNavigation, loading, items, initialised, setInitialised, setExpanded, tree]);

  useEffect(() => {
    if (!sidebarNavigation || !folderPath?.length) return;
    setTab("contents");
    setSearch("");
  }, [sidebarNavigation, folderPath, setTab, setSearch]);

  const pathIdentity = JSON.stringify(folderPath ?? []);
  const scrollScope = folderName ? `course:${course.id}:${tab}:${pathIdentity}` : `course:${course.id}:${tab}`;
  const appliedPath = useRef<string | null>(null);
  useEffect(() => {
    if (sidebarNavigation || loading || appliedPath.current === pathIdentity) return;
    appliedPath.current = pathIdentity;
    if (!folderPath?.length) return;
    const ids: string[] = [];
    const walk = (node: CourseTreeNode) => {
      for (const child of node.children) {
        if (child.path.every((segment, index) => folderPath[index] === segment)) ids.push(child.id);
        walk(child);
      }
    };
    walk(tree);
    setTab("contents");
    setSelectedFolder(folderPath);
    setExpanded((previous) => new Set([...previous, ...ids]));
    // Only a new route path expands folders; background refresh preserves explicit collapse.
  }, [pathIdentity, loading, sidebarNavigation]);

  const shown = searching ? searchResults.length : filtered.length;
  const total = scoped.length;
  const filtersActive = type !== "all" || category !== "all" || searching;

  const toggle = useCallback(
    (id: string) => {
      const path = JSON.parse(id) as string[];
      if (expanded.has(id) && path.every((segment, index) => selectedFolder[index] === segment)) {
        setSelectedFolder(path.slice(0, -1));
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [expanded, selectedFolder, setExpanded, setSelectedFolder],
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

  // Local mirror stats for this course (derived from the global mirror).
  const mirror = useMirror();

  const setAllExpanded = (expand: boolean) => {
    const next = new Set(expand ? allFolderIds() : []);
    setExpanded(next);
    if (!expand) setSelectedFolder([]);
  };

  const chooseFolder = (node: CourseTreeNode) => {
    setSelectedFolder(node.path);
    setExpanded((previous) => new Set([
      ...previous,
      ...node.path.map((_, index) => JSON.stringify(node.path.slice(0, index + 1))),
    ]));
  };

  const treeRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainScroll = useRef<HTMLDivElement>(null);
  useSessionScroll(`${scrollScope}:main`, mainScroll, items !== null);
  const pendingFocus = useRef<string | null>(null);
  const ownedFocus = useRef(false);
  const previousRows = useRef<FlatRow[]>([]);
  const ids = useMemo(() => rows.map(row => row.id), [rows]);
  const rowIndices = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids]);
  const oldFocus = previousRows.current.find(row => row.id === focusedId);
  // Collapsing a descendant returns to its nearest surviving folder.
  const ancestor = oldFocus && !ids.includes(oldFocus.id) && !searching
    ? [...previousRows.current].reverse().find(row => row.kind === "folder" && ids.includes(row.id) &&
        (oldFocus.kind === "folder" ? oldFocus.node.path : resourceSectionPath(oldFocus.resource))
          .slice(0, row.node.path.length).join("\0") === row.node.path.join("\0"))
    : undefined;
  const currentFocus = ancestor?.id ?? recoverFocusedId(previousRows.current.map(row => row.id), ids, focusedId);
  const activeIndex = Math.max(0, ids.indexOf(currentFocus ?? ""));
  const fileRows = useMemo(() => rows.filter((row) => row.kind === "file"), [rows]);
  const folderRows = useMemo(() => rows.filter((row) => row.kind === "folder"), [rows]);
  const virtualActive = fileRows.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: virtualActive ? fileRows.length : 0,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => fileRows[index].id,
    estimateSize: () => searching ? 48 : 34,
    overscan: 10,
  });
  const virtualItems = virtualActive ? virtualizer.getVirtualItems() : [];
  useSessionScroll(`${scrollScope}:tree`, scrollRef, items !== null && (!virtualActive || virtualItems.length > 0));
  const latestNavigation = useRef({ rows, fileRows, currentFocus, tab, virtualActive });
  latestNavigation.current = { rows, fileRows, currentFocus, tab, virtualActive };
  const focusIdentity = useCallback((id: string | null) => {
    if (latestNavigation.current.tab !== "contents" || !searchRef.current?.isConnected || modalOpen()) return false;
    const currentRows = latestNavigation.current.rows;
    const index = currentRows.findIndex(row => row.id === id);
    if (index < 0) { pendingFocus.current = null; searchRef.current.focus(); return true; }
    setFocusedId(id);
    pendingFocus.current = id;
    const element = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(el => el.dataset.rowKey === id);
    // Redirect a preceding virtual scroll even when this target is mounted.
    const fileIndex = latestNavigation.current.fileRows.findIndex((row) => row.id === id);
    if (latestNavigation.current.virtualActive && fileIndex >= 0) virtualizer.scrollToIndex(fileIndex, { align: "auto" });
    if (element) { pendingFocus.current = null; element.focus(); }
    return true;
  }, [virtualizer]);
  const move = useCallback((index: number) => {
    focusIdentity(rows[Math.max(0, Math.min(rows.length - 1, index))]?.id ?? null);
  }, [rows, focusIdentity]);
  useLayoutEffect(() => {
    const changed = previousRows.current.map(row => row.id).join("\0") !== ids.join("\0");
    previousRows.current = rows;
    setFocusedId(currentFocus);
    if (changed && ownedFocus.current && !modalOpen()) focusIdentity(currentFocus);
  }, [rows, ids, currentFocus, focusIdentity]);
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    if (modalOpen() || tab !== "contents" || !ids.includes(id)) { pendingFocus.current = null; return; }
    const element = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(el => el.dataset.rowKey === id);
    if (element) { pendingFocus.current = null; element.focus(); }
  });
  const restore = (id: string | null) => focusIdentity(
    latestNavigation.current.rows.some(row => row.id === id) ? id : latestNavigation.current.currentFocus);
  const restoreActivity = (id: string | null) => {
    const target = id && activityRows.current.has(id) ? id : activityFocusedId;
    const row = target ? activityRows.current.get(target) : null;
    if (row?.isConnected) { setActivityFocusedId(target); row.focus(); return true; }
    return false;
  };
  const inspect = (resource: Resource, origin: HTMLElement) => {
    const id = identity(resource);
    details?.selectResource(resource, origin, () => restore(id));
  };
  const [selection, setSelection] = useState<string[]>([]);
  const matching = useMemo(() => {
    if (searching) return searchResults;
    if (sidebarNavigation) return filtered;
    if (activeFolder === tree) return filtered;
    return filtered.filter((resource) => {
      const path = resourceSectionPath(resource);
      return activeFolder.path.every((segment, index) => path[index] === segment);
    });
  }, [activeFolder, filtered, searchResults, searching, tree, sidebarNavigation]);
  const matchingIds = useMemo(() => matching.map(identity), [matching]);
  useEffect(() => { setSelection(prev => prev.filter(id => matchingIds.includes(id))); }, [matchingIds]);
  const [activitySelection, setActivitySelection] = useState<string[]>([]);
  const [activityFocusedId, setActivityFocusedId] = useState<string | null>(null);
  const activityRows = useRef(new Map<string, HTMLButtonElement>());
  const activityPreviousIds = useRef<string[]>([]);
  const activityOwnedFocus = useRef(false);
  useEffect(() => { setActivitySelection(prev => { const next = prev.filter(id => activityIds.includes(id)); return next.length === prev.length ? prev : next; }); }, [activityIds]);
  useEffect(() => {
    const recovered = recoverFocusedId(activityPreviousIds.current, activityIds, activityFocusedId);
    const owned = activityOwnedFocus.current && (document.activeElement === document.body || (document.activeElement instanceof HTMLElement && document.activeElement.matches(".row-select")));
    activityPreviousIds.current = activityIds;
    if (recovered !== activityFocusedId) {
      setActivityFocusedId(recovered);
      if (owned) (recovered ? activityRows.current.get(recovered) : null)?.focus();
    }
  }, [activityIds, activityFocusedId]);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshWait, setRefreshWait] = useState<{ resolve: (error: string | null) => void } | null>(null);
  useEffect(() => {
    if (refreshWait && !inventoryPending) {
      refreshWait.resolve(inventoryError ?? null);
      setRefreshWait(null);
    }
  }, [refreshWait, inventoryError, inventoryPending]);
  const waitRef = useRef(refreshWait);
  waitRef.current = refreshWait;
  const [activityRefreshWait, setActivityRefreshWait] = useState<{ resolve: (error: string | null) => void } | null>(null);
  useEffect(() => {
    if (activityRefreshWait && !activityPending) {
      activityRefreshWait.resolve(activityError ?? null);
      setActivityRefreshWait(null);
    }
  }, [activityRefreshWait, activityError, activityPending]);
  const activityWaitRef = useRef(activityRefreshWait);
  activityWaitRef.current = activityRefreshWait;
  const generation = useRef(0);
  const lock = useRef<number | null>(null);
  const context = JSON.stringify([course.id, folderPath, selectedFolder, tab, search, type, category, sort]);
  useLayoutEffect(() => {
    generation.current += 1;
    lock.current = null;
    setCapture(null);
    setStatus(null);
    setRefreshWait(null);
    return () => { generation.current += 1; lock.current = null; pendingFocus.current = null; waitRef.current?.resolve(null); activityWaitRef.current?.resolve(null); };
  }, [context]);
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

  const mutate = async (scope: Capture) => {
    const token = scope.generation;
    if (generation.current !== token || lock.current !== null) return;
    lock.current = token;

    setStatus(null);
    try {
      if (!scope.done) {
        if (scope.action === "dismiss") await api.dismissInboxEvents(scope.eventIds);
        else await api.setEventReadState(scope.eventIds, scope.action === "read");
        // Remember backend success even if refresh subsequently fails.
        scope.done = true;
      }
      if (generation.current !== token) return;
      await onChanged();
      if (generation.current !== token) return;
      // App reports refresh failure through props, after its promise completes.
      // A render acknowledgement observes that publication before closing.
      const refreshError = await new Promise<string | null>(resolve => setRefreshWait({ resolve }));
      if (generation.current !== token) return;
      if (refreshError) throw new Error(`Changes saved; inventory refresh failed: ${refreshError}`);
      setStatus("Captured changes saved.");
    } catch (error) {
      if (generation.current !== token) return;
      setStatus(`${scope.done ? "Changes saved; retry refresh only. " : ""}${String(error)}`);
      throw error;
    } finally {
      if (generation.current === token && lock.current === token) { lock.current = null; }
    }
  };
  const mutateActivity = async (scope: Capture) => {
    const token = scope.generation;
    if (generation.current !== token || lock.current !== null) return;
    lock.current = token;

    setStatus(null);
    try {
      if (!scope.done) {
        if (scope.action === "dismiss") await api.dismissInboxEvents(scope.eventIds);
        else await api.setEventReadState(scope.eventIds, scope.action === "read");
        scope.done = true;
      }
      if (generation.current !== token) return;
      await onActivityChanged?.();
      if (generation.current !== token) return;
      const refreshError = await new Promise<string | null>(resolve => setActivityRefreshWait({ resolve }));
      if (generation.current !== token) return;
      if (refreshError) throw new Error(`Changes saved; inventory refresh failed: ${refreshError}`);
      setStatus("Captured changes saved.");
    } catch (error) {
      if (generation.current !== token) return;
      setStatus(`${scope.done ? "Changes saved; retry refresh only. " : ""}${String(error)}`);
      throw error;
    } finally {
      if (generation.current === token && lock.current === token) { lock.current = null; }
    }
  };

  const beginCapture = async (targetIds: readonly string[], action: Capture["action"], confirm: boolean, policy: ListNavigationInput) => {
    if (lock.current !== null || capture) return;
    if (!inventory || inventoryPending || inventoryError) {
      setStatus(inventoryError ? "Inventory refresh failed. Retry loading before changing events." : "Inventory is refreshing. Wait before changing events.");
      return;
    }
    const resourceIds = matching.filter(resource => targetIds.includes(identity(resource))).map(resource => resource.id);
    if (!resourceIds.length) { setStatus("No matching materials to capture."); return; }
    const token = ++generation.current;
    lock.current = token;

    setStatus("Capturing recorded changes…");
    try {
      const snapshot = await api.snapshotResourceEventIds([...resourceIds]);
      if (generation.current !== token) return;
      const intent = getListNavigationIntent({ ...policy, completeEventIds: snapshot });
      const eventIds = intent?.type === "openCapturedScope" ? [...intent.eventIds] : [...snapshot];
      if (!eventIds.length) { setStatus("No eligible recorded changes in the captured scope."); return; }
      const scope: Capture = { generation: token, resourceIds, eventIds, action, done: false };
      lock.current = null;
      if (confirm) { setStatus(null); setCapture(scope); }
      else {
        try { await mutate(scope); }
        catch { if (generation.current === token) setCapture(scope); }
      }
    } catch (error) {
      if (generation.current === token) setStatus(`Could not capture changes: ${String(error)}. Try the shortcut again.`);
    } finally {
      if (generation.current === token && (lock.current === token || lock.current === null)) { lock.current = null; }
    }
  };
  const beginActivityCapture = useCallback(async (targetIds: readonly (string | number)[], action: Capture["action"], confirm: boolean) => {
    if (lock.current !== null || capture) return;
    if (!activityScopeReadyEffective) {
      setStatus(activityError ? "Activity refresh failed. Retry loading before changing events." : "Activity is refreshing. Wait before changing events.");
      return;
    }
    const rowIds = targetIds.map((value) => (typeof value === "number" ? `change:${value}` : value));
    const eventIds = [...new Set(rowIds.map((value) => Number(String(value).replace(/^change:/, ""))).filter((value) => Number.isSafeInteger(value) && value > 0))];
    const matchingEvents = activityEventsList.filter((event) => eventIds.includes(event.id));
    const eligibleEvents = matchingEvents.filter((event) => event.changeType !== "baseline");
    const eligibleIds = [...new Set(eligibleEvents.map((event) => event.id))];
    if (!eligibleIds.length) { setStatus("No eligible recorded changes in the captured scope."); return; }
    const resourceIds = [...new Set(eligibleEvents.map((event) => event.resourceId).filter((value): value is number => typeof value === "number"))];
    const token = ++generation.current;
    lock.current = token;
    setStatus("Capturing recorded changes…");
    try {
      const scope: Capture = { generation: token, resourceIds, eventIds: eligibleIds, action, done: false, activity: true };
      lock.current = null;
      if (confirm) { setStatus(null); setCapture(scope); }
      else {
        try { await mutateActivity(scope); }
        catch { if (generation.current === token) setCapture(scope); }
      }
    } catch (error) {
      if (generation.current === token) setStatus(`Could not capture changes: ${String(error)}. Try the shortcut again.`);
    } finally {
      if (generation.current === token && (lock.current === token || lock.current === null)) { lock.current = null; }
    }
  }, [activityScopeReadyEffective, activityError, activityEventsList, capture, mutateActivity]);

  const destinations = useMaterialActions({ onOpen, onPreview });
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const native = event.nativeEvent;
    const input: ListNavigationInput = {
      ids, focusedId: currentFocus, inspectedId: null,
      selectedIds: selection, key: event.key,
      activeSurface: tab === "contents" && target.matches('[role="treeitem"]'),
      editableTarget: Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')),
      nestedControl: Boolean(target.closest('button, a, [role="button"], [role="checkbox"]')),
      modalOpen: modalOpen(), isComposing: native.isComposing, imeKeyCode229: event.keyCode === 229,
      repeat: event.repeat, defaultPrevented: event.defaultPrevented,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, completeEventIds: [],
    };
    if (!input.activeSurface || input.editableTarget || input.nestedControl || input.modalOpen || input.isComposing ||
        input.imeKeyCode229 || input.repeat || input.defaultPrevented || input.ctrlKey || input.altKey || input.metaKey) return;
    const current = rows[activeIndex];
    const intent = getListNavigationIntent(input);
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (intent) {
      handled();
      if (intent.type === "focus") focusIdentity(intent.id);
      else if (intent.type === "openCapturedScope") void beginCapture(matchingIds, "read", true, input);
      else if (current?.kind === "folder") {
        if (intent.type === "inspect") chooseFolder(current.node);
      } else if (current?.kind === "file") {
        if (intent.type === "toggleSelection") setSelection(prev => prev.includes(current.id) ? prev.filter(id => id !== current.id) : [...prev, current.id]);
        else if (intent.type === "inspect") inspect(current.resource, target);
        else if (intent.type === "preview") destinations?.(current.resource).find(action => action.id === "preview")?.onSelect?.();
        else {
          // Action policy sees all matching files, including collapsed selections.
          const action = getListNavigationIntent({ ...input, ids: matchingIds });
          if (action?.type === "confirmDelete") void beginCapture(action.ids, "dismiss", true, input);
          else if (action?.type === "setReadState") void beginCapture(action.ids, action.isRead ? "read" : "unread", false, input);
        }
      }
      return;
    }
    if (event.shiftKey) return;
    if (sidebarNavigation && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
    switch (event.key) {
      case "Home": handled(); move(0); break;
      case "End": handled(); move(rows.length - 1); break;
      case "ArrowRight":
        handled();
        if (current?.kind === "folder") { if (current.expanded) move(activeIndex + 1); else toggle(current.node.id); }
        break;
      case "ArrowLeft": {
        handled();
        if (current?.kind === "folder" && current.expanded) toggle(current.node.id);
        else for (let i = activeIndex - 1; i >= 0; i--) if (rows[i].depth < (current?.depth ?? 0)) { move(i); break; }
        break;
      }
      default:
        if (event.key.length === 1 && /\S/.test(event.key) && !/[g/?]/i.test(event.key)) typeahead(event.key, activeIndex);
    }
  };

  const onActivityKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const rowControl = target?.closest<HTMLButtonElement>(".row-select");
    const id = [...activityRows.current].find(([, node]) => node === rowControl)?.[0] ?? activityFocusedId;
    const eligible = (ids: readonly string[]) => {
      const matching = new Set(ids);
      return activityEventsList
        .filter((eventItem) => matching.has(`change:${eventItem.id}`) && Number.isSafeInteger(eventItem.id) && eventItem.id > 0 && eventItem.changeType !== "baseline")
        .map((eventItem) => eventItem.id);
    };
    const input: ListNavigationInput = {
      ids: activityIds,
      focusedId: id,
      inspectedId: details?.selected?.kind === "change" ? `change:${details.selected.change.id}` : null,
      selectedIds: activitySelection,
      key: event.key,
      activeSurface: tab === "activity" && Boolean(rowControl),
      editableTarget: Boolean(target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])")),
      nestedControl: !rowControl,
      modalOpen: modalOpen() || capture !== null,
      isComposing: event.nativeEvent.isComposing,
      imeKeyCode229: event.keyCode === 229,
      repeat: event.repeat,
      defaultPrevented: event.defaultPrevented,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      completeEventIds: eligible(activityIds),
    };
    if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])")) return;
    const intent = getListNavigationIntent(input);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    if (intent.type === "focus") {
      setActivityFocusedId(intent.id);
      activityRows.current.get(intent.id)?.focus();
      return;
    }
    if (intent.type === "toggleSelection") {
      setActivitySelection((prev) => (prev.includes(intent.id) ? prev.filter((value) => value !== intent.id) : [...prev, intent.id]));
      return;
    }
    if (intent.type === "inspect" || intent.type === "preview") {
      const recorded = activityEventsList.find((item) => `change:${item.id}` === intent.id);
      if (!recorded) return;
      const currentResource = unique.find((resource) => resource.id === recorded.resourceId) ?? null;
      if (intent.type === "preview") {
        destinations?.(currentResource, recorded).find((action) => action.id === "preview")?.onSelect?.();
      } else {
        const origin = activityRows.current.get(intent.id);
        if (origin) details?.selectChange(recorded, origin, currentResource, () => restoreActivity(intent.id));
      }
      return;
    }
    if (!activityScopeReadyEffective || activityPending || activityError || capture || lock.current !== null || !onActivityChanged) return;
    if (intent.type === "openCapturedScope") void beginActivityCapture(activityIds, "read", true);
    else if (intent.type === "setReadState") void beginActivityCapture(intent.ids, intent.isRead ? "read" : "unread", false);
    else if (intent.type === "confirmDelete") void beginActivityCapture(intent.ids, "dismiss", true);
  };

  const paused = course.monitoringStatus === "paused";
  const home = courseHomeUrl(course);
  const label = courseLabel(course.id);
  const display = courseTitle(course.id, displayName(course));
  const raw = label?.raw ?? course.name;
  const code = course.shortName?.trim() || course.externalCourseId;
  const title = display === code || display.startsWith(`${code} · `) ? display : `${code} · ${display}`;


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
      id: "rename",
      label: "Rename course",
      icon: <Pencil aria-hidden="true" />,
      onSelect: () => setRenameOpen(true),
    },
    {
      id: "monitor",
      label: paused ? "Resume monitoring" : "Pause monitoring",
      icon: paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />,
      onSelect: () => void toggleMonitoring(),
    },
    ...(home
      ? [
          {
            id: "open-page",
            label: "Open in Quanta",
            icon: <ExternalLink aria-hidden="true" />,
            onSelect: () => onOpen(home),
          },
        ]
      : []),
    { id: "divider", label: "", divider: true },
    {
      id: "rebaseline",
      label: "Reset baseline…",
      icon: <RotateCcw aria-hidden="true" />,
      danger: true,
      onSelect: () => setConfirmRebaseline(true),
    },
  ];

  const clearFilters = () => {
    setSearch("");
    setType("all");
    setCategory("all");
  };

  const renderFile = (row: (typeof fileRows)[number]) => (
    <TreeRow
      key={row.id}
      row={row}
      index={rowIndices.get(row.id) ?? 0}
      focused={row.id === currentFocus}
      query={search}
      onToggle={toggle}
      onOpen={onOpen}
      onPreview={onPreview}
      onActivate={(index) => setFocusedId(rows[index].id)}
      selected={isSelectedResourceRow(row)}
      multiSelected={selection.includes(row.id)}
      saved={Boolean(mirror && isLocal(mirror.statusOf(row.resource.id)))}
      unread={unreadResourceIds.has(row.resource.id)}
      compactCourse={compact ? { id: course.id, code, name: display } : undefined}
      onSelect={inspect}
    />
  );

  const emptyCourse = (state: "error" | "empty" | "search") => {
    const Icon = state === "error" ? AlertCircle : state === "empty" ? Folder : Search;
    const title = state === "error" ? "Couldn’t load this course" : state === "empty" ? "Nothing here yet" : "No files match your search";
    const body = state === "error"
      ? `Pulse couldn’t read the course from the local library. Your saved files are not affected. ${inventoryError ?? ""}`
      : state === "empty"
        ? folderName ? "This folder has no materials." : "This course has no materials on Quanta. New files will appear here as soon as they are posted."
        : searching ? `Nothing in ${folderName ?? code} matches “${needle}”.` : "Try another file type or category.";
    return (
      <div className="library-empty">
        <span className="library-empty-icon"><Icon aria-hidden="true" /></span>
        <p className="empty-title">{title}</p>
        <p className="empty-body">{body}</p>
        {state === "error" && <Button variant="primary" size="sm" onClick={() => void onChanged()}>Retry</Button>}
        {state === "empty" && <Button size="sm" onClick={() => home ? onOpen(home) : onSyncNow()}>{home ? "Open in Quanta" : "Sync now"}</Button>}
        {state === "search" && <Button variant="primary" size="sm" onClick={clearFilters}>{searching ? "Clear search" : "Clear filters"}</Button>}
      </div>
    );
  };
  const renderTree = () => (
    <div
      className={cx("course-materials", compact && "is-compact", searching && "course-materials-search")}
      ref={treeRef}
      role="tree"
      aria-label={`Resources in ${display}`}
      onKeyDown={onKeyDown}
      aria-multiselectable="true"
      onFocusCapture={(event) => { ownedFocus.current = event.target === event.currentTarget || (event.target as HTMLElement).matches('[role="treeitem"]'); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) { ownedFocus.current = false; pendingFocus.current = null; }
      }}
    >
      {!sidebarNavigation && !searching && !compact && <div className="course-folder-rail" role="group" aria-label="Folders">
        <button type="button" className={cx("course-folder-link", activeFolder === tree && "is-current")} aria-current={activeFolder === tree ? "true" : undefined} onClick={() => chooseFolder(tree)}>
          <Folder aria-hidden="true" /> <span>Course materials</span> <span className="tree-count">{total}</span>
        </button>
        {folderRows.map((row) => (
          <TreeRow
            key={row.id}
            row={row}
            index={rowIndices.get(row.id) ?? 0}
            focused={row.id === currentFocus}
            query={search}
            onToggle={toggle}
            onChooseFolder={chooseFolder}
            folderSelected={row.node === activeFolder}
            onOpen={onOpen}
            onPreview={onPreview}
            onActivate={(index) => setFocusedId(rows[index].id)}
            onSelect={inspect}
          />
        ))}
      </div>}
      <div className="course-material-table">
        {(total === 0 || (filtersActive && rows.length === 0)) ? emptyCourse(total > 0 ? "search" : inventoryError ? "error" : "empty") : (
          <>
            <div className="course-material-columns" aria-hidden="true"><span>Name</span><span>Section</span><span>Detected</span><span /></div>
            <GroupHeader
              label={searching ? `${shown} ${shown === 1 ? "match" : "matches"}` : sidebarNavigation && folderPath?.length ? folderPath.join(" / ") : activeFolder === tree ? "Course materials" : activeFolder.path.slice(-2).join(" / ")}
              count={fileRows.length}
            />
            <div className="tree-branch" ref={scrollRef} role="group" aria-label="Materials">
              {virtualActive ? (
                <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
                  {virtualItems.map((item) => (
                    <div
                      key={fileRows[item.index].id}
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
                      {renderFile(fileRows[item.index])}
                    </div>
                  ))}
                </div>
              ) : fileRows.map(renderFile)}
            </div>
          </>
        )}
      </div>
    </div>
  );

  const visibleCount = fileRows.length;
  const footer = tab === "activity" ? `Recorded changes in ${code}`
    : inventoryError && total === 0 ? "Loading failed"
    : total === 0 ? "0 materials"
    : searching ? `${shown} ${shown === 1 ? "match" : "matches"}${shown > 0 ? ` in ${code}` : ""}`
    : `Library / ${[code, ...(sidebarNavigation ? folderPath ?? [] : activeFolder.path)].join(" / ")} · ${visibleCount.toLocaleString()} ${visibleCount === 1 ? "material" : "materials"}`;

  return (
    <div className={cx("library-panel", "course-panel", details?.selected && "has-library-inspector")}>
      <LibraryHeader
        title={<span title={raw}><span className="course-full-title">{title}</span><span className="course-compact-title">{code}</span></span>}
        tabs={<ViewTabs
          className="library-tabs"
          items={[
            { id: "contents", label: "Materials" },
            { id: "activity", label: "Activity" },
          ]}
          value={tab}
          onChange={(id) => setTab(id as "contents" | "activity")}
          ariaLabel="Course views"
        />}
        actions={<>
          {tab === "contents" && <IconButton label="Filter materials" size={28} onClick={() => setShowFilters((open) => !open)} aria-expanded={showFilters}>
            <ListFilter aria-hidden="true" />
          </IconButton>}
          <Menu label="Course actions" items={menuItems} trigger={
            <IconButton label="Course actions" size={28} tooltip={false} disabled={busy}>
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          } />
          {headerActions}
        </>}
      />
      <div className="library-panel-scroll course-panel-scroll" ref={mainScroll}>
      {tab === "contents" && (status || (inventoryError && total > 0) || (inventoryPending && total > 0)) && (
        <Banner kind={inventoryError ? "error" : "info"} action={inventoryError ? { label: "Retry", onClick: () => void onChanged() } : undefined}>
          {status ?? (inventoryError ? `Inventory refresh failed: ${inventoryError}. Retained materials remain inspectable; new changes are blocked.` : "Inventory unavailable or refreshing; new changes are blocked.")}
        </Banner>
      )}
      {tab === "contents" && <span role="status" className="sr-only">{selection.length} {selection.length === 1 ? "material" : "materials"} selected</span>}
      {tab === "activity" && loadError && (
        <Banner kind="error" action={{ label: "Retry", onClick: () => void (onActivityChanged?.() ?? onChanged()) }}>
          {loadError}
        </Banner>
      )}
      {tab === "contents" && (items === null || (inventoryPending && total === 0)) && !inventoryError ? (
        loading ? <Skeleton rows={8} /> : null
      ) : tab === "contents" ? (
        <>
          {searching && shown > 0 && <div className="library-toolbar course-search-summary">
            <Button variant="ghost" size="sm" leadingIcon={<ListFilter aria-hidden="true" />} aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)}>Filter</Button>
            <Button variant="secondary" size="sm" trailingIcon={<X aria-hidden="true" />} onClick={() => setSearch("")}>Search “{needle}”</Button>
            <span className="library-toolbar-end">Flat matches show their original section path</span>
          </div>}
          {!sidebarNavigation && !searching && <div className="library-toolbar course-compact-toolbar">
            <Select value={activeFolder.id} onValueChange={(id) => {
              const folder = compactFolders.find((node) => node.id === id);
              if (folder) chooseFolder(folder);
            }} options={compactFolders.map((node) => ({ value: node.id, label: node === tree ? "Course materials" : node.path.join(" / ") }))} ariaLabel="Course folder" />
            <span className="library-toolbar-end">{visibleCount} {visibleCount === 1 ? "material" : "materials"}</span>
          </div>}
          <div className={cx("library-toolbar course-page-toolbar", !showFilters && "library-search-collapsed", !headerActions && "library-filters-standalone")}>
            <SearchField
              inputRef={searchRef}
              value={search}
              onChange={setSearch}
              placeholder="Search resources…"
              label={folderName ? `Search resources in ${folderName}` : "Search resources in this course"}
              debounceMs={0}
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
            <span className="result-count">{shown} of {total}</span>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
              {mirror?.stats && mirror.stats.done < mirror.stats.totalResources && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void mirror.startBackfill()}
                  disabled={mirror.stats.state === "running" || mirror.stats.state === "paused"}
                >
                  Download all
                </Button>
              )}
              {!sidebarNavigation && <span className="course-page-expand">
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
            </span>}
          </div>

          {renderTree()}
        </>
      ) : (activityPending || !activityMatchingCourse) && activityGroups.length === 0 ? (
        <Skeleton rows={8} />
      ) : activityGroups.length === 0 ? (
        <EmptyState
          title="No recorded activity"
          body="Changes for this course appear here once a scan finds them."
        />
      ) : (
        <div
          className="activity-list"
          onKeyDown={onActivityKeyDown}
          onFocusCapture={(event) => { activityOwnedFocus.current = event.target instanceof HTMLElement && event.target.matches(".row-select"); }}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) activityOwnedFocus.current = false; }}
        >
          {activityGroups.map(([key, group]) => (
            <div key={key}>
              <GroupHeader label={longDayLabel(key)} count={group.length} />
              {group.map((event) => {
                const meta = eventKindMeta(event.changeType);
                const currentResource = unique.find((resource) => resource.id === event.resourceId) ?? null;
                const identityId = `change:${event.id}`;
                return (
                  <ResourceRow
                    resource={currentResource}
                    recorded={event}
                    key={event.id}
                    title={event.resourceTitle ?? event.title}
                    type={event.resourceType}
                    courseId={event.courseId}
                    courseCode={courseTitle(event.courseId, event.courseName)}
                    courseName={event.courseName}
                    unread={false}
                    selected={details?.selected?.kind === "change" && details.selected.change.id === event.id}
                    unavailable={event.changeType === "unavailable"}
                    status={{ kind: STATUS_KIND[event.changeType] ?? "new", label: meta.label }}
                    timeLabel={formatTimeOfDay(event.detectedAt)}
                    onSelect={(origin) => details?.selectChange(event, origin, currentResource, () => restoreActivity(identityId))}
                    local={currentResource && !currentResource.isExternal ? mirror?.statusOf(currentResource.id) : undefined}
                    menu={[]}
                    keyboardFocused={activityFocusedId === identityId}
                    multiSelected={activitySelection.includes(identityId)}
                    tabStop={activityFocusedId === identityId || (!activityFocusedId && activityIds[0] === identityId)}
                    selectRef={(node) => { if (node) activityRows.current.set(identityId, node); else activityRows.current.delete(identityId); }}
                    onKeyboardFocus={() => setActivityFocusedId(identityId)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      </div>
      <LibraryFooter course folders={!sidebarNavigation && tab === "contents"}>{footer}</LibraryFooter>
      {capture && <ConfirmDialog key={capture.generation} open onOpenChange={open => {
        if (!open && generation.current === capture.generation && lock.current === null) {
          setCapture(null); setStatus(null);
          requestAnimationFrame(() => { if (generation.current === capture.generation && !modalOpen()) { if (capture.activity) restoreActivity(activityFocusedId); else restore(latestNavigation.current.currentFocus); } });
        }
      }} title={capture.action === "dismiss" ? "Dismiss captured Inbox changes?" : capture.action === "unread" ? "Mark captured changes unread?" : "Mark captured changes read?"}
        destructive={capture.action === "dismiss"}
        body={<><p>{capture.eventIds.length} recorded changes across {capture.resourceIds.length} {capture.resourceIds.length === 1 ? "material" : "materials"}.</p>
          <p>{capture.action === "dismiss" ? "Dismiss these captured changes from Inbox? Library materials, History, saved files and your baseline are kept." : "Only these captured changes will be updated. Later arrivals are excluded."}</p>
          {status && <p role="alert">{status}</p>}</>}
        confirmLabel={capture.done ? "Retry refresh" : capture.action === "dismiss" ? "Dismiss captured changes" : capture.action === "unread" ? "Mark captured changes unread" : "Mark captured changes read"}
        onConfirm={() => (capture.activity ? mutateActivity(capture) : mutate(capture))} />}

      <ConfirmDialog
        open={confirmRebaseline}
        onOpenChange={setConfirmRebaseline}
        title={`Reset the baseline for ${code}?`}
        body="The next scan records everything currently on Quanta as your starting point. Those items will not be reported as new. History and saved files are kept."
        confirmLabel="Reset baseline"
        destructive
        scopeList
        onConfirm={async () => {
          await api.rebuildBaseline(course.id);
          onChanged();
        }}
      />

      {renameOpen && <CourseRenameDialog courseId={course.id} name={display} onChanged={onChanged} onClose={() => setRenameOpen(false)} />}
    </div>
  );
}

import { resourceSectionPath } from "../../lib/sectionPath";
import { useMaterialActions } from "../../hooks/useMaterialActions";
import { getListNavigationIntent, recoverFocusedId, type ListNavigationInput } from "../../lib/listNavigation";
import { useSessionScroll, useSessionValue } from "../../hooks/useSessionViews";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMirror } from "../../hooks/useMirror";
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
import type { DetailsAdapter } from "../../lib/details";
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
}: CoursePageProps) {
  const items = useMemo(() => inventory?.filter(resource => resource.courseId === course.id) ?? null, [inventory, course.id]);
  const activityMatchingCourse = activityCourseId === course.id;
  const activityEventsList = activityMatchingCourse && Array.isArray(activityEvents) ? activityEvents : EMPTY_EVENTS;
  const events = activityMatchingCourse ? (activityEvents ?? null) : null;
  const activityGroups = useMemo(() => {
    const byDay = groupEventsByDay(activityEventsList);
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [activityEventsList]);
  const activityIds = useMemo(() => activityGroups.flatMap(([, group]) => group.map((event) => `change:${event.id}`)), [activityGroups]);
  const activityScopeReadyEffective = activityMatchingCourse && Boolean(activityScopeReady) && !activityPending && !activityError && Array.isArray(activityEvents);
  const loading = inventoryPending;
  const loadError = activityMatchingCourse ? (activityError ?? null) : null;
  const [busy, setBusy] = useState(false);
  const [confirmRebaseline, setConfirmRebaseline] = useState(false);

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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [initialised, setInitialised] = useSessionValue(`course:${course.id}:initialised`, false);

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
      return searchResults.map((resource) => ({
        kind: "file",
        id: identity(resource),
        resource,
        depth: 0,
        searching: true,
      }));
    }
    const out: FlatRow[] = [];
    const walk = (node: CourseTreeNode, depth: number) => {
      for (const resource of sortResources(node.resources, sort)) {
        out.push({ kind: "file", id: identity(resource), resource, depth, searching: false });
      }
      for (const child of node.children) {
        out.push({
          kind: "folder",
          id: `folder:${child.id}`,
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
    if (loading || items === null) return;
    if (initialised) return;
    setInitialised(true);
    setExpanded(new Set(pickDefaultSections(tree.children, latestIn)));
  }, [loading, items, initialised, setInitialised, setExpanded, tree]);

  const pathIdentity = JSON.stringify(folderPath ?? []);
  const appliedPath = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !folderPath?.length || appliedPath.current === pathIdentity) return;
    appliedPath.current = pathIdentity;
    const ids: string[] = [];
    const walk = (node: CourseTreeNode) => {
      for (const child of node.children) {
        if (child.path.every((segment, index) => folderPath[index] === segment)) ids.push(child.id);
        walk(child);
      }
    };
    walk(tree);
    setTab("contents");
    setExpanded((previous) => new Set([...previous, ...ids]));
    // Only a new route path expands folders; background refresh preserves explicit collapse.
  }, [pathIdentity, loading]);

  const shown = searching ? searchResults.length : filtered.length;
  const total = unique.length;
  const filtersActive = type !== "all" || category !== "all" || searching;

  const toggle = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setExpanded],
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
  };

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainScroll = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { mainScroll.current = document.querySelector("main"); }, []);
  useSessionScroll(`course:${course.id}:${tab}:main`, mainScroll, items !== null);
  const pendingFocus = useRef<string | null>(null);
  const ownedFocus = useRef(false);
  const previousRows = useRef<FlatRow[]>([]);
  const ids = useMemo(() => rows.map(row => row.id), [rows]);
  const oldFocus = previousRows.current.find(row => row.id === focusedId);
  // Collapsing a descendant returns to its nearest surviving folder.
  const ancestor = oldFocus && !ids.includes(oldFocus.id) && !searching
    ? [...previousRows.current].reverse().find(row => row.kind === "folder" && ids.includes(row.id) &&
        (oldFocus.kind === "folder" ? oldFocus.node.path : resourceSectionPath(oldFocus.resource))
          .slice(0, row.node.path.length).join("\0") === row.node.path.join("\0"))
    : undefined;
  const currentFocus = ancestor?.id ?? recoverFocusedId(previousRows.current.map(row => row.id), ids, focusedId);
  const activeIndex = Math.max(0, ids.indexOf(currentFocus ?? ""));
  const virtualActive = rows.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: virtualActive ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => rows[index].id,
    estimateSize: () => 40,
    overscan: 10,
  });
  const virtualItems = virtualActive ? virtualizer.getVirtualItems() : [];
  useSessionScroll(`course:${course.id}:${tab}:tree`, scrollRef, items !== null && (!virtualActive || virtualItems.length > 0));
  const latestNavigation = useRef({ rows, currentFocus, tab, virtualActive });
  latestNavigation.current = { rows, currentFocus, tab, virtualActive };
  const focusIdentity = useCallback((id: string | null) => {
    if (latestNavigation.current.tab !== "contents" || !searchRef.current?.isConnected || modalOpen()) return false;
    const currentRows = latestNavigation.current.rows;
    const index = currentRows.findIndex(row => row.id === id);
    if (index < 0) { pendingFocus.current = null; searchRef.current.focus(); return true; }
    setFocusedId(id);
    pendingFocus.current = id;
    const element = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(el => el.dataset.rowKey === id);
    // Redirect a preceding virtual scroll even when this target is mounted.
    if (latestNavigation.current.virtualActive) virtualizer.scrollToIndex(index, { align: "auto" });
    if (element) { pendingFocus.current = null; element.focus(); }
    return true;
  }, [virtualActive, virtualizer]);
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
    const element = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(el => el.dataset.rowKey === id);
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
  const matching = searching ? searchResults : filtered;
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
  const context = JSON.stringify([course.id, folderPath, tab, search, type, category, sort]);
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
        if (intent.type === "inspect") toggle(current.node.id);
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
          aria-multiselectable="true"
          onFocusCapture={event => { ownedFocus.current = event.target === event.currentTarget || (event.target as HTMLElement).matches('[role="treeitem"]'); }}
          onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { ownedFocus.current = false; pendingFocus.current = null; } }}
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
                    onActivate={index => setFocusedId(rows[index].id)}
                    selected={isSelectedResourceRow(rows[item.index])}
                    multiSelected={selection.includes(rows[item.index].id)}
                    onSelect={inspect}
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
                onActivate={index => setFocusedId(rows[index].id)}
                selected={row.kind === "file" && selectedResourceId === row.resource.id}
                multiSelected={selection.includes(row.id)}
                onSelect={inspect}
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
        {mirror?.stats && (
          <>
            <span className="stat-strip-sep" aria-hidden="true">
              ·
            </span>
            <span className="stat-strip-item">
              Saved <span className="mono">{mirror.stats.done.toLocaleString()}</span> of{" "}
              <span className="mono">{mirror.stats.totalResources.toLocaleString()}</span>
            </span>
          </>
        )}
      </div>

      <div className="history-tabs">
        <ViewTabs
          items={[
            { id: "contents", label: "Materials" },
            { id: "activity", label: "Activity" },
          ]}
          value={tab}
          onChange={(id) => setTab(id as "contents" | "activity")}
          ariaLabel="Course views"
        />
      </div>

      {tab === "contents" && (status || inventoryError || inventoryPending || !inventory) && (
        <Banner kind={inventoryError ? "error" : "info"} action={inventoryError ? { label: "Retry", onClick: () => void onChanged() } : undefined}>
          {status ?? (inventoryError ? `Inventory refresh failed: ${inventoryError}. Retained materials remain inspectable; new changes are blocked.` : "Inventory unavailable or refreshing; new changes are blocked.")}
        </Banner>
      )}
      {tab === "contents" && <span role="status">{selection.length} {selection.length === 1 ? "material" : "materials"} selected</span>}
      {loadError && (
        <Banner kind="error" action={{ label: "Retry", onClick: () => void (onActivityChanged?.() ?? onChanged()) }}>
          {loadError}
        </Banner>
      )}
      {items === null && (loading || inventoryPending) ? (
        <Skeleton rows={8} />
      ) : items === null ? null : total === 0 ? (
        <EmptyState
          title="This course has not been scanned yet"
          body="Quanta Pulse has not discovered any resources here. Run a sync to check again."
          action={{ label: "Sync now", onClick: onSyncNow }}
        />
      ) : tab === "contents" ? (
        <>
          <div className="course-page-toolbar">
            <SearchField
              inputRef={searchRef}
              value={search}
              onChange={setSearch}
              placeholder="Search resources…"
              label="Search resources in this course"
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
            <span className="result-count">
              {shown} of {total}
            </span>
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

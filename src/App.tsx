// Application shell: authentication gate, navigation, data loading and the
// event bridge from the Rust backend, wrapped in the redesign's five-view
// shell (sidebar, top bar, peek panel, palette, toasts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CheckCheck, Menu, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { AppearancePopover, AppearanceControls } from "./components/Appearance";
import Sidebar from "./components/Sidebar";
import DownloadsPopover from "./components/DownloadsPopover";
import WorkspacePanel from "./components/WorkspacePanel";
import PeekPanel, { type PeekDetails } from "./components/PeekPanel";
import CommandPalette, { type PaletteAction } from "./components/CommandPalette";
import ConfirmDialog from "./components/ConfirmDialog";
import ShortcutsDialog from "./components/ShortcutsDialog";
import { useSessionRefreshBanner } from "./components/SessionRefreshBanner";
import { installAvailableUpdate } from "./lib/updateLifecycle";
import LoginScreen, { type OnboardingState } from "./components/LoginScreen";
import PreviewDialog from "./components/PreviewDialog";
import SyncProgress from "./components/SyncProgress";
import { IconButton } from "./components/ui/IconButton";
import { Kbd } from "./components/ui/Kbd";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { TooltipProvider } from "./components/ui/Tooltip";
import { Toaster, type ToastItem } from "./components/ui/Toast";
import InboxView from "./views/InboxView";
import { useInbox, useDueInventory } from "./hooks/useAttention";
import type { SearchQueryState, SearchScope } from "./lib/desktopSearch";
import { agendaEntries, resolveTimezone } from "./lib/agenda";
import CalendarView from "./views/CalendarView";
import LibraryView from "./views/LibraryView";
import HistoryView from "./views/HistoryView";
import SettingsView from "./views/SettingsView";
import type { SettingsNavigationController } from "./views/SettingsView";
import { api } from "./lib/api";
import { queryHistoryInventory } from "./lib/historyInventory";
import { useTheme } from "./hooks/useTheme";
import { useHotkey } from "./hooks/useHotkey";
import { MirrorProvider, useMirror } from "./hooks/useMirror";
import { isLocal } from "./lib/mirrorState";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { resolveView, NAV, type ViewId } from "./lib/nav";
import { cx } from "./lib/cx";
import {
  changePresentation, detailIdentity, scanCourseProperties, scanDiagnosticsText, scanPresentation,
  type DetailSelection, type DetailSubject, type DetailsAdapter, type RestoreDetailFocus,
} from "./lib/details";
import { canPreview } from "./lib/preview";
import { MaterialActionsContext } from "./hooks/useMaterialActions";
import { SessionViewsProvider, useSessionScroll } from "./hooks/useSessionViews";
import { materialSource, materialActions } from "./lib/materialActions";
import { formatBytes, formatCompact, relativeLabel } from "./lib/format";
import { eventKindMeta } from "./lib/events";
import { formatSectionPath } from "./lib/sectionPath";
import { registerCourseLabels } from "./lib/courseName";
import type {
  DueFilter,
  AuthStatus,
  ChangeEvent,
  Course,
  DbInfo,
  LocalFile,
  Resource,
  ScanDetails,
  ScanOutcome,
  ScanRun,
  SessionResetResult,
  Settings,
  SyncStatus,
} from "./lib/types";

/** The one app-level navigation model: a view plus an optional course. */
export interface Route {
  view: ViewId;
  courseId: number | null;
  folderPath: string[] | null;
  historyScansRequest?: number;
}

const START: Route = { view: "today", courseId: null, folderPath: null };
export const SIDEBAR_KEY = "quanta-pulse-sidebar";

/** The persisted rail preference; "1" means collapsed. */
export function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export default function App() {
  return <SessionViewsProvider><MirrorProvider><AppShell /></MirrorProvider></SessionViewsProvider>;
}

function AppShell() {
  const appearance = useTheme();
  const { resolved, toggle } = appearance;

  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [booted, setBooted] = useState(false);
  const [route, setRoute] = useState<Route>(START);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const settingsController = useRef<SettingsNavigationController | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [pendingSettingsNavigation, setPendingSettingsNavigation] = useState<(() => void) | null>(null);
  const settingsNavigationTrigger = useRef<HTMLElement | null>(null);

  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  const [historyEvents, setHistoryEvents] = useState<ChangeEvent[]>([]);
  const [eventScopeReady, setEventScopeReady] = useState(false);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const inbox = useInbox();
  const inboxRefreshRef = useRef(inbox.refresh);
  inboxRefreshRef.current = inbox.refresh;
  const historyEventsRef = useRef(historyEvents);
  historyEventsRef.current = historyEvents;
  const inboxPageRef = useRef(inbox.page);
  inboxPageRef.current = inbox.page;
  const [dueFilter, setDueFilter] = useState<DueFilter>({});
  const defaultDueFilter = useMemo(() => ({}), []);
  const due = useDueInventory(defaultDueFilter);
  const agendaDue = useDueInventory(dueFilter);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer); }, []);
  const timeZone = resolveTimezone(settings?.timezone);
  const refreshCollections = useRef(async () => {});
  refreshCollections.current = async () => { await Promise.all([inbox.refresh(), due.refresh(), agendaDue.refresh()]); };
  const unread = inbox.global?.unreadTotal ?? 0;
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const [showLogin, setShowLogin] = useState(false);
  const [firstRunAfterScan, setFirstRunAfterScan] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const coursesDiscovered = useRef<number>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteReadIds, setPaletteReadIds] = useState<number[] | null>(null);
  const paletteReadRequest = useRef<object | null>(null);
  const [paletteReadError, setPaletteReadError] = useState<string | null>(null);
  const [librarySearchQuery, setLibrarySearchQuery] = useState<SearchQueryState | undefined>();
  const [pendingPaletteInspection, setPendingPaletteInspection] = useState<Resource | null>(null);
  const [selection, setSelection] = useState<DetailSelection | null>(null);
  const selectionRef = useRef<DetailSelection | null>(null);
  const selectionGeneration = useRef(0);
  const [scanDetail, setScanDetail] = useState<{
    scanId: number;
    details: ScanDetails | null;
    loading: boolean;
  } | null>(null);
  const localLookupGeneration = useRef(0);
  const mainRef = useRef<HTMLElement>(null);
  const restoreRow = useRef<RestoreDetailFocus | undefined>();
  const peekResource = selection?.kind === "resource"
    ? selection.resource
    : selection?.kind === "change" ? selection.resource ?? null : null;
  const [peekLocal, setPeekLocal] = useState<LocalFile | null>(null);
  const [localLookup, setLocalLookup] = useState<"loading" | "ready" | "error">("ready");
  const mirror = useMirror();
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);
  const materialSubmission = useRef(new Set<number>());
  const [materialPending, setMaterialPending] = useState<Set<number>>(new Set());
  const [materialFailure, setMaterialFailure] = useState<{ resourceId: number; message: string } | null>(null);
  const lastRow = useRef<HTMLElement | null>(null);

  // Below this width the sidebar is a rail and expands over the content.
  const narrow = useMediaQuery("(max-width: 959px)");
  const inspectorOverlay = useMediaQuery("(max-width: 1099px)");
  const collapsed = narrow || sidebarCollapsed;
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  const backStack = useRef<Route[]>([]);
  const historyScansRequest = useRef(0);

  /** Every navigation goes through here, so Alt+Left has something to undo. */
  const go = useCallback(
    (next: Route) => {
      const perform = () => {
      setRoute((prev) => {
        backStack.current = [...backStack.current, prev].slice(-25);
        return next;
      });
      };
      if (route.view === "settings" && settingsController.current?.dirty) {
        settingsNavigationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingSettingsNavigation(() => perform);
        return;
      }
      perform();
    },
    [route.view],
  );

  const navigate = useCallback(
    (view: ViewId) => go({ view, courseId: null, folderPath: null }),
    [go],
  );

  const navigateToScans = useCallback(() => {
    go({
      view: "history",
      courseId: null,
      folderPath: null,
      historyScansRequest: ++historyScansRequest.current,
    });
  }, [go]);

  const navigateToCourse = useCallback(
    (courseId: number | null, folderPath: string[] | null = null) =>
      go({ view: "library", courseId, folderPath: folderPath ? [...folderPath] : null }),
    [go],
  );
  const handleSeeAllFiles = useCallback((raw: string, options?: { scope?: SearchScope; sourceFrom?: string | null; sourceThrough?: string | null }) => {
    setLibrarySearchQuery((previous) => ({
      raw,
      scope: options?.scope ?? { kind: "everywhere" },
      sourceFrom: options?.sourceFrom ?? null,
      sourceThrough: options?.sourceThrough ?? null,
      requestId: (previous?.requestId ?? 0) + 1,
    }));
    go({ view: "library", courseId: null, folderPath: null });
  }, [go]);

  const goBack = useCallback(() => {
    if (backStack.current.length === 0) return;
    const perform = () => {
      const prev = backStack.current.pop();
      if (prev) setRoute(prev);
    };
    if (route.view === "settings" && settingsController.current?.dirty) {
      settingsNavigationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingSettingsNavigation(() => perform);
      return;
    }
    perform();
  }, [route.view]);

  const discardAndLeaveSettings = useCallback(() => {
    if (!pendingSettingsNavigation || settingsController.current?.saving) return;
    settingsController.current?.discard();
    setPendingSettingsNavigation(null);
    pendingSettingsNavigation();
  }, [pendingSettingsNavigation]);

  const stayOnSettings = useCallback(() => {
    setPendingSettingsNavigation(null);
    requestAnimationFrame(() => {
      if (settingsNavigationTrigger.current?.isConnected) settingsNavigationTrigger.current.focus();
    });
  }, []);

  const registerSettingsController = useCallback((controller: SettingsNavigationController | null) => {
    settingsController.current = controller;
    setSettingsSaving(controller?.saving ?? false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((was) => {
      const next = !was;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // Storage unavailable: the preference just does not survive a restart.
      }
      return next;
    });
  }, []);

  // Course display names, aliases and dot colours are shared app-wide. Derived
  // during render, not in an effect: children read the registry while they
  // render, and an effect would fill it only after they had already painted
  // their raw Moodle names.
  useMemo(() => {
    registerCourseLabels(courses);
  }, [courses]);

  const notify = useCallback(
    (message: string, error = false, action?: ToastItem["action"]) => {
      const id = ++toastId.current;
      setToasts((current) => [...current, { id, message, error, action }]);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const refreshGeneration = useRef(0);
  const refresh = useCallback(async (requireSuccess = false) => {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    setEventScopeReady(false);
    try {
      const [inventory, he, s, info] = await Promise.all([
        api.listSearchInventory(),
        queryHistoryInventory(),
        api.listHistoryScans(),
        api.dbInfo(),
        refreshCollections.current(),
      ]);
      if (generation !== refreshGeneration.current) {
        if (requireSuccess) throw new Error("History refresh superseded; retry refresh.");
        return;
      }
      setCourses(inventory.courses);
      setResources(inventory.resources);
      setHistoryEvents(he);
      setScans(s);
      setDbInfo(info);
      setLoadError(null);
      setEventScopeReady(true);
    } catch (err) {
      if (generation === refreshGeneration.current) {
        setLoadError(String(err));
        setEventScopeReady(false);
      }
      if (requireSuccess) throw err;
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const [status, a, st] = await Promise.all([
        api.syncStatus(),
        api.authStatus(),
        api.getSettings(),
      ]);
      setSync(status);
      setAuth(a);
      setSettings(st);
    } catch (err) {
      notify(String(err), true);
    }
  }, [notify]);

  useEffect(() => {
    void (async () => {
      await refreshStatus();
      await refresh();
      setBooted(true);
    })();
  }, [refresh, refreshStatus]);

  // Backend event bridge.
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let cancelled = false;

    const add = async <T,>(name: string, handler: (payload: T) => void) => {
      const un = await listen<T>(name, (event) => handler(event.payload));
      if (cancelled) un();
      else unlisteners.push(un);
    };

    void (async () => {
      await add<{ version: string; notes?: string }>("updater:available", (payload) => {
        notify(`Quanta Pulse ${payload.version} is available.`, false, {
          label: "Restart to update",
          onClick: () => {
            void (async () => {
              try {
                await installAvailableUpdate();
              } catch (err) {
                notify(String(err), true);
              }
            })();
          },
        });
      });

      await add<SyncStatus>("sync:status", (payload) => setSync(payload));
      await add<{ phase: string; done: number; total: number }>("sync:progress", (payload) => {
        setScanProgress(payload);
        if (payload.phase === "Scanning courses") coursesDiscovered.current = payload.total;
        setSync((prev) => prev ? { ...prev, phase: payload.phase, progress: payload.total > 0 ? payload.done / payload.total : 0, running: true } : prev);
      });
      await add<ScanOutcome>("sync:done", (outcome) => {
        if (outcome?.cancelled || outcome?.authExpired || outcome?.errors?.length) setFirstRunAfterScan(null);
        void refresh();
        void refreshStatus();
      });
      await add<unknown>("auth:changed", () => {
        void refreshStatus();
        void refresh();
      });
      await add<string>("ui:navigate", (target) => {
        navigate(resolveView(target));
      });
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((un) => un());
    };
  }, [refresh, refreshStatus, navigate]);

  const unreadByCourse = useMemo(() => new Map((inbox.global?.courseCounts ?? []).flatMap(count => count.courseId == null ? [] : [[count.courseId, count.unreadTotal] as const])), [inbox.global]);

  const open = useCallback(
    async (url: string) => {
      try {
        await api.openExternal(url);
      } catch (err) {
        notify(String(err), true);
      }
    },
    [notify],
  );

  const handleSync = useCallback(async () => {
    try {
      setSync((prev) => (prev ? { ...prev, running: true, phase: "Starting" } : prev));
      const outcome = await api.syncNow();
      if (outcome.authExpired) {
        setAuth((prev) => (prev ? { ...prev, sessionExpired: true } : prev));
      } else if (outcome.errors.length > 0 && outcome.discovered === 0) {
        notify("Sync could not reach Quanta. It will retry automatically.", true);
      }
      await refresh();
      await refreshStatus();
    } catch (err) {
      notify(String(err), true);
    }
  }, [notify, refresh, refreshStatus]);

  const sessionRestart = useRef<Promise<SessionResetResult> | null>(null);
  const restartQuantaSession = useCallback(() => {
    if (sessionRestart.current) return sessionRestart.current;
    const work = api.restartQuantaSession().then(async (result) => {
      await refreshStatus();
      if (result.status === "connected") await refresh();
      return result;
    }).finally(() => { sessionRestart.current = null; });
    sessionRestart.current = work;
    return work;
  }, [refresh, refreshStatus]);

  const cancelQuantaSessionRestart = useCallback(async () => {
    const work = sessionRestart.current;
    while (work && sessionRestart.current === work) {
      const { attemptId } = await api.authStatus();
      if (sessionRestart.current !== work) return;
      if (attemptId) {
        await api.cancelSsoLogin(attemptId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, []);

  const clearHistoryActivity = useCallback(async () => {
    try {
      await api.deleteHistory(true);
      await refresh();
      notify("Recorded changes and scan history permanently deleted.");
    } catch (err) { notify(String(err), true); throw err; }
  }, [notify, refresh]);

  const markHistoryRead = useCallback(async () => {
    try {
      await api.setEventReadState(historyEvents.map(event => event.id), true);
      await refresh();
    } catch (err) { notify(String(err), true); throw err; }
  }, [historyEvents, notify, refresh]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setAuth(await api.authStatus());
    setResources([]);
    setHistoryEvents([]);
    setCourses([]);
  }, []);

  const saveSettings = useCallback(async (next: Settings) => {
    const saved = await api.setSettings(next);
    setSettings(saved);
  }, []);

  const lookupLocalFile = mirror?.lookupLocalFile ?? api.mirrorLocalFile;

  const markInspectedRead = useCallback((eventIds: number[]) => {
    const ids = [...new Set(eventIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
    if (ids.length === 0) return;
    const previous = new Map(historyEventsRef.current.filter((event) => ids.includes(event.id)).map((event) => [event.id, event.read]));
    setHistoryEvents((current) => current.map((event) => (ids.includes(event.id) ? { ...event, read: true } : event)));
    void api.setEventReadState(ids, true).then(() => {
      void inboxRefreshRef.current();
    }).catch((err) => {
      setHistoryEvents((current) => current.map((event) => (previous.has(event.id) ? { ...event, read: previous.get(event.id)! } : event)));
      void inboxRefreshRef.current();
      notify(String(err), true);
    });
  }, [notify]);

  const selectDetails = useCallback((owner: ViewId, subject: DetailSubject, origin: HTMLElement, restoreFocus?: RestoreDetailFocus) => {
    const next = { ...subject, owner, identity: detailIdentity(subject) };
    selectionRef.current = next;
    const generation = ++selectionGeneration.current;
    const lookup = ++localLookupGeneration.current;
    lastRow.current = origin;
    restoreRow.current = restoreFocus;
    setSelection(next);
    setPeekLocal(null);
    // Inspecting an unread item marks its captured event IDs read (optimistic, rolled back on failure).
    // Focus, multi-select and preview never trigger this.
    const capturedReadIds: number[] = [];
    if (subject.kind === "resource") {
      void api.snapshotResourceUnreadEventIds(subject.resource.id)
        .then((ids) => markInspectedRead(ids))
        .catch((error) => notify(String(error), true));
    } else if (subject.kind === "change") {
      if (subject.change.resourceId == null) {
        if (!subject.change.read) capturedReadIds.push(subject.change.id);
      } else if (owner === "today") {
        const item = (inboxPageRef.current?.items ?? []).find((candidate) => candidate.eventIds.includes(subject.change.id));
        if (item) capturedReadIds.push(...item.eventIds);
        else if (!subject.change.read) capturedReadIds.push(subject.change.id);
      } else {
        for (const event of historyEventsRef.current) {
          if (event.resourceId === subject.change.resourceId && !event.read && !capturedReadIds.includes(event.id)) capturedReadIds.push(event.id);
        }
        if (!capturedReadIds.includes(subject.change.id) && !subject.change.read) capturedReadIds.push(subject.change.id);
      }
    }
    markInspectedRead(capturedReadIds);
    if (subject.kind === "scan") {
      const scanId = subject.scan.id;
      setScanDetail({ scanId, details: null, loading: true });
      void api.scanDetails(scanId).then((details) => {
        if (selectionGeneration.current === generation) setScanDetail({ scanId, details: details ?? null, loading: false });
      }).catch(() => {
        if (selectionGeneration.current === generation) setScanDetail({ scanId, details: null, loading: false });
      });
    } else {
      setScanDetail(null);
    }
    const resource = subject.kind === "resource" ? subject.resource
      : subject.kind === "change" ? subject.resource : null;
    if (!resource || resource.isExternal) return;
    setLocalLookup("loading");
    void lookupLocalFile(resource.id).then((local) => {
      if (selectionGeneration.current === generation && localLookupGeneration.current === lookup) {
        setPeekLocal(local);
        setLocalLookup("ready");
      }
    }).catch((err) => {
      if (selectionGeneration.current === generation && localLookupGeneration.current === lookup) {
        setLocalLookup("error");
        notify(`Could not load local copy: ${String(err)}`, true);
      }
    });
  }, [notify, lookupLocalFile, markInspectedRead]);

  /** Validate a saved copy before opening; a missing file requires explicit download. */
  const openLocal = useCallback(
    async (resourceId: number) => {
      if (materialSubmission.current.has(resourceId)) return;
      materialSubmission.current.add(resourceId);
      setMaterialPending(new Set(materialSubmission.current));
      const generation = selectionGeneration.current;
      try {
        const file = await lookupLocalFile(resourceId);
        if (!file) {
          if (generation === selectionGeneration.current) setPeekLocal(null);
          notify("Saved copy is missing from disk. Download and open to save it again.", true);
          return;
        }
        await api.openLocalFile(resourceId);
      } catch (err) {
        notify(String(err), true);
      } finally {
        materialSubmission.current.delete(resourceId);
        setMaterialPending(new Set(materialSubmission.current));
      }
    },
    [notify, lookupLocalFile],
  );

  /** One guarded download owner for row, menu and inspector activation. */
  const downloadAndOpen = useCallback(async (resourceId: number, openAfterDownload = true) => {
    if (materialSubmission.current.has(resourceId)) return;
    materialSubmission.current.add(resourceId);
    setMaterialPending(new Set(materialSubmission.current));
    setMaterialFailure((previous) => previous?.resourceId === resourceId ? null : previous);
    const generation = selectionGeneration.current;
    let downloadFinished = false;
    try {
      const local = await (mirror?.ensureLocal ?? api.ensureLocal)(resourceId);
      downloadFinished = true;
      const selected = selectionRef.current;
      const resource = selected?.kind === "resource" ? selected.resource : selected?.kind === "change" ? selected.resource : null;
      if (generation === selectionGeneration.current && resource?.id === resourceId) {
        ++localLookupGeneration.current;
        setPeekLocal(local);
        setLocalLookup("ready");
      }
      void mirror?.refresh();
      if (openAfterDownload) {
        await api.openLocalFile(resourceId);
        notify(`Opened saved copy: ${local.path}`);
      } else {
        notify("Saved on this device");
      }
    } catch (err) {
      if (!downloadFinished) setMaterialFailure({ resourceId, message: String(err) });
      notify(`Could not ${openAfterDownload ? "download and open" : "download"} material: ${String(err)}`, true);
    } finally {
      materialSubmission.current.delete(resourceId);
      setMaterialPending(new Set(materialSubmission.current));
    }
  }, [mirror, notify]);

  const destinations = useCallback((resource: Resource | null, recorded?: ChangeEvent) => {
    const local = resource?.isExternal ? undefined : mirror?.statusOf(resource?.id) ?? (peekLocal?.resourceId === resource?.id ? peekLocal : null);
    const pending = resource ? materialPending.has(resource.id) : false;
    return materialActions(resource, {
      preview: resource ? canPreview(resource.resourceType, resource.url) : false,
      local: resource?.isExternal ? "unsupported" : isLocal(local) ? "saved" : "missing",
      recordedUrl: recorded?.sourcePageUrl,
      recordedFileUrl: recorded?.resourceUrl,
    }, Boolean(recorded)).map((action) => ({
      ...action,
      disabled: pending && (action.id === "download-open" || action.id === "open-saved"),
      onSelect: () => {
        if (action.id === "preview" && resource) setPreviewResource(resource);
        else if (action.id === "open-saved" && resource) void openLocal(resource.id);
        else if (action.id === "download-open" && resource) void downloadAndOpen(resource.id);
        else { const url = action.id === "open-recorded-file" ? materialSource(null, recorded?.resourceUrl) : materialSource(resource, materialSource(null, recorded?.sourcePageUrl) ?? recorded?.resourceUrl); if (url) void open(url); }
      },
    }));
  }, [mirror, peekLocal, materialPending, open, openLocal, downloadAndOpen]);

  useSessionScroll(`route:${route.view}:${route.courseId ?? "root"}:${JSON.stringify(route.folderPath)}`, mainRef);

  const copyText = useCallback(async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(success);
    } catch {
      notify("Could not copy to the clipboard.", true);
    }
  }, [notify]);

  const restorePeekFocus = useCallback(() => {
    const origin = lastRow.current;
    const visible = (element: HTMLElement) =>
      element.isConnected &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility !== "hidden" &&
      getComputedStyle(element).display !== "none" &&
      element.getClientRects().length > 0;
    if (origin && visible(origin)) origin.focus();
    else if (!restoreRow.current?.()) {
      const heading = mainRef.current?.querySelector<HTMLElement>("h1");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus();
    }
  }, []);

  const closePeek = useCallback(() => {
    if (!selectionRef.current) return;
    selectionRef.current = null;
    ++selectionGeneration.current;
    setSelection(null);
    setPeekLocal(null);
    setScanDetail(null);
    restorePeekFocus();
  }, [restorePeekFocus]);

  useEffect(() => {
    const current = selectionRef.current;
    if (current?.kind !== "resource" || current.owner !== "calendar" || agendaDue.pending || agendaDue.error) return;
    const updated = agendaDue.items?.find(item => item.resource.externalResourceId === current.resource.externalResourceId)?.resource;
    if (updated && updated !== current.resource) {
      const next = { ...current, resource: updated };
      selectionRef.current = next;
      setSelection(next);
    }
  }, [agendaDue.items, agendaDue.pending, agendaDue.error]);

  const adapterCallbacks = useMemo(() => Object.fromEntries(NAV.map(({ id: owner }) => [owner, {
    selectResource: (resource: Resource, origin: HTMLElement, restore?: RestoreDetailFocus) => selectDetails(owner, { kind: "resource", resource }, origin, restore),
    selectChange: (change: ChangeEvent, origin: HTMLElement, resource?: Resource | null, restore?: RestoreDetailFocus) => selectDetails(owner, { kind: "change", change, resource }, origin, restore),
    selectScan: (scan: ScanRun, origin: HTMLElement, restore?: RestoreDetailFocus) => selectDetails(owner, { kind: "scan", scan }, origin, restore),
    clear: () => { if (selectionRef.current?.owner === owner) closePeek(); },
  }])) as Record<ViewId, Omit<DetailsAdapter, "selected">>, [selectDetails, closePeek]);
  const detailsAdapters = useMemo(() => Object.fromEntries(NAV.map(({ id }) => [id, {
    ...adapterCallbacks[id], selected: selection?.owner === id ? selection : null,
  }])) as Record<ViewId, DetailsAdapter>, [adapterCallbacks, selection]);

  useEffect(() => () => { ++selectionGeneration.current; }, []);

  // Runs after the next view has committed, so the fallback heading is current.
  useEffect(() => { closePeek(); }, [route, closePeek]);

  useEffect(() => {
    if (route.view !== "library" || !pendingPaletteInspection) return;
    const origin = document.querySelector<HTMLElement>("main h1") ?? mainRef.current;
    if (origin) detailsAdapters.library.selectResource(pendingPaletteInspection, origin);
    setPendingPaletteInspection(null);
  }, [route.view, pendingPaletteInspection, detailsAdapters]);

  const peekDetails: PeekDetails | null = useMemo(() => {
    if (selection?.kind === "change" && !peekResource) {
      const event = selection.change;
      const actions = destinations(null, event);
      const historical = event.changeType !== "announcement" && (event.resourceId === null || selection.owner === "history");
      return {
        ...changePresentation(event),
        typeLabel: historical ? "HISTORICAL EVENT" : event.changeType === "announcement" ? "ANNOUNCEMENT" : null,
        banner: historical ? { kind: "neutral", text: "The original resource no longer exists on Quanta." } : null,
        announcement: event.changeType === "announcement" ? event.description : null,
        note: event.changeType === "announcement" ? null : event.description,
        primaryAction: !historical && actions[0] ? { label: actions[0].label, onClick: actions[0].onSelect } : null,
        secondaryAction: historical && selection.owner !== "history" ? { label: "Show in History", onClick: () => navigate("history") } : null,
        menu: historical ? actions : actions.slice(1),
      };
    }
    if (selection?.kind === "scan") {
      const base = scanPresentation(selection.scan);
      const detail = scanDetail?.scanId === selection.scan.id ? scanDetail : null;
      const diagnostics = detail?.details;
      if (!diagnostics) return {
        ...base,
        headerLabel: "Scan",
        banner: {
          kind: "neutral",
          text: detail?.loading
            ? "Loading diagnostics…"
            : "Diagnostics unavailable for this older scan. Only the scan summary was recorded.",
        },
      };
      const failed = diagnostics.courses.filter((course) => course.status !== "success");
      return {
        ...base,
        headerLabel: "Scan",
        properties: [...base.properties, ...scanCourseProperties(diagnostics)],
        banner: failed.length
          ? {
              kind: "warning",
              text: `${base.statusTag?.label ?? "Partial"}: ${failed.map((course) => course.courseName).join(", ")} couldn't be read. The other courses were scanned.`,
            }
          : null,
        primaryAction: { label: "Retry scan", onClick: () => void handleSync() },
        secondaryAction: { label: "Copy diagnostics", onClick: () => void copyText(scanDiagnosticsText(diagnostics), "Diagnostics copied.") },
      };
    }
    if (!peekResource) return null;
    const local = peekLocal && peekLocal.resourceId === peekResource.id ? peekLocal : null;
    const event = selection?.kind === "change" ? selection.change : null;
    const actions = destinations(peekResource, event ?? undefined);
    const localStatus = mirror?.statusOf(peekResource.id) ?? local;
    const attempt = mirror?.downloads.get(peekResource.id);
    const progress = attempt?.state === "downloading" || attempt?.state === "queued" ? attempt : null;
    const saved = isLocal(localStatus);
    const failure = materialFailure?.resourceId === peekResource.id ? materialFailure.message : null;
    const failed = localStatus?.status === "failed" || attempt?.state === "failed" || Boolean(failure);
    const unavailable = peekResource.availabilityStatus !== "available";
    const link = peekResource.isExternal || actions.every((action) => action.id === "open-quanta");
    const announcement = event?.changeType === "announcement" || peekResource.resourceType.toLowerCase() === "announcement";
    const deadline = event?.changeType === "deadline" || (selection?.owner === "calendar" && Boolean(peekResource.dueAt));
    const historical = Boolean(event && selection?.owner === "history");
    const preview = actions.find((action) => action.id === "preview");
    const savedAction = actions.find((action) => action.id === "open-saved");
    const download = !unavailable ? actions.find((action) => action.id === "download-open") : null;
    const source = actions.find((action) => action.id === "open-quanta");
    const primary = link || announcement || deadline ? source : saved ? preview ?? savedAction : download ?? source;
    const secondary = link || announcement || deadline ? null : saved
      ? (primary !== savedAction ? savedAction : null)
      : download ? { label: "Download", onSelect: () => void downloadAndOpen(peekResource.id, false), disabled: download.disabled } : null;
    const dueEntry = agendaEntries([{ resource: peekResource, dateKind: /^\d{4}-\d{2}-\d{2}$/.test(peekResource.dueAt ?? "") ? "date" : "instant", coursePaused: false }], now, timeZone)[0];
    const course = { label: "Course", value: peekResource.courseName ?? "—" };
    const section = peekResource.sectionPath?.length ? peekResource.sectionPath.join(" / ") : formatSectionPath(peekResource);
    const detected = { label: "Detected", value: formatCompact(event?.detectedAt ?? peekResource.firstSeenAt), mono: true };
    const properties = deadline ? [
      { label: "Due", value: peekResource.dueAt ?? "Due date unavailable", mono: true },
      { label: "Source", value: "As stored on Quanta" },
      { label: "Local time", value: dueEntry ? `${dueEntry.label}${dueEntry.item.dateKind === "date" ? " (date only)" : ""}` : "—" },
      { label: "Countdown", value: dueEntry?.item.dateKind === "instant" ? relativeLabel(peekResource.dueAt, now) : "—" },
      course,
    ] : historical && event ? [
      { label: "Event", value: eventKindMeta(event.changeType).label },
      detected,
      course,
      { label: "Section", value: section },
    ] : [
      course,
      { label: "Section", value: section || "—" },
      detected,
      ...(peekResource.modifiedAt ? [{ label: "Updated", value: formatCompact(peekResource.modifiedAt), mono: true }] : []),
      { label: "Source", value: `Quanta · ${announcement ? "Announcements" : "Course materials"}` },
    ];
    const size = local?.sizeBytes ?? peekResource.sizeBytes;
    const fileName = local?.relPath?.split(/[/\\]/).pop() ?? peekResource.title;
    const retry = () => {
      if (attempt?.state === "failed" && mirror) {
        void mirror.retryDownload(peekResource.id).catch((err) => notify(String(err), true));
      } else {
        void downloadAndOpen(peekResource.id, false);
      }
    };
    return {
      title: event?.resourceTitle ?? event?.title ?? peekResource.title,
      typeLabel: deadline ? "DEADLINE" : historical ? "HISTORICAL EVENT" : announcement ? "ANNOUNCEMENT" : link ? "EXTERNAL LINK" : peekResource.resourceType.toUpperCase() || "FILE",
      properties,
      announcement: announcement ? event?.description : null,
      note: deadline ? "Submission status is not tracked." : null,
      banner: failed && !saved && !link && !deadline
        ? { kind: "danger", text: `Download failed: ${attempt?.error || localStatus?.error || failure || "The file could not be saved."}` }
        : unavailable
          ? { kind: "warning", text: saved ? "No longer on Quanta. Your saved copy still works." : "No longer on Quanta." }
          : null,
      propertyStatus: link || announcement || deadline ? null : saved
        ? { label: "Saved on this device", tone: "saved" }
        : failed ? { label: "Failed", tone: "failed" }
          : { label: localLookup === "loading" ? "Loading local copy…" : localLookup === "error" ? "Local copy unavailable" : "Not saved", tone: "muted" },
      progress: link || deadline ? null : progress,
      cancelAction: progress && mirror ? { label: "Cancel download", onClick: () => void mirror.cancelDownload(peekResource.id).catch((err) => notify(String(err), true)) } : null,
      primaryAction: progress ? null : failed && !saved && !link && !deadline && !unavailable
        ? { label: "Retry", onClick: retry }
        : primary ? { label: primary.label, onClick: primary.onSelect, disabled: primary.disabled } : null,
      secondaryAction: progress || (failed && !saved) ? null : secondary ? { label: secondary.label, onClick: secondary.onSelect, disabled: secondary.disabled } : null,
      technical: link || announcement || deadline ? null : {
        fileName,
        fileType: local?.mime ?? peekResource.resourceType,
        size: size === null ? null : formatBytes(size),
        sha256: local?.sha256,
        quantaUrl: peekResource.url,
        savedPath: local?.path,
      },
      menu: [
        ...actions.filter((action) => action !== primary && action !== secondary
          && !(unavailable && !saved && (action.id === "download-open" || action.id === "preview"))),
        ...(saved && local ? [{
          id: "reveal",
          label: "Show in folder",
          onSelect: () => void api.revealLocalFile(peekResource.id).catch((err) => notify(String(err), true)),
        }, { id: "copy-path", label: "Copy path", onSelect: () => void copyText(local.path, "Path copied.") }] : []),
        {
          id: "copy",
          label: "Copy link",
          onSelect: () =>
            void copyText(peekResource.sourcePageUrl ?? peekResource.url, "Link copied."),
        },
      ],
    };
  }, [selection, scanDetail, peekResource, peekLocal, localLookup, mirror, materialFailure, now, timeZone, destinations, navigate, downloadAndOpen, copyText, handleSync, notify]);

  useEffect(() => {
    paletteReadRequest.current = null;
    setPaletteReadIds(null);
    setPaletteReadError(null);
  }, [route]);

  const requestPaletteInboxRead = useCallback(async () => {
    if (paletteReadRequest.current) return;
    const request = {};
    paletteReadRequest.current = request;
    try {
      const ids = await api.snapshotInboxEventIds({ attention: "unread" });
      if (paletteReadRequest.current !== request) return;
      if (ids.length) {
        setPaletteReadError(null);
        setPaletteReadIds(ids);
      } else {
        paletteReadRequest.current = null;
        notify("You’re all caught up");
      }
    } catch (error) {
      if (paletteReadRequest.current !== request) return;
      paletteReadRequest.current = null;
      notify(String(error), true);
    }
  }, [notify]);

  const markPaletteInboxRead = async () => {
    if (!paletteReadIds?.length) return;
    const ids = paletteReadIds;
    setPaletteReadError(null);
    try {
      await api.setEventReadState(ids, true);
      await refresh();
      notify(`Marked ${ids.length} ${ids.length === 1 ? "item" : "items"} as read`, false, {
        label: "Undo",
        onClick: () => {
          void api.setEventReadState(ids, false).then(() => refresh()).catch((error) => notify(String(error), true));
        },
      });
    } catch (error) {
      setPaletteReadError(String(error));
      throw error;
    }
  };

  const unreadResources = useMemo(() => new Set<number>([
    ...historyEvents.flatMap((event) => event.resourceId != null && !event.read ? [event.resourceId] : []),
    ...(inbox.page?.items ?? []).flatMap((item) => item.resourceId != null && item.unread ? [item.resourceId] : []),
  ]), [historyEvents, inbox.page]);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      { id: "read", label: "Mark all as read", shortcut: "Shift+A", icon: <CheckCheck aria-hidden="true" />, onSelect: () => void requestPaletteInboxRead() },
      { id: "sync", label: "Rescan Quanta now", shortcut: "Mod+R", icon: <RefreshCw aria-hidden="true" />, onSelect: () => void handleSync() },
      { id: "theme", label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme", shortcut: "Mod+Shift+L", searchableOnly: true, onSelect: toggle },
      { id: "rail", label: "Toggle sidebar", shortcut: "Mod+\\", searchableOnly: true, onSelect: toggleSidebar },
      { id: "shortcuts", label: "Keyboard shortcuts", shortcut: "?", searchableOnly: true, onSelect: () => setShortcutsOpen(true) },
    ],
    [handleSync, requestPaletteInboxRead, resolved, toggle, toggleSidebar],
  );

  const hasKeyboardModal = () => drawerOpen || Boolean(
    document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'),
  );
  const focusCurrentViewSearch = () => {
    const search = [...document.querySelectorAll<HTMLElement>(
      'main input[type="search"], main input[placeholder*="Search"], main [role="searchbox"]',
    )].find((element) =>
      !element.closest('[hidden], [aria-hidden="true"]') &&
      getComputedStyle(element).display !== "none" &&
      getComputedStyle(element).visibility !== "hidden",
    );
    if (search) {
      search.focus();
      return true;
    }
    const searchTrigger = mainRef.current?.querySelector<HTMLButtonElement>("[data-view-search]");
    if (!searchTrigger) return false;
    if (searchTrigger.getAttribute("aria-expanded") === "true") {
      const controls = searchTrigger.getAttribute("aria-controls");
      if (controls) document.getElementById(controls)?.querySelector<HTMLElement>("input")?.focus();
    } else searchTrigger.click();
    return true;
  };
  const whenNoModal = (action: () => void) => () => {
    if (!hasKeyboardModal()) action();
  };

  useHotkey(
    {
      "$mod+k": (e) => {
        if (hasKeyboardModal()) return;
        e.preventDefault();
        setPaletteOpen(true);
      },
      "[Shift]+Slash": (e) => {
        if (hasKeyboardModal()) return;
        e.preventDefault();
        if (e.key === "?") {
          setShortcutsOpen(true);
          return;
        }
        if (!focusCurrentViewSearch()) setPaletteOpen(true);
      },
      "$mod+1": whenNoModal(() => navigate("today")),
      "$mod+2": whenNoModal(() => navigate("calendar")),
      "$mod+3": whenNoModal(() => navigate("library")),
      "$mod+4": whenNoModal(() => navigate("history")),
      "$mod+5": whenNoModal(() => navigate("settings")),
      "g i": whenNoModal(() => navigate("today")),
      "g c": whenNoModal(() => navigate("calendar")),
      "g l": whenNoModal(() => navigate("library")),
      "g h": whenNoModal(() => navigate("history")),
      "$mod+Comma": whenNoModal(() => navigate("settings")),
      "$mod+r": (event) => {
        if (hasKeyboardModal()) return;
        event.preventDefault();
        void handleSync();
      },
      "$mod+Shift+S": whenNoModal(() => void handleSync()),
      "$mod+Shift+L": whenNoModal(() => toggle()),
      "$mod+Backslash": whenNoModal(() => {
        if (narrow) setDrawerOpen((open) => !open);
        else toggleSidebar();
      }),
      "$mod+ArrowLeft": whenNoModal(() => goBack()),
      Escape: (event) => {
        // Radix owns modal/menu dismissal at document level. Its surface may
        // still be mounted until this event finishes bubbling to window.
        if (event.defaultPrevented || previewResource || document.querySelector('[role="dialog"]:not(.sidebar), [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
        if (drawerOpen) setDrawerOpen(false);
        else if (selection) closePeek();
      },
    },
    booted && Boolean(auth?.authenticated || auth?.sessionExpired || sync?.authState === "expired")
      && firstRunAfterScan == null && !paletteOpen && !showLogin,
  );

  const sessionExpired = Boolean(auth?.sessionExpired || sync?.authState === "expired");
  const sessionNotice = useSessionRefreshBanner({
    sessionExpired,
    onRestart: restartQuantaSession,
    onCancel: cancelQuantaSessionRestart,
    onSignInAgain: () => setShowLogin(true),
  });
  function beginOnboarding() {
    if (!auth?.authenticated && dbInfo && !dbInfo.resourceCount && !dbInfo.courseCount && !scans.some((scan) => scan.isBaseline && scan.status === "ok")) {
      setFirstRunAfterScan(Math.max(0, ...scans.map((scan) => scan.id)));
      coursesDiscovered.current = undefined;
      setScanProgress(null);
    }
  }

  let onboarding: OnboardingState | null = null;
  if (firstRunAfterScan != null && auth?.authenticated && !sessionExpired && !showLogin) {
    const baseline = scans.find((scan) => scan.isBaseline && scan.id > firstRunAfterScan && scan.status === "ok");
    const openWorkspace = (view: ViewId) => {
      setFirstRunAfterScan(null);
      navigate(view);
    };
    onboarding = baseline ? {
      state: "complete",
      courses: dbInfo?.courseCount ?? courses.length,
      materials: dbInfo?.resourceCount ?? baseline.discoveredCount,
      newCount: baseline.newCount,
      onOpenLibrary: () => openWorkspace("library"),
      onGoInbox: () => openWorkspace("today"),
    } : {
      state: "scanning",
      progress: sync?.progress,
      coursesFound: coursesDiscovered.current,
      materialsRecorded: scanProgress?.phase === "Reading materials" ? scanProgress.done : undefined,
      materialsTotal: scanProgress?.phase === "Reading materials" ? scanProgress.total : undefined,
      onBackground: () => {
        try {
          void getCurrentWindow().hide().catch((error) => notify(String(error), true));
        } catch (error) {
          notify(String(error), true);
        }
      },
    };
  }

  if (!booted) {
    return (
      <div className="login-wrap">
        <div className="muted">Starting Quanta Pulse…</div>
      </div>
    );
  }

  if ((!auth?.authenticated && !sessionExpired) || showLogin || onboarding) {
    return (
      <LoginScreen
        onboarding={onboarding}
        onSignInStart={beginOnboarding}
        onCancel={auth?.authenticated ? () => setShowLogin(false) : undefined}
        onAuthenticated={(status) => {
          setShowLogin(false);
          setAuth(status);
          void refreshStatus();
          void refresh();
        }}
      />
    );
  }

  const hasDownloads = Array.from(mirror?.downloads.values() ?? []).some(
    ({ state }) => state === "queued" || state === "downloading" || state === "failed",
  );
  const headerActions = (
    <>
      <IconButton label="Open navigation" className="workspace-navigation-trigger" onClick={() => setDrawerOpen(true)}>
        <Menu aria-hidden="true" />
      </IconButton>
      {hasDownloads && <DownloadsPopover resources={resources} />}
      <button type="button" className="workspace-search" aria-label="Search" onClick={() => setPaletteOpen(true)}>
        <Search aria-hidden="true" />
        <span>Search</span>
        <Kbd keys="Mod+K" />
      </button>
    </>
  );


  return (
    <MaterialActionsContext.Provider value={destinations}>
    <TooltipProvider>
      <div className={cx("app", collapsed && "rail", drawerOpen && "drawer-open")}>
        <a className="skip-link" href="#workspace-content" onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}>Skip to content</a>
        {narrow && drawerOpen && (
          <div
            className="sidebar-scrim"
            role="presentation"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <Sidebar
          view={route.view}
          onView={(view) => {
            navigate(view);
            if (narrow) setDrawerOpen(false);
          }}
          courses={courses}
          resources={resources}
          unreadByCourse={unreadByCourse}
          unreadTotal={inbox.countError ? "–" : unread}
          activeCourseId={route.courseId}
          activeFolderPath={route.folderPath}
          onCourse={(courseId, folderPath) => {
            navigateToCourse(courseId, folderPath);
            if (narrow) setDrawerOpen(false);
          }}
          sync={sync}
          sessionExpired={sessionExpired}
          appearanceActions={
            <>
              <IconButton
                label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                onClick={toggle}
                className="sidebar-theme-toggle"
              >
                {resolved === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </IconButton>
              <AppearancePopover appearance={appearance} />
            </>
          }
          onSync={() => void handleSync()}
          onOpenScans={() => {
            navigateToScans();
            if (narrow) setDrawerOpen(false);
          }}
          onOpenPalette={() => {
            if (narrow) setDrawerOpen(false);
            setPaletteOpen(true);
          }}
          collapsed={collapsed}
          onToggle={collapsed && narrow ? () => setDrawerOpen((open) => !open) : toggleSidebar}
          overlay={narrow && drawerOpen}
        />

        <div className="work">
          {sessionNotice}

          <SyncProgress running={Boolean(sync?.running)} progress={sync?.progress ?? 0} />

          <WorkspacePanel
            content={<main className="app-main" id="workspace-content" tabIndex={-1} ref={mainRef}>
              <div className="page workspace-page">
                {route.view === "today" && (
                  <InboxView
                    headerActions={headerActions}
                    lastScan={sync?.lastSuccessAt ?? null} onHistory={() => navigate("history")}
                    inbox={inbox} due={due} contextError={loadError} courses={courses} resources={resources}
                    storedCount={dbInfo?.resourceCount ?? resources.length}
                    baseline={dbInfo?.eventCount === 0 && scans.some(scan => scan.isBaseline && scan.status === "ok")}
                    details={detailsAdapters.today} now={now} timeZone={timeZone}
                    onOpen={(url) => void open(url)} onOpenLocal={(id) => void openLocal(id)}
                    onDownloadOpen={(id) => void downloadAndOpen(id)} onPreview={setPreviewResource}
                    onOpenCourse={navigateToCourse} onAgenda={() => navigate("calendar")}
                    onLibrary={() => navigate("library")} onSync={() => void handleSync()}
                    onChanged={refresh}
                  />
                )}
                {route.view === "calendar" && (
                  <CalendarView
                    headerActions={headerActions} lastScan={sync?.lastSuccessAt ?? null} onLibrary={() => navigate("library")}
                    due={agendaDue} dueFilter={dueFilter} setDueFilter={setDueFilter} now={now} timeZone={timeZone}
                    onChanged={refresh}
                    courses={courses}
                    resources={resources}
                    onOpen={(url) => void open(url)}
                    onOpenLocal={(resourceId) => void openLocal(resourceId)}
                    onDownloadOpen={(id) => void downloadAndOpen(id)} onPreview={setPreviewResource}
                    onOpenScan={navigateToScans}
                    onOpenCourse={navigateToCourse}
                    details={detailsAdapters.calendar}
                  />
                )}
                {route.view === "library" && (
                  <LibraryView
                    headerActions={headerActions} compact={narrow} unreadResourceIds={unreadResources}
                    courses={courses}
                    resources={resources}
                    courseId={route.courseId}
                    folderPath={route.folderPath}
                    onNavigate={navigateToCourse}
                    onSeeAllFiles={handleSeeAllFiles}
                    unreadByCourse={unreadByCourse}
                    details={detailsAdapters.library}
                    loading={loading}
                    error={loadError}
                    onRetry={() => void refresh()}
                    onChanged={refresh}
                    onActivityChanged={() => refresh(true)}
                    onOpen={(url) => void open(url)}
                    timeZone={timeZone}
                    initialSearch={librarySearchQuery?.raw}
                    initialSearchQuery={librarySearchQuery}
                    initialSearchKey={librarySearchQuery?.requestId ?? 0}
                    onSyncNow={() => void handleSync()}
                  />
                )}
                {route.view === "history" && (
                  <HistoryView
                    key={route.historyScansRequest ?? 0}
                    initialTab={route.historyScansRequest ? "scans" : "changes"}
                    headerActions={headerActions}
                    courses={courses}
                    scans={scans}
                    events={historyEvents}
                    eventScopeReady={eventScopeReady && !loading && !loadError}
                    onSetEventReadState={(ids, read) => api.setEventReadState([...ids], read)}
                    onDismissEvents={(ids) => api.dismissInboxEvents([...ids])}
                    onChanged={() => refresh(true)}
                    resources={resources}
                    details={detailsAdapters.history}
                    loading={loading}
                    error={loadError}
                    onRetry={() => void refresh()}
                    onOpen={(url) => void open(url)}
                    onOpenLocal={(resourceId) => void openLocal(resourceId)}
                    onMarkAllRead={markHistoryRead}
                    onClearAll={clearHistoryActivity}
                    onSyncNow={() => void handleSync()}
                    onOpenCourse={navigateToCourse}
                  />
                )}
                {route.view === "settings" && settings && (
                  <SettingsView
                    headerActions={headerActions} resources={resources}
                    settings={settings}
                    auth={auth}
                    dbInfo={dbInfo}
                    onSave={saveSettings}
                    onLogout={handleLogout}
                    onRefresh={() => void refresh()}
                    appearance={<AppearanceControls appearance={appearance} />}
                    onController={registerSettingsController}
                  />
                )}
              </div>
            </main>}
            inspector={selection?.owner === route.view && peekDetails ? (
              <PeekPanel
                focusOnOpen={!inspectorOverlay}
                selectionKey={selection ? `${selection.identity}:${selectionGeneration.current}` : undefined}
                open={selection?.owner === route.view && Boolean(peekDetails)}
                details={peekDetails}
                onClose={closePeek}
                onCopy={(text) => void copyText(text, "Copied.")}
              />
            ) : null}
            onCloseInspector={closePeek}
            onRestoreInspectorFocus={restorePeekFocus}
          />
        </div>

        {previewResource && (
          <PreviewDialog
            resource={previewResource}
            open
            onOpenChange={(next) => {
              if (!next) setPreviewResource(null);
            }}
            onOpen={(url) => void open(url)}
            onOpenLocal={(id) => void openLocal(id)}
            onRevealLocal={(id) => void api.revealLocalFile(id).catch((err) => notify(String(err), true))}
            onReconnect={restartQuantaSession}
            saved={isLocal(mirror?.statusOf(previewResource.id) ?? (peekLocal?.resourceId === previewResource.id ? peekLocal : null))}
            onMarkRead={historyEvents.some((event) => event.resourceId === previewResource.id && !event.read)
              ? () => markInspectedRead(historyEvents.filter((event) => event.resourceId === previewResource.id && !event.read).map((event) => event.id))
              : undefined}
          />
        )}

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onView={navigate}
          courses={courses}
          onCourse={navigateToCourse}
          onFolder={navigateToCourse}
          resources={resources}
          inventoryPending={loading}
          inventoryError={loadError}
          unreadResources={unreadResources}
          timeZone={timeZone}
          onInspectResource={(resource) => { setPendingPaletteInspection(resource); navigate("library"); }}
          onSeeAllFiles={handleSeeAllFiles}
          actions={paletteActions}
        />

        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <ConfirmDialog
          open={paletteReadIds !== null}
          onOpenChange={(next) => {
            if (!next) {
              paletteReadRequest.current = null;
              setPaletteReadIds(null);
              setPaletteReadError(null);
            }
          }}
          title="Mark all Inbox items read?"
          body={<><p>Marks the {paletteReadIds?.length ?? 0} captured unread changes as read.</p>
            {paletteReadError && <p role="alert">{paletteReadError}</p>}</>}
          confirmLabel="Mark all as read"
          onConfirm={markPaletteInboxRead}
        />

        <Dialog
          open={Boolean(pendingSettingsNavigation)}
          onOpenChange={(open) => { if (!open) stayOnSettings(); }}
          label="Leave without saving?"
          role="alertdialog"
          className="dialog-confirm"
        >
          <h2 className="dialog-title">Leave without saving?</h2>
          <p className="dialog-body">You have unsaved changes in Settings.</p>
          <div className="dialog-footer">
            <Button variant="secondary" disabled={settingsSaving} onClick={discardAndLeaveSettings}>Discard changes</Button>
            <Button variant="primary" className="dialog-primary" onClick={stayOnSettings}>Stay</Button>
          </div>
        </Dialog>

        <Toaster toasts={toasts} onDismiss={dismissToast} />
      </div>
      </TooltipProvider>
    </MaterialActionsContext.Provider>
  );
}

// Application shell: authentication gate, navigation, data loading and the
// event bridge from the Rust backend, wrapped in the redesign's five-view
// shell (sidebar, top bar, peek panel, palette, toasts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Moon, Sun } from "lucide-react";
import { AppearancePopover, AppearanceControls } from "./components/Appearance";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import WorkspacePanel from "./components/WorkspacePanel";
import PeekPanel, { type PeekDetails } from "./components/PeekPanel";
import CommandPalette, { type PaletteAction } from "./components/CommandPalette";
import SessionRefreshBanner from "./components/SessionRefreshBanner";
import { installAvailableUpdate } from "./lib/updateLifecycle";
import LoginScreen from "./components/LoginScreen";
import PreviewDialog from "./components/PreviewDialog";
import SyncProgress from "./components/SyncProgress";
import { IconButton } from "./components/ui/IconButton";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { TooltipProvider } from "./components/ui/Tooltip";
import { Toaster, type ToastItem } from "./components/ui/Toast";
import InboxView from "./views/InboxView";
import { useInbox, useDueInventory, queryResourceInventory } from "./hooks/useAttention";
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
  changePresentation, detailIdentity, scanCourseProperties, scanDiagnosticsText, scanPresentation, todayPresentation,
  type DetailSelection, type DetailSubject, type DetailsAdapter, type RestoreDetailFocus,
} from "./lib/details";
import { canPreview } from "./lib/preview";
import { MaterialActionsContext } from "./hooks/useMaterialActions";
import { SessionViewsProvider, useSessionScroll } from "./hooks/useSessionViews";
import { materialSource, materialActions } from "./lib/materialActions";
import { registerCourseLabels, courseLabel } from "./lib/courseName";
import type {
  DueFilter,
  AuthStatus,
  ChangeEvent,
  Course,
  DbInfo,
  LocalFile,
  Resource,
  ScanDetails,
  ScanRun,
  Settings,
  SyncStatus,
} from "./lib/types";

/** The one app-level navigation model: a view plus an optional course. */
export interface Route {
  view: ViewId;
  courseId: number | null;
  folderPath: string[] | null;
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
  const [settingsNavigationState, setSettingsNavigationState] = useState({ dirty: false, valid: true, saving: false, error: null as string | null });
  const [pendingSettingsNavigation, setPendingSettingsNavigation] = useState<(() => void) | null>(null);
  const [settingsNavigationError, setSettingsNavigationError] = useState<string | null>(null);
  const settingsNavigationGeneration = useRef(0);
  const settingsNavigationTrigger = useRef<HTMLElement | null>(null);

  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  const [historyEvents, setHistoryEvents] = useState<ChangeEvent[]>([]);
  const [eventScopeReady, setEventScopeReady] = useState(false);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const inbox = useInbox();
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState<string | undefined>();
  const [librarySearchRequest, setLibrarySearchRequest] = useState(0);
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
  const lastRow = useRef<HTMLElement | null>(null);

  // Below this width the sidebar is a rail and expands over the content.
  const narrow = useMediaQuery("(max-width: 959px)");
  const inspectorOverlay = useMediaQuery("(max-width: 1099px)");
  const collapsed = narrow || sidebarCollapsed;

  const backStack = useRef<Route[]>([]);

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
        setSettingsNavigationError(null);
        ++settingsNavigationGeneration.current;
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

  const navigateToCourse = useCallback(
    (courseId: number | null, folderPath: string[] | null = null) =>
      go({ view: "library", courseId, folderPath }),
    [go],
  );

  const goBack = useCallback(() => {
    if (backStack.current.length === 0) return;
    const perform = () => {
      const prev = backStack.current.pop();
      if (prev) setRoute(prev);
    };
    if (route.view === "settings" && settingsController.current?.dirty) {
      settingsNavigationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSettingsNavigationError(null);
      ++settingsNavigationGeneration.current;
      setPendingSettingsNavigation(() => perform);
      return;
    }
    perform();
  }, [route.view]);

  const resolveSettingsNavigation = useCallback(async (choice: "save" | "discard") => {
    const target = pendingSettingsNavigation;
    if (!target) return;
    const generation = ++settingsNavigationGeneration.current;
    const controller = settingsController.current;
    if (choice === "save") {
      const result = await controller?.save();
      if (generation !== settingsNavigationGeneration.current) return;
      if (!result?.saved) {
        setSettingsNavigationError(result?.error ?? "Settings could not be saved. Try again.");
        return;
      }
    } else {
      controller?.discard();
    }
    setPendingSettingsNavigation(null);
    setSettingsNavigationError(null);
    target();
  }, [pendingSettingsNavigation]);

  const stayOnSettings = useCallback(() => {
    ++settingsNavigationGeneration.current;
    setPendingSettingsNavigation(null);
    setSettingsNavigationError(null);
    requestAnimationFrame(() => {
      if (settingsNavigationTrigger.current?.isConnected) settingsNavigationTrigger.current.focus();
    });
  }, []);

  const registerSettingsController = useCallback((controller: SettingsNavigationController | null) => {
    settingsController.current = controller;
    const next = controller
      ? { dirty: controller.dirty, valid: controller.valid, saving: controller.saving, error: controller.error }
      : { dirty: false, valid: true, saving: false, error: null };
    setSettingsNavigationState((current) => current.dirty === next.dirty && current.valid === next.valid && current.saving === next.saving && current.error === next.error ? current : next);
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
      const [c, r, he, s, info] = await Promise.all([
        api.listCourses(),
        queryResourceInventory(),
        queryHistoryInventory(),
        api.listHistoryScans(),
        api.dbInfo(),
        refreshCollections.current(),
      ]);
      if (generation !== refreshGeneration.current) {
        if (requireSuccess) throw new Error("History refresh superseded; retry refresh.");
        return;
      }
      setCourses(c);
      setResources(r);
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
      await add<{ phase: string }>("sync:progress", (payload) =>
        setSync((prev) => (prev ? { ...prev, phase: payload.phase, running: true } : prev)),
      );
      await add<unknown>("sync:done", () => {
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

  const eventKinds = useMemo(() => new Map((inbox.page?.items ?? []).flatMap(item => item.resourceId == null ? [] : [[item.resourceId, new Set(item.changeTypes)] as const])), [inbox.page]);
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

  const restartQuantaSession = useCallback(async () => {
    const result = await api.restartQuantaSession();
    await refreshStatus();
    if (result.status === "connected") await refresh();
    return result;
  }, [refresh, refreshStatus]);

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

  const selectDetails = useCallback((owner: ViewId, subject: DetailSubject, origin: HTMLElement, restoreFocus?: RestoreDetailFocus) => {
    const next = { ...subject, owner, identity: detailIdentity(subject) };
    selectionRef.current = next;
    const generation = ++selectionGeneration.current;
    const lookup = ++localLookupGeneration.current;
    lastRow.current = origin;
    restoreRow.current = restoreFocus;
    setSelection(next);
    setPeekLocal(null);
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
  }, [notify, lookupLocalFile]);

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
  const downloadAndOpen = useCallback(async (resourceId: number) => {
    if (materialSubmission.current.has(resourceId)) return;
    materialSubmission.current.add(resourceId);
    setMaterialPending(new Set(materialSubmission.current));
    const generation = selectionGeneration.current;
    try {
      const local = await (mirror?.ensureLocal ?? api.ensureLocal)(resourceId);
      const selected = selectionRef.current;
      const resource = selected?.kind === "resource" ? selected.resource : selected?.kind === "change" ? selected.resource : null;
      if (generation === selectionGeneration.current && resource?.id === resourceId) {
        ++localLookupGeneration.current;
        setPeekLocal(local);
        setLocalLookup("ready");
      }
      void mirror?.refresh();
      await api.openLocalFile(resourceId);
      notify(`Opened saved copy: ${local.path}`);
    } catch (err) {
      notify(`Could not download and open material: ${String(err)}`, true);
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

  const copyLocalPath = useCallback(
    (path: string | null | undefined) => {
      if (!path) {
        notify("No local copy yet.", true);
        return;
      }
      void copyText(path, "Path copied.");
    },
    [notify, copyText],
  );

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
      return {
        ...changePresentation(event),
        primaryAction: actions[0] ? { label: actions[0].label, onClick: actions[0].onSelect } : null,
        menu: actions.slice(1),
      };
    }
    if (selection?.kind === "scan") {
      const base = scanPresentation(selection.scan);
      const detail = scanDetail?.scanId === selection.scan.id ? scanDetail : null;
      const diagnostics = detail?.details;
      if (!diagnostics) return {
        ...base,
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
    const localStatus = peekResource.isExternal ? undefined : mirror?.statusOf(peekResource.id) ?? local;
    const actions = destinations(peekResource, selection?.kind === "change" ? selection.change : undefined);
    const primary = actions.find((action) => action.id !== "preview");
    const preview = actions.find((action) => action.id === "preview");
    const presentation = {
      ...todayPresentation(peekResource, eventKinds.get(peekResource.id)),
      ...(selection?.kind === "change" ? {
        ...changePresentation(selection.change),
        properties: [
          ...changePresentation(selection.change).properties,
          ...todayPresentation(peekResource).properties.filter(({ label }) => ["Section", "Preview", "Availability"].includes(label)),
        ],
      } : {}),
    };
    const dueEntry = agendaEntries([{ resource: peekResource, dateKind: /^\d{4}-\d{2}-\d{2}$/.test(peekResource.dueAt ?? "") ? "date" : "instant", coursePaused: false }], now, timeZone)[0];
    return {
      ...presentation,
      properties: [...presentation.properties.filter(property => !["Due", "Due date"].includes(property.label)), { label: "Due", value: dueEntry ? `${peekResource.dueAt} (${dueEntry.label}${dueEntry.item.dateKind === "date" ? "; date only" : `; ${timeZone}`})` : "Due date unavailable" }],
      note: [presentation.note, peekResource.availabilityStatus !== "available" ? "Source unavailable. Saved copies remain separate from source availability." : null].filter(Boolean).join(" ") || null,
      primaryAction: primary ? { label: primary.label, onClick: primary.onSelect, disabled: primary.disabled } : null,

      local:
        localStatus === undefined
          ? undefined
          : {
              status: localStatus?.status ?? (localLookup === "loading" ? "Loading local copy…" : localLookup === "error" ? "Local copy unavailable" : "No local copy yet"),
              error: localStatus?.error ?? null,
              sizeBytes: local?.sizeBytes ?? null,
              path: local?.path ?? null,
            },
      onOpenLocal: () => void openLocal(peekResource.id),
      onRevealLocal: local && isLocal(localStatus) ? () =>
        void api.revealLocalFile(peekResource.id).catch((err) => notify(String(err), true)) : undefined,
      onCopyLocalPath: () => void copyLocalPath(local?.path),
      secondaryAction: preview ? { label: preview.label, onClick: preview.onSelect } : null,
      menu: [
        ...actions.filter((action) => action !== primary && action !== preview),
        {
          id: "copy",
          label: "Copy link",
          onSelect: () =>
            void copyText(peekResource.sourcePageUrl ?? peekResource.url, "Link copied."),
        },
      ],
    };
  }, [selection, scanDetail, peekResource, peekLocal, localLookup, mirror, eventKinds, now, timeZone, destinations, openLocal, copyLocalPath, copyText, handleSync, notify]);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      { id: "sync", label: "Sync now", shortcut: "Mod+Shift+S", onSelect: () => void handleSync() },
      { id: "theme", label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme", shortcut: "Mod+Shift+L", onSelect: toggle },
      { id: "rail", label: "Toggle sidebar", shortcut: "Mod+\\", onSelect: toggleSidebar },
    ],
    [handleSync, resolved, toggle, toggleSidebar],
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
    return search ? (search.focus(), true) : false;
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
        if (!focusCurrentViewSearch()) setPaletteOpen(true);
      },
      "$mod+1": whenNoModal(() => navigate("today")),
      "$mod+2": whenNoModal(() => navigate("calendar")),
      "$mod+3": whenNoModal(() => navigate("library")),
      "$mod+4": whenNoModal(() => navigate("history")),
      "$mod+5": whenNoModal(() => navigate("settings")),
      "$mod+Comma": whenNoModal(() => navigate("settings")),
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
        if (event.defaultPrevented || previewResource || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
        if (drawerOpen) setDrawerOpen(false);
        else if (selection) closePeek();
      },
    },
    !paletteOpen && !showLogin,
  );

  if (!booted) {
    return (
      <div className="login-wrap">
        <div className="muted">Starting Quanta Pulse…</div>
      </div>
    );
  }

  const sessionExpired = Boolean(auth?.sessionExpired || sync?.authState === "expired");
  if ((!auth?.authenticated && !sessionExpired) || showLogin) {
    return (
      <LoginScreen
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

  const currentLabel = NAV.find((item) => item.id === route.view)?.label ?? "Inbox";
  const currentCourse =
    route.courseId == null ? null : courses.find((c) => c.id === route.courseId) ?? null;

  // The single breadcrumb: 'Library / <course display name>' plus folders.
  const breadcrumb = currentCourse
    ? {
        items: [
          { label: "Library", onClick: () => navigateToCourse(null) },
          ...(route.folderPath ?? []).slice(0, -1).map((segment, index) => ({
            label: segment,
            onClick: () =>
              navigateToCourse(route.courseId, (route.folderPath ?? []).slice(0, index + 1)),
          })),
        ],
        current: route.folderPath?.length
          ? (route.folderPath[route.folderPath.length - 1] as string)
          : (courseLabel(route.courseId)?.name ?? currentCourse.name),
      }
    : { items: [], current: currentLabel };

  return (
    <MaterialActionsContext.Provider value={destinations}>
    <TooltipProvider>
      <div className={cx("app", collapsed && "rail", drawerOpen && "drawer-open")}>
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
          unreadByCourse={unreadByCourse}
          unreadTotal={unread}
          activeCourseId={route.courseId}
          onCourse={(courseId) => {
            navigateToCourse(courseId);
            if (narrow) setDrawerOpen(false);
          }}
          sync={sync}
          onSync={() => void handleSync()}
          onOpenScans={() => {
            navigate("history");
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
          {sessionExpired && (
            <div className="banner-region">
              <SessionRefreshBanner
                sessionExpired
                onRestart={restartQuantaSession}
              />
            </div>
          )}

          <TopBar
            items={breadcrumb.items}
            current={currentCourse ? breadcrumb.current : ""}
            actions={
              <>
                <AppearancePopover appearance={appearance} />
                <IconButton
                  label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  onClick={toggle}
                >
                  {resolved === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                </IconButton>
              </>
            }
          />

          <SyncProgress running={Boolean(sync?.running)} progress={sync?.progress ?? 0} />

          <WorkspacePanel
            content={<main className="app-main" ref={mainRef}>
              <div className="page">
                {route.view === "today" && (
                  <InboxView
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
                    due={agendaDue} dueFilter={dueFilter} setDueFilter={setDueFilter} now={now} timeZone={timeZone}
                    onChanged={refresh}
                    courses={courses}
                    resources={resources}
                    onOpen={(url) => void open(url)}
                    onOpenLocal={(resourceId) => void openLocal(resourceId)}
                    onDownloadOpen={(id) => void downloadAndOpen(id)} onPreview={setPreviewResource}
                    onOpenScan={() => navigate("history")}
                    onOpenCourse={navigateToCourse}
                    details={detailsAdapters.calendar}
                  />
                )}
                {route.view === "library" && (
                  <LibraryView
                    courses={courses}
                    resources={resources}
                    courseId={route.courseId}
                    folderPath={route.folderPath}
                    onNavigate={navigateToCourse}
                    unreadByCourse={unreadByCourse}
                    details={detailsAdapters.library}
                    loading={loading}
                    error={loadError}
                    onRetry={() => void refresh()}
                    onChanged={refresh}
                    onActivityChanged={() => refresh(true)}
                    onOpen={(url) => void open(url)}
                    initialSearch={librarySearch}
                    initialSearchKey={librarySearchRequest}
                    onSyncNow={() => void handleSync()}
                  />
                )}
                {route.view === "history" && (
                  <HistoryView
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
            status={null}
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
          />
        )}

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onView={navigate}
          courses={courses}
          onCourse={navigateToCourse}
          resources={resources}
          onInspectResource={(resource) => { setPendingPaletteInspection(resource); navigate("library"); }}
          onSeeAllFiles={(query) => { setLibrarySearch(query); setLibrarySearchRequest((previous) => previous + 1); navigate("library"); }}
          actions={paletteActions}
        />

        <Dialog
          open={Boolean(pendingSettingsNavigation)}
          onOpenChange={(open) => { if (!open) stayOnSettings(); }}
          label="Unsaved settings"
          role="alertdialog"
          className="dialog-confirm"
        >
          <h2 className="dialog-title">Unsaved settings</h2>
          <p className="dialog-body">Save your changes before leaving Settings?</p>
          {settingsNavigationError && <p className="dialog-body" role="alert">{settingsNavigationError}</p>}
          <div className="dialog-footer">
            <Button variant="ghost" onClick={stayOnSettings}>Stay</Button>
            <Button variant="danger" onClick={() => void resolveSettingsNavigation("discard")}>Discard</Button>
            <Button
              variant="primary"
              disabled={!settingsNavigationState.valid || settingsNavigationState.saving}
              loading={settingsNavigationState.saving}
              onClick={() => void resolveSettingsNavigation("save")}
            >Save</Button>
          </div>
        </Dialog>

        <Toaster toasts={toasts} onDismiss={dismissToast} />
      </div>
      </TooltipProvider>
    </MaterialActionsContext.Provider>
  );
}

// Application shell: authentication gate, navigation, data loading and the
// event bridge from the Rust backend, wrapped in the redesign's five-view
// shell (sidebar, top bar, peek panel, palette, toasts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Moon, Sun } from "lucide-react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import PeekPanel, { type PeekDetails } from "./components/PeekPanel";
import CommandPalette, { type PaletteAction } from "./components/CommandPalette";
import SessionRefreshBanner from "./components/SessionRefreshBanner";
import LoginScreen from "./components/LoginScreen";
import PreviewDialog from "./components/PreviewDialog";
import SyncProgress from "./components/SyncProgress";
import { IconButton } from "./components/ui/IconButton";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { TooltipProvider } from "./components/ui/Tooltip";
import { Toaster, type ToastItem } from "./components/ui/Toast";
import TodayView from "./views/TodayView";
import CalendarView from "./views/CalendarView";
import LibraryView from "./views/LibraryView";
import HistoryView from "./views/HistoryView";
import SettingsView from "./views/SettingsView";
import type { SettingsNavigationController } from "./views/SettingsView";
import { api } from "./lib/api";
import { useTheme } from "./hooks/useTheme";
import { useHotkey } from "./hooks/useHotkey";
import { MirrorProvider, useMirror } from "./hooks/useMirror";
import { isLocal } from "./lib/mirrorState";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { resolveView, NAV, type ViewId } from "./lib/nav";
import { cx } from "./lib/cx";
import {
  changePresentation, detailIdentity, scanPresentation, todayPresentation,
  type DetailSelection, type DetailSubject, type DetailsAdapter, type RestoreDetailFocus,
} from "./lib/details";
import { canPreview } from "./lib/preview";
import { relativeLabel } from "./lib/format";
import { registerCourseLabels, courseLabel } from "./lib/courseName";
import type {
  AuthStatus,
  ChangeEvent,
  Course,
  DbInfo,
  LocalFile,
  Resource,
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
  return <MirrorProvider><AppShell /></MirrorProvider>;
}

function AppShell() {
  const { themeMode, setThemeMode, resolved, toggle } = useTheme();

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
  const [dashboardResources, setDashboardResources] = useState<Resource[]>([]);
  const [dashboardEvents, setDashboardEvents] = useState<ChangeEvent[]>([]);
  const [historyEvents, setHistoryEvents] = useState<ChangeEvent[]>([]);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [unread, setUnread] = useState(0);
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const [showLogin, setShowLogin] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selection, setSelection] = useState<DetailSelection | null>(null);
  const selectionRef = useRef<DetailSelection | null>(null);
  const selectionGeneration = useRef(0);
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
  const lastRow = useRef<HTMLElement | null>(null);

  // Below this width the sidebar is a rail and expands over the content.
  const narrow = useMediaQuery("(max-width: 959px)");
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, dr, de, he, s, u, info] = await Promise.all([
        api.listCourses(),
        api.listResources(),
        api.listDashboardResources(),
        api.listDashboardEvents(),
        api.listHistoryEvents(),
        api.listHistoryScans(),
        api.unreadCount(),
        api.dbInfo(),
      ]);
      setCourses(c);
      setResources(r);
      setDashboardResources(dr);
      setDashboardEvents(de);
      setHistoryEvents(he);
      setScans(s);
      setUnread(u);
      setDbInfo(info);
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
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
                const u = await api.checkUpdate();
                if (!u) return;
                await api.prepareForUpdate();
                await api.downloadAndInstallUpdate(u, () => {});
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

  const eventKinds = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const e of dashboardEvents) {
      if (e.resourceId == null) continue;
      if (!map.has(e.resourceId)) map.set(e.resourceId, new Set());
      map.get(e.resourceId)!.add(e.changeType);
    }
    return map;
  }, [dashboardEvents]);

  const unreadIds = useMemo(
    () =>
      new Set(
        dashboardEvents.filter((e) => !e.read && e.resourceId != null).map((e) => e.resourceId as number),
      ),
    [dashboardEvents],
  );

  const unreadByCourse = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of dashboardEvents) {
      if (e.read || e.courseId == null || e.resourceId == null) continue;
      map.set(e.courseId, (map.get(e.courseId) ?? 0) + 1);
    }
    return map;
  }, [dashboardEvents]);

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

  const clearDashboardActivity = useCallback(async () => {
    try {
      await api.clearDashboardActivity();
      await refresh();
      notify("Activity cleared.");
    } catch (err) {
      notify(String(err), true);
      throw err;
    }
  }, [notify, refresh]);

  const clearHistoryActivity = useCallback(async () => {
    try {
      await api.clearHistoryActivity();
      setHistoryEvents([]);
      setScans([]);
      setUnread(0);
      await refresh();
      notify("History cleared.");
    } catch (err) {
      notify(String(err), true);
      throw err;
    }
  }, [notify, refresh]);

  const markAllRead = useCallback(async () => {
    const visible = dashboardEvents.filter((e) => !e.read).length;
    setDashboardEvents((current) => current.map((e) => ({ ...e, read: true })));
    setUnread((current) => Math.max(0, current - visible));
    try {
      await api.markAllRead();
      await refresh();
    } catch (err) {
      await refresh();
      notify(String(err), true);
    }
  }, [dashboardEvents, notify, refresh]);

  const toggleResourceRead = useCallback(
    async (resource: Resource) => {
      const ids = dashboardEvents
        .filter((e) => e.resourceId === resource.id && !e.read)
        .map((e) => e.id);
      if (ids.length === 0) return;
      try {
        await api.markRead(ids);
        await refresh();
      } catch (err) {
        notify(String(err), true);
      }
    },
    [dashboardEvents, notify, refresh],
  );

  const markHistoryRead = useCallback(async () => {
    const visibleUnread = historyEvents.filter((event) => !event.read).length;
    setHistoryEvents((current) => current.map((event) => ({ ...event, read: true })));
    setUnread((current) => Math.max(0, current - visibleUnread));
    try {
      await api.markAllRead();
      await refresh();
      notify("History marked as read.");
    } catch (err) {
      await refresh();
      notify(String(err), true);
      throw err;
    }
  }, [historyEvents, notify, refresh]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setAuth(await api.authStatus());
    setResources([]);
    setDashboardResources([]);
    setDashboardEvents([]);
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

  /** Opens the local copy, downloading it first when it is not on disk. */
  const openLocal = useCallback(
    async (resourceId: number) => {
      try {
        await api.openLocalFile(resourceId);
      } catch (err) {
        notify(String(err), true);
      }
    },
    [notify],
  );

  /** Download on demand (P0) and tell the user what happened. */
  const ensureLocal = useCallback(
    async (resourceId: number) => {
      const generation = selectionGeneration.current;
      try {
        const local = await (mirror?.ensureLocal ?? api.ensureLocal)(resourceId);
        const selected = selectionRef.current;
        const resource = selected?.kind === "resource" ? selected.resource
          : selected?.kind === "change" ? selected.resource : null;
        if (generation === selectionGeneration.current && resource?.id === resourceId) {
          // A lookup started before this download cannot replace its result.
          ++localLookupGeneration.current;
          setPeekLocal(local);
          setLocalLookup("ready");
        }
        void mirror?.refresh();
        notify("Saved to this computer.");
      } catch (err) {
        notify(String(err), true);
      }
    },
    [notify, mirror],
  );

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

  const closePeek = useCallback(() => {
    if (!selectionRef.current) return;
    selectionRef.current = null;
    ++selectionGeneration.current;
    setSelection(null);
    setPeekLocal(null);
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

  const peekDetails: PeekDetails | null = useMemo(() => {
    if (selection?.kind === "change" && !peekResource) {
      const event = selection.change;
      const fileUrl = event.resourceUrl;
      const pageUrl = event.sourcePageUrl;
      return {
        ...changePresentation(event),
        primaryAction: fileUrl ? { label: "Open file", onClick: () => void open(fileUrl) } : null,
        secondaryAction: pageUrl ? { label: "Open Quanta page", onClick: () => void open(pageUrl) } : null,
      };
    }
    if (selection?.kind === "scan") return scanPresentation(selection.scan);
    if (!peekResource) return null;
    const previewable = canPreview(peekResource.resourceType, peekResource.url);
    const local = peekLocal && peekLocal.resourceId === peekResource.id ? peekLocal : null;
    const localStatus = peekResource.isExternal
      ? undefined
      : mirror?.statusOf(peekResource.id) ?? local;
    return {
      ...todayPresentation(peekResource, eventKinds.get(peekResource.id)),
      ...(selection?.kind === "change" ? changePresentation(selection.change) : {}),
      primaryAction:
        localStatus && isLocal(localStatus)
          ? { label: "Open local copy", onClick: () => void openLocal(peekResource.id) }
          : { label: "Open file", onClick: () => void open(peekResource.url) },
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
      onDownloadNow: () => void ensureLocal(peekResource.id),
      onRedownload: () => void ensureLocal(peekResource.id),
      secondaryAction: previewable
        ? { label: "Preview", onClick: () => setPreviewResource(peekResource) }
        : null,
      menu: [
        ...(peekResource.sourcePageUrl
          ? [
              {
                id: "page",
                label: "Open Quanta page",
                onSelect: () => void open(peekResource.sourcePageUrl as string),
              },
            ]
          : []),
        {
          id: "copy",
          label: "Copy link",
          onSelect: () =>
            void copyText(peekResource.sourcePageUrl ?? peekResource.url, "Link copied."),
        },
        ...(selection?.kind === "resource" ? [{
          id: "read",
          label: unreadIds.has(peekResource.id) ? "Mark as read" : "Mark as unread",
          onSelect: () => void toggleResourceRead(peekResource),
        }] : []),
      ],
    };
  }, [selection, peekResource, peekLocal, localLookup, mirror, eventKinds, unreadIds, open, openLocal, ensureLocal, copyLocalPath, copyText, notify, toggleResourceRead]);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      { id: "sync", label: "Sync now", shortcut: "Mod+Shift+S", onSelect: () => void handleSync() },
      { id: "read", label: "Mark all read", onSelect: () => void markAllRead() },
      { id: "theme", label: "Switch theme", shortcut: "Mod+Shift+L", onSelect: toggle },
      { id: "rail", label: "Toggle sidebar", shortcut: "Mod+\\", onSelect: toggleSidebar },
    ],
    [handleSync, markAllRead, toggle, toggleSidebar],
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

  const currentLabel = NAV.find((item) => item.id === route.view)?.label ?? "Today";
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
          onView={navigate}
          courses={courses}
          unreadByCourse={unreadByCourse}
          unreadTotal={unread}
          activeCourseId={route.courseId}
          onCourse={navigateToCourse}
          sync={sync}
          onSync={() => void handleSync()}
          onOpenScans={() => navigate("history")}
          onOpenPalette={() => setPaletteOpen(true)}
          collapsed={collapsed}
          onToggle={collapsed && narrow ? () => setDrawerOpen(true) : toggleSidebar}
          overlay={narrow && drawerOpen}
        />

        <div className="work">
          <TopBar
            items={breadcrumb.items}
            current={breadcrumb.current}
            actions={
              <IconButton
                label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                onClick={toggle}
              >
                {resolved === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </IconButton>
            }
          />

          {sessionExpired && (
            <div className="banner-region">
              <SessionRefreshBanner
                sessionExpired
                onRestart={restartQuantaSession}
              />
            </div>
          )}

          <SyncProgress running={Boolean(sync?.running)} progress={sync?.progress ?? 0} />

          <main className="app-main" ref={mainRef}>
            <div className="page">
              {route.view === "today" && (
                <TodayView
                  resources={dashboardResources}
                  hasStoredResources={resources.length > 0}
                  courses={courses}
                  eventKinds={eventKinds}
                  unreadIds={unreadIds}
                  lastSyncLabel={sync?.lastSuccessAt ? relativeLabel(sync.lastSuccessAt) : null}
                  loading={loading}
                  error={loadError}
                  onRetry={() => void refresh()}
                  selectedId={peekResource?.id ?? null}
                  onSelect={detailsAdapters.today.selectResource}
                  onSelectionRemoved={detailsAdapters.today.clear}
                  onOpen={(url) => void open(url)}
                  onOpenLocal={(resourceId) => void openLocal(resourceId)}
                  onPreview={setPreviewResource}
                  onToggleRead={(resource) => void toggleResourceRead(resource)}
                  onMarkAllRead={() => void markAllRead()}
                  onClearActivity={clearDashboardActivity}
                  onSyncNow={() => void handleSync()}
                  onOpenCourse={navigateToCourse}
                />
              )}
              {route.view === "calendar" && (
                <CalendarView
                  courses={courses}
                  resources={resources}
                  onOpen={(url) => void open(url)}
                  onOpenLocal={(resourceId) => void openLocal(resourceId)}
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
                  onChanged={() => void refresh()}
                  onOpen={(url) => void open(url)}
                  onSyncNow={() => void handleSync()}
                />
              )}
              {route.view === "history" && (
                <HistoryView
                  courses={courses}
                  scans={scans}
                  events={historyEvents}
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
                  themeMode={themeMode}
                  onThemeMode={setThemeMode}
                  onController={registerSettingsController}
                />
              )}
            </div>
          </main>
        </div>

        <PeekPanel
          selectionKey={selection ? `${selection.identity}:${selectionGeneration.current}` : undefined}
          open={selection?.owner === route.view && Boolean(peekDetails)}
          details={peekDetails}
          onClose={closePeek}
          onCopy={(text) => void copyText(text, "Copied.")}
        />

        {previewResource && (
          <PreviewDialog
            resource={previewResource}
            open
            onOpenChange={(next) => {
              if (!next) setPreviewResource(null);
            }}
            onOpen={(url) => void open(url)}
          />
        )}

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onView={navigate}
          courses={courses}
          onCourse={navigateToCourse}
          resources={resources}
          onOpenResource={(url) => void open(url)}
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
  );
}

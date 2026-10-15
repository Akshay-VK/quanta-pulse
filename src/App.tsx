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
import { TooltipProvider } from "./components/ui/Tooltip";
import { Toaster, type ToastItem } from "./components/ui/Toast";
import TodayView from "./views/TodayView";
import CalendarView from "./views/CalendarView";
import LibraryView from "./views/LibraryView";
import HistoryView from "./views/HistoryView";
import SettingsView from "./views/SettingsView";
import { api } from "./lib/api";
import { useTheme } from "./hooks/useTheme";
import { useHotkey } from "./hooks/useHotkey";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { resolveView, NAV, type ViewId } from "./lib/nav";
import { cx } from "./lib/cx";
import { resourceDetails } from "./lib/details";
import { canPreview } from "./lib/preview";
import { relativeLabel } from "./lib/format";
import { registerCourseLabels, courseLabel } from "./lib/courseName";
import type {
  AuthStatus,
  ChangeEvent,
  Course,
  DbInfo,
  Resource,
  ScanRun,
  Settings,
  SyncStatus,
} from "./lib/types";
import type { StatusKind } from "./components/ui/StatusTag";

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
  const { themeMode, setThemeMode, resolved, toggle } = useTheme();

  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [booted, setBooted] = useState(false);
  const [route, setRoute] = useState<Route>(START);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
  const [peekResource, setPeekResource] = useState<Resource | null>(null);
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);
  const lastRow = useRef<HTMLElement | null>(null);

  // Below this width the sidebar is a rail and expands over the content.
  const narrow = useMediaQuery("(max-width: 959px)");
  const collapsed = narrow || sidebarCollapsed;

  const backStack = useRef<Route[]>([]);

  /** Every navigation goes through here, so Alt+Left has something to undo. */
  const go = useCallback(
    (next: Route) => {
      setRoute((prev) => {
        backStack.current = [...backStack.current, prev].slice(-25);
        return next;
      });
    },
    [],
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
    const prev = backStack.current.pop();
    if (prev) setRoute(prev);
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

  const notify = useCallback((message: string, error = false) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, error }]);
  }, []);

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

  const openPeek = useCallback((resource: Resource) => {
    lastRow.current = document.activeElement as HTMLElement | null;
    setPeekResource(resource);
  }, []);

  const closePeek = useCallback(() => {
    setPeekResource(null);
    lastRow.current?.focus();
  }, []);

  const peekDetails: PeekDetails | null = useMemo(() => {
    if (!peekResource) return null;
    const kinds = eventKinds.get(peekResource.id);
    let statusTag: { kind: StatusKind; label: string } | null = null;
    if (peekResource.availabilityStatus !== "available") {
      statusTag = { kind: "unavailable", label: "Unavailable" };
    } else if (kinds?.has("announcement")) {
      statusTag = { kind: "note", label: "Announcement" };
    } else if (kinds?.has("updated")) {
      statusTag = { kind: "updated", label: "Updated" };
    } else if (kinds?.has("new")) {
      statusTag = { kind: "new", label: "New" };
    }
    const previewable = canPreview(peekResource.resourceType, peekResource.url);
    return {
      statusTag,
      title: peekResource.title,
      properties: resourceDetails(peekResource),
      note:
        peekResource.availabilityStatus !== "available"
          ? "Missing for 2 scans in a row. It may come back."
          : null,
      primaryAction: { label: "Open file", onClick: () => void open(peekResource.url) },
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
            void navigator.clipboard?.writeText(
              peekResource.sourcePageUrl ?? peekResource.url,
            ),
        },
        {
          id: "read",
          label: unreadIds.has(peekResource.id) ? "Mark as read" : "Mark as unread",
          onSelect: () => void toggleResourceRead(peekResource),
        },
      ],
    };
  }, [peekResource, eventKinds, unreadIds, open, toggleResourceRead]);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      { id: "sync", label: "Sync now", shortcut: "Mod+Shift+S", onSelect: () => void handleSync() },
      { id: "read", label: "Mark all read", onSelect: () => void markAllRead() },
      { id: "theme", label: "Switch theme", shortcut: "Mod+Shift+L", onSelect: toggle },
      { id: "rail", label: "Toggle sidebar", shortcut: "Mod+\\", onSelect: toggleSidebar },
    ],
    [handleSync, markAllRead, toggle, toggleSidebar],
  );

  useHotkey(
    {
      "$mod+k": (e) => {
        e.preventDefault();
        setPaletteOpen(true);
      },
      Slash: (e) => {
        e.preventDefault();
        setPaletteOpen(true);
      },
      "$mod+1": () => navigate("today"),
      "$mod+2": () => navigate("calendar"),
      "$mod+3": () => navigate("library"),
      "$mod+4": () => navigate("history"),
      "$mod+5": () => navigate("settings"),
      "Comma": () => navigate("settings"),
      "$mod+Shift+S": () => void handleSync(),
      "$mod+Shift+L": () => toggle(),
      "$mod+Backslash": () => {
        if (narrow) setDrawerOpen((open) => !open);
        else toggleSidebar();
      },
      "$mod+ArrowLeft": () => goBack(),
      Escape: () => {
        if (drawerOpen) setDrawerOpen(false);
        else if (peekResource) closePeek();
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

          <main className="app-main">
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
                  onSelect={openPeek}
                  onOpen={(url) => void open(url)}
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
                  onOpen={(url) => void open(url)}
                  onOpenScan={() => navigate("history")}
                  onOpenCourse={navigateToCourse}
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
                  onOpen={(url) => void open(url)}
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
                />
              )}
            </div>
          </main>
        </div>

        <PeekPanel open={Boolean(peekDetails)} details={peekDetails} onClose={closePeek} />

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

        <Toaster toasts={toasts} onDismiss={dismissToast} />
      </div>
    </TooltipProvider>
  );
}
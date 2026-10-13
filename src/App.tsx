// Application shell: authentication gate, navigation, data loading and the
// event bridge from the Rust backend.

import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import Header from "./components/Header";
import LoginScreen from "./components/LoginScreen";
import Dashboard from "./views/Dashboard";
import CoursesView from "./views/CoursesView";
import ResourcesView from "./views/ResourcesView";
import HistoryView from "./views/HistoryView";
import CalendarView from "./views/CalendarView";
import SettingsView from "./views/SettingsView";
import SessionRefreshBanner from "./components/SessionRefreshBanner";
import { api } from "./lib/api";
import type { FeedKind } from "./lib/filter";
import type {
  AuthStatus,
  ChangeEvent,
  Course,
  DbInfo,
  Resource,
  ScanRun,
  Settings,
  SyncStatus,
  ThemeMode,
} from "./lib/types";

type View = "calendar" | "history" | "dashboard" | "resources" | "courses" | "settings";

function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem("quanta-pulse-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    return "system";
  }
}

const NAV: { id: View; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "history", label: "History" },
  { id: "dashboard", label: "Dashboard" },
  { id: "resources", label: "Resources" },
  { id: "courses", label: "Courses" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>("calendar");

  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [dashboardResources, setDashboardResources] = useState<Resource[]>([]);
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const [dashboardEvents, setDashboardEvents] = useState<ChangeEvent[]>([]);
  const [historyEvents, setHistoryEvents] = useState<ChangeEvent[]>([]);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [unread, setUnread] = useState(0);
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("quanta-pulse-theme", themeMode);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  const [kind, setKind] = useState<FeedKind>("all");
  const [courseId, setCourseId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [c, r, dr, e, de, he, s, u, info] = await Promise.all([
        api.listCourses(),
        api.listResources(),
        api.listDashboardResources(),
        api.listEvents(false, 1000),
        api.listDashboardEvents(),
        api.listHistoryEvents(),
        api.listHistoryScans(),
        api.unreadCount(),
        api.dbInfo(),
      ]);
      setCourses(c);
      setResources(r);
      setDashboardResources(dr);
      setEvents(e);
      setDashboardEvents(de);
      setHistoryEvents(he);
      setScans(s);
      setUnread(u);
      setDbInfo(info);
    } catch (err) {
      setToast(String(err));
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
      setToast(String(err));
    }
  }, []);

  // Initial load.
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

    const register = async () => {
      const add = async <T,>(name: string, handler: (payload: T) => void) => {
        const un = await listen<T>(name, (event) => handler(event.payload));
        if (cancelled) un();
        else unlisteners.push(un);
      };

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
      await add<string>("ui:navigate", (target) => setView(target as View));
    };

    void register();
    return () => {
      cancelled = true;
      unlisteners.forEach((un) => un());
    };
  }, [refresh, refreshStatus]);

  // Toast auto-dismiss.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const eventKinds = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const e of dashboardEvents) {
      if (e.resourceId == null) continue;
      if (!map.has(e.resourceId)) map.set(e.resourceId, new Set());
      map.get(e.resourceId)!.add(e.changeType);
    }
    return map;
  }, [dashboardEvents]);

  const open = useCallback(async (url: string) => {
    try {
      await api.openExternal(url);
    } catch (err) {
      setToast(String(err));
    }
  }, []);

  const handleSync = useCallback(async () => {
    try {
      setSync((prev) => (prev ? { ...prev, running: true, phase: "Starting" } : prev));
      const outcome = await api.syncNow();
      if (outcome.authExpired) {
        setAuth((prev) => prev ? { ...prev, sessionExpired: true } : prev);
      } else if (outcome.errors.length > 0 && outcome.discovered === 0) {
        setToast("Sync could not reach Quanta. It will retry automatically.");
      }
      await refresh();
      await refreshStatus();
    } catch (err) {
      setToast(String(err));
    }
  }, [refresh, refreshStatus]);

  const restartQuantaSession = useCallback(async () => {
    const result = await api.restartQuantaSession();
    await refreshStatus();
    if (result.status === "connected") {
      await refresh();
    }
    return result;
  }, [refresh, refreshStatus]);

  const clearDashboardActivity = useCallback(async () => {
    try {
      await api.clearDashboardActivity();
      await refresh();
      setToast("Dashboard activity cleared.");
    } catch (err) {
      setToast(String(err));
      throw err;
    }
  }, [refresh]);

  const clearHistoryActivity = useCallback(async () => {
    try {
      await api.clearHistoryActivity();
      setHistoryEvents([]);
      setScans([]);
      setUnread(0);
      await refresh();
      setToast("History cleared.");
    } catch (err) {
      setToast(String(err));
      throw err;
    }
  }, [refresh]);

  const markHistoryRead = useCallback(async () => {
    const visibleUnread = historyEvents.filter((event) => !event.read).length;
    setHistoryEvents((current) => current.map((event) => ({ ...event, read: true })));
    setUnread((current) => Math.max(0, current - visibleUnread));
    try {
      await api.markAllRead();
      await refresh();
      setToast("History entries marked as read.");
    } catch (err) {
      await refresh();
      setToast(String(err));
      throw err;
    }
  }, [historyEvents, refresh]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setAuth(await api.authStatus());
    setResources([]);
    setDashboardResources([]);
    setEvents([]);
    setDashboardEvents([]);
    setHistoryEvents([]);
    setCourses([]);
  }, []);

  const saveSettings = useCallback(
    async (next: Settings) => {
      const saved = await api.setSettings(next);
      setSettings(saved);
    },
    [],
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
      <>
        {toast && (
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10 }} className="alert error">
            {toast}
          </div>
        )}
        <LoginScreen onCancel={auth?.authenticated ? () => setShowLogin(false) : undefined} onAuthenticated={(status) => {
          setShowLogin(false);
          setAuth(status);
          void refreshStatus();
          void refresh();
        }} />
      </>
    );
  }

  return (
    <div className="app">
      <Header
        sync={sync}
        onSync={handleSync}
        themeMode={themeMode}
        onThemeMode={setThemeMode}
      />

      <SessionRefreshBanner
        sessionExpired={sessionExpired}
        onRestart={restartQuantaSession}
      />

      <nav className="app-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item${view === item.id ? " active" : ""}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
            {item.id === "history" && unread > 0 && <span className="nav-badge">{unread}</span>}
          </button>
        ))}
      </nav>

      {toast && <div className="app-toast alert error">{toast}</div>}

      <main className="app-main">
        {view === "dashboard" && (
          <Dashboard
            resources={dashboardResources}
            hasStoredResources={resources.length > 0}
            courses={courses}
            eventKinds={eventKinds}
            kind={kind}
            onKind={setKind}
            courseId={courseId}
            onCourse={setCourseId}
            search={search}
            onSearch={setSearch}
            onOpen={open}
            onClearAll={clearDashboardActivity}
          />
        )}
        {view === "courses" && (
          <CoursesView
            courses={courses}
            resources={resources}
            sync={sync}
            onChanged={() => void refresh()}
            onOpen={open}
          />
        )}
        {view === "resources" && (
          <ResourcesView resources={resources} courses={courses} onOpen={open} />
        )}
        {view === "history" && (
          <HistoryView
            scans={scans}
            events={historyEvents}
            onOpen={open}
            onMarkAllRead={markHistoryRead}
            onClearAll={clearHistoryActivity}
          />
        )}
        {view === "calendar" && <CalendarView events={events} courses={courses} onOpen={open} />}
        {view === "settings" && settings && (
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
      </main>
    </div>
  );
}

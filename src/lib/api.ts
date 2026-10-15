// Typed wrappers around the Tauri command surface.

import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  SessionResetResult,
  SessionRefreshResult,
  CacheStats,
  ChangeEvent,
  Course,
  DbInfo,
  Digest,
  Resource,
  ResourceFilter,
  ResourcePreview,
  ScanOutcome,
  ScanRun,
  Settings,
  SyncStatus,
} from "./types";

export const api = {
  login: (email: string, password: string) =>
    invoke<AuthStatus>("login", { email, password }),
  startSsoLogin: () => invoke<AuthStatus>("start_sso_login"),
  authStatus: () => invoke<AuthStatus>("auth_status"),
  refreshSession: () => invoke<SessionRefreshResult>("refresh_session"),
  restartQuantaSession: () => invoke<SessionResetResult>("restart_quanta_session"),
  logout: () => invoke<void>("logout"),

  listCourses: () => invoke<Course[]>("list_courses"),
  listResources: (filter: ResourceFilter = {}) =>
    invoke<Resource[]>("list_resources", { filter }),
  listDashboardResources: () => invoke<Resource[]>("list_dashboard_resources"),
  listEvents: (unreadOnly = false, limit = 200) =>
    invoke<ChangeEvent[]>("list_events", { unreadOnly, limit }),
  listDashboardEvents: () => invoke<ChangeEvent[]>("list_dashboard_events"),
  listHistoryEvents: () => invoke<ChangeEvent[]>("list_history_events"),
  eventsRange: (from?: string, to?: string, courseId?: number, limit = 2000) =>
    invoke<ChangeEvent[]>("events_range", {
      from: from ?? null,
      to: to ?? null,
      courseId: courseId ?? null,
      limit,
    }),
  listScans: (limit = 50) => invoke<ScanRun[]>("list_scans", { limit }),
  listHistoryScans: (limit = 50) => invoke<ScanRun[]>("list_history_scans", { limit }),
  clearDashboardActivity: () => invoke<void>("clear_dashboard_activity"),
  clearHistoryActivity: () => invoke<void>("clear_history_activity"),
  unreadCount: () => invoke<number>("unread_count"),
  markRead: (ids: number[]) => invoke<void>("mark_read", { ids }),
  markAllRead: () => invoke<void>("mark_all_read"),
  dailyDigest: (date?: string) => invoke<Digest>("daily_digest", { date: date ?? null }),

  syncNow: () => invoke<ScanOutcome>("sync_now"),
  cancelSync: () => invoke<void>("cancel_sync"),
  syncStatus: () => invoke<SyncStatus>("sync_status"),

  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<Settings>("set_settings", { settings }),

  rebuildBaseline: (courseId?: number) =>
    invoke<void>("rebuild_baseline", { courseId: courseId ?? null }),
  setMonitoring: (courseId: number, status: string) =>
    invoke<void>("set_monitoring", { courseId, status }),

  /** Fetch a resource through the authenticated session for in-app preview. */
  previewResource: (resourceId: number) =>
    invoke<ResourcePreview>("preview_resource", { resourceId }),

  testNotification: () => invoke<void>("test_notification"),
  dbInfo: () => invoke<DbInfo>("db_info"),
  cacheStats: () => invoke<CacheStats>("cache_stats"),
  clearFileCache: () => invoke<CacheStats>("clear_file_cache"),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
};

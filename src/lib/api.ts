// Typed wrappers around the Tauri command surface.

import { invoke } from "@tauri-apps/api/core";
import { loadAliases, saveAliases } from "./courseName";
import type {
  InboxFilter,
  InboxPage,
  DueFilter,
  DuePage,
  AuthStatus,
  SessionResetResult,
  SessionRefreshResult,
  CacheStats,
  ChangeEvent,
  Course,
  DbInfo,
  Digest,
  LocalFile,
  LocalFileStatus,
  MirrorStats,
  MirrorDownloadProgress,
  Resource,
  ResourceFilter,
  ResourcePreview,
  ScanOutcome,
  ScanDetails,
  ScanRun,
  Settings,
  SyncStatus,
  TelegramStatus,
} from "./types";

import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export const api = {
  login: (email: string, password: string) =>
    invoke<AuthStatus>("login", { email, password }),
  startSsoLogin: () => invoke<AuthStatus>("start_sso_login"),
  authStatus: () => invoke<AuthStatus>("auth_status"),
  refreshSession: () => invoke<SessionRefreshResult>("refresh_session"),
  restartQuantaSession: () => invoke<SessionResetResult>("restart_quanta_session"),
  logout: () => invoke<void>("logout"),

  queryInbox: (filter: InboxFilter = {}) => invoke<InboxPage>("query_inbox", { filter }),
  snapshotInboxEventIds: (filter: InboxFilter = {}) =>
    invoke<number[]>("snapshot_inbox_event_ids", { filter }),
  setEventReadState: (eventIds: number[], desiredRead: boolean) =>
    invoke<void>("set_event_read_state", { eventIds, desiredRead }),
  dismissInboxEvents: (eventIds: number[]) =>
    invoke<void>("dismiss_inbox_events", { eventIds }),
  deleteHistory: (includeScans: boolean) => invoke<void>("delete_history", { includeScans }),
  queryDueResources: (filter: DueFilter = {}) =>
    invoke<DuePage>("query_due_resources", { filter }),

  listCourses: () => invoke<Course[]>("list_courses"),
  setCourseDisplayName: async (courseId: number, displayName: string | null) => {
    const course = await invoke<Course>("set_course_display_name", { courseId, displayName });
    // A successful durable rename/reset supersedes this course's old local alias.
    const aliases = loadAliases();
    if (aliases[String(courseId)] !== undefined) {
      delete aliases[String(courseId)];
      saveAliases(aliases);
    }
    return course;
  },
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
  scanDetails: (scanId: number) => invoke<ScanDetails | null>("scan_details", { scanId }),
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
  openNotificationSettings: () => invoke<void>("open_notification_settings"),

  /** Installed app version (read from the binary, never hard-coded). */
  appVersion: () => invoke<string>("app_version"),
  /** Wait for in-flight work to finish before installing an update. */
  prepareForUpdate: () => invoke<void>("prepare_for_update"),

  /** GitHub-releases update check (manual). Reuse the plugin's signed check. */
  checkUpdate: async (): Promise<Update | null> => {
    const { check } = await import("@tauri-apps/plugin-updater");
    // Both the Settings action and the shell's install prompt use this seam.
    // Bound the network request so a stalled release feed stays retryable.
    return check({ timeout: 30_000 });
  },
  /** Download, verify and install the given update, then exit. Progress is reported via the callback. */
  downloadAndInstallUpdate: (update: Update, onEvent: (event: DownloadEvent) => void) =>
    update.downloadAndInstall(onEvent),
  /** Relaunch the app after an update installs. */
  relaunchApp: async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },

  /** The permanent mirror: occupancy and queue state. */
  mirrorStats: () => invoke<MirrorStats>("mirror_status"),
  /** One status per indexed resource, for row icons. */
  mirrorLocalFiles: () => invoke<LocalFileStatus[]>("mirror_local_files"),
  mirrorDownloadProgress: () => invoke<MirrorDownloadProgress[]>("mirror_download_progress"),
  cancelMirrorDownload: (resourceId: number) =>
    invoke<void>("cancel_mirror_download", { resourceId }),
  retryMirrorDownload: (resourceId: number) =>
    invoke<MirrorDownloadProgress>("retry_mirror_download", { resourceId }),
  /** The resolved copy of one resource, for the peek panel's path and size. */
  mirrorLocalFile: (resourceId: number) =>
    invoke<LocalFile | null>("mirror_local_file", { resourceId }),
  mirrorStartBackfill: () => invoke<MirrorStats>("mirror_start_backfill"),
  mirrorPause: () => invoke<MirrorStats>("mirror_pause"),
  mirrorResume: () => invoke<MirrorStats>("mirror_resume"),
  mirrorRetryFailed: () => invoke<MirrorStats>("mirror_retry_failed"),
  /** Re-hash local copies and requeue what is missing or corrupt. */
  mirrorVerifyFiles: () => invoke<MirrorStats>("mirror_verify_files"),
  /** Remove every local copy. Manual action only. */
  mirrorDeleteAll: () => invoke<MirrorStats>("mirror_delete_all"),
  /** Move existing files to a new mirror root. */
  mirrorMoveFiles: () => invoke<MirrorStats>("mirror_move_files"),
  /** Pick a different mirror folder. */
  pickMirrorRoot: () => invoke<MirrorStats>("pick_mirror_root"),

  /** Open or reveal a resource's local copy, downloading it first if needed. */
  openLocalFile: (resourceId: number) => invoke<void>("open_local_file", { resourceId }),
  revealLocalFile: (resourceId: number) =>
    invoke<void>("reveal_local_file", { resourceId }),
  ensureLocal: (resourceId: number) => invoke<LocalFile>("ensure_local", { resourceId }),

  /** 'Open' / 'Show in folder' for the database, logs and mirror folders. */
  openAppFolder: (kind: "database" | "logs" | "mirror" | "backups", reveal = false) =>
    invoke<void>("open_app_folder", { kind, reveal }),

  /** Telegram forwarding: whether the bot is on and reachable. */
  telegramStatus: () => invoke<TelegramStatus>("telegram_status"),
  /** Send one message to the configured chat. */
  telegramTest: () => invoke<void>("telegram_test"),
};

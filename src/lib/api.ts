// Typed wrappers around the Tauri command surface.

import { acceptAcademicContext, academicEpoch, invalidateAcademicSession, sameAcademicSession } from "./academicSession";
import { invoke } from "@tauri-apps/api/core";
import { loadAliases, saveAliases } from "./courseName";
import type {
  AcademicContext,
  AcademicPage,
  AssignmentObservation,
  GradeObservation,
  AttendanceObservation,
  InboxFilter,
  InboxPage,
  HistoryFilter,
  HistoryPage,
  HistoryDeletionScope,
  HistoryDeletionResult,
  ScanFilter,
  ScanPage,
  DueFilter,
  DuePage,
  AuthStatus,
  SessionResetResult,
  SessionRefreshResult,
  CacheStats,
  ChangeEvent,
  Course,
  DesktopSearchInventory,
  DbInfo,
  Digest,
  LocalFile,
  LocalFileStatus,
  MirrorStats,
  MirrorDeleteScope,
  MirrorDeleteResult,
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

function mirrorDeleteAll(): Promise<MirrorStats>;
function mirrorDeleteAll(scopeId: string): Promise<MirrorDeleteResult>;
function mirrorDeleteAll(scopeId?: string): Promise<MirrorStats | MirrorDeleteResult> {
  if (scopeId === undefined) return invoke<MirrorStats>("mirror_delete_all");
  return invoke<MirrorDeleteResult>("mirror_delete_scope", { scopeId });
}

async function academicRead<T>(command: string, generation: string, courseId: number): Promise<AcademicPage<T>> {
  const epoch = academicEpoch();
  const page = await invoke<AcademicPage<T>>(command, { generation, courseId });
  if (epoch !== academicEpoch() || page.context.generation !== generation) throw new Error("Academic session changed");
  const current = await invoke<AcademicContext>("academic_context");
  if (epoch !== academicEpoch() || !sameAcademicSession(page.context, current)) throw new Error("Academic session changed");
  acceptAcademicContext(current, epoch);
  return page;
}

export const api = {
  academicContext: async () => {
    const epoch = academicEpoch();
    const context = await invoke<AcademicContext>("academic_context");
    acceptAcademicContext(context, epoch);
    return context;
  },
  academicAssignments: (generation: string, courseId: number) => academicRead<AssignmentObservation>("academic_assignments", generation, courseId),
  academicGrades: (generation: string, courseId: number) => academicRead<GradeObservation>("academic_grades", generation, courseId),
  academicAttendance: (generation: string, courseId: number) => academicRead<AttendanceObservation>("academic_attendance", generation, courseId),
  login: (email: string, password: string) => {
    invalidateAcademicSession();
    return invoke<AuthStatus>("login", { email, password });
  },
  startSsoLogin: () => { invalidateAcademicSession(); return invoke<AuthStatus>("start_sso_login"); },
  focusSsoLogin: (attemptId: string) => invoke<void>("focus_sso_login", { attemptId }),
  cancelSsoLogin: (attemptId: string) => invoke<void>("cancel_sso_login", { attemptId }),
  authStatus: () => invoke<AuthStatus>("auth_status"),
  refreshSession: () => invoke<SessionRefreshResult>("refresh_session"),
  restartQuantaSession: () => { invalidateAcademicSession(); return invoke<SessionResetResult>("restart_quanta_session"); },
  logout: () => { invalidateAcademicSession(); return invoke<void>("logout"); },

  queryInbox: (filter: InboxFilter = {}) => invoke<InboxPage>("query_inbox", { filter }),
  snapshotInboxEventIds: (filter: InboxFilter = {}) =>
    invoke<number[]>("snapshot_inbox_event_ids", { filter }),
  setEventReadState: (eventIds: number[], desiredRead: boolean) =>
    invoke<void>("set_event_read_state", { eventIds, desiredRead }),
  dismissInboxEvents: (eventIds: number[]) =>
    invoke<void>("dismiss_inbox_events", { eventIds }),
  /** Legacy whole-table deletion; new confirmations must use a frozen scope. */
  deleteHistory: (includeScans: boolean) => invoke<void>("delete_history", { includeScans }),
  snapshotHistoryDeletion: (includeScans: boolean) =>
    invoke<HistoryDeletionScope>("snapshot_history_deletion", { includeScans }),
  deleteHistorySnapshot: (scope: HistoryDeletionScope) =>
    invoke<HistoryDeletionResult>("delete_history_snapshot", { scope }),
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
  listSearchInventory: () => invoke<DesktopSearchInventory>("list_search_inventory"),
  listDashboardResources: () => invoke<Resource[]>("list_dashboard_resources"),
  listEvents: (unreadOnly = false, limit = 200) =>
    invoke<ChangeEvent[]>("list_events", { unreadOnly, limit }),
  listDashboardEvents: () => invoke<ChangeEvent[]>("list_dashboard_events"),
  listHistoryEvents: () => invoke<ChangeEvent[]>("list_history_events"),
  queryHistoryEvents: (filter: HistoryFilter) =>
    invoke<HistoryPage>("query_history_events", { filter }),
  queryHistoryScans: (filter: ScanFilter) =>
    invoke<ScanPage>("query_history_scans", { filter }),
  snapshotResourceUnreadEventIds: (resourceId: number) =>
    invoke<number[]>("snapshot_resource_unread_event_ids", { resourceId }),
  snapshotResourceEventIds: (resourceIds: number[]) =>
    invoke<number[]>("snapshot_resource_event_ids", { resourceIds }),
  eventsRange: (from?: string, to?: string, courseId?: number, limit = 2000, offset = 0) =>
    invoke<ChangeEvent[]>("events_range", {
      from: from ?? null,
      to: to ?? null,
      courseId: courseId ?? null,
      limit,
      offset,
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
  /** Capture the exact saved files covered by a destructive confirmation. */
  snapshotMirrorDeleteScope: () => invoke<MirrorDeleteScope>("snapshot_mirror_delete_scope"),
  /** Remove the captured scope; zero arguments preserves legacy Settings behavior. */
  mirrorDeleteAll,
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

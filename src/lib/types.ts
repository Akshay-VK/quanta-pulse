// Types mirrored from the Rust backend (serde camelCase).

/** User-selected colour theme. "system" follows the OS appearance. */
export type ThemeMode = "system" | "light" | "dark";

export interface Course {
  id: number;
  externalCourseId: string;
  name: string;
  shortName: string | null;
  url: string;
  firstSeenAt: string;
  lastScannedAt: string | null;
  lastScanStatus: string | null;
  monitoringStatus: string;
  resourceCount: number;
}

export interface Resource {
  id: number;
  externalResourceId: string;
  courseId: number | null;
  courseName: string | null;
  title: string;
  /** Direct file / download URL of the resource. */
  url: string;
  /** Original page where the resource's link was listed (course, section or
   * folder page). `null` until discovery has captured a listing page. */
  sourcePageUrl: string | null;
  resourceType: string;
  uploadedAt: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  dueAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string | null;
  lastCheckedAt: string | null;
  contentFingerprint: string | null;
  availabilityStatus: string;
  sizeBytes: number | null;
  section: string | null;
  /** Ordered real Quanta section and nested page names; empty until discovered. */
  sectionPath?: string[];
  isExternal: boolean;
}

export interface ChangeEvent {
  id: number;
  resourceId: number | null;
  courseId: number | null;
  courseName: string | null;
  resourceTitle: string | null;
  resourceUrl: string | null;
  /** Listing page of the resource, when the linked resource row knows one. */
  sourcePageUrl: string | null;
  sectionPath?: string[];
  resourceType: string | null;
  uploadedAt: string | null;
  changeType: string;
  title: string;
  description: string | null;
  detectedAt: string;
  read: boolean;
}

export interface ScanRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: string;
  discoveredCount: number;
  newCount: number;
  updatedCount: number;
  unavailableCount: number;
  coursesScanned: number;
  coursesFailed: number;
  errorSummary: string | null;
  isBaseline: boolean;
}

export interface SyncStatus {
  running: boolean;
  phase: string;
  progress: number;
  lastSuccessAt: string | null;
  nextScheduledAt: string | null;
  /** Unread new/announcement events — never a "since last scan" window. */
  unreadNew: number;
  lastError: string | null;
  authState: string;
}

export interface AuthStatus {
  authenticated: boolean;
  email: string | null;
  fullName: string | null;
  method: string | null;
  acquiredAt: string | null;
  sessionExpired: boolean;
}

export interface SessionRefreshResult {
  status: "restored" | "login_required" | "failed";
  message: string;
}

export interface SessionResetResult {
  status: "connected" | "login_required" | "failed";
  message: string;
}

export interface Settings {
  syncIntervalMinutes: number;
  launchAtLogin: boolean;
  runInBackground: boolean;
  notificationsEnabled: boolean;
  notifyNew: boolean;
  notifyUpdated: boolean;
  notifyAnnouncements: boolean;
  notifyDeadlines: boolean;
  notifyAvailability: boolean;
  notifyAuth: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  deadlineReminderHours: number;
  timezone: string;
  /** LRU ceiling for the local file cache, in bytes. */
  cacheLimitBytes: number;
  // The permanent local mirror. It never evicts and never deletes.
  /** Download new and updated resources as each scan finds them. */
  mirrorEnabled: boolean;
  /** Explicit mirror root, or null for the default under Documents. */
  mirrorRoot: string | null;
  /** Files larger than this are skipped. 0 means no limit. */
  mirrorMaxBytes: number;
  /** Pause rather than fill the disk below this free-space floor. */
  mirrorMinFreeBytes: number;
  /** Superseded copies kept per resource under `.history`. */
  mirrorKeepVersions: number;
  maxCourses: number;
  maxResourcesPerCourse: number;
  maxDetailFetches: number;
  requestTimeoutSecs: number;
  concurrency: number;
}

export interface Digest {
  date: string;
  newCount: number;
  updatedCount: number;
  announcementCount: number;
  deadlineCount: number;
  unavailableCount: number;
  coursesFailed: number;
  lastSuccessAt: string | null;
  items: ChangeEvent[];
}

export interface ScanOutcome {
  discovered: number;
  new: number;
  updated: number;
  unavailable: number;
  coursesScanned: number;
  coursesFailed: number;
  errors: string[];
  authExpired: boolean;
  cancelled: boolean;
}

export interface DbInfo {
  path: string;
  sizeBytes: number;
  courseCount: number;
  resourceCount: number;
  eventCount: number;
  logDir: string | null;
}

/** Occupancy of the local byte cache. */
export interface CacheStats {
  fileCount: number;
  totalBytes: number;
  limitBytes: number;
}

/** One resource's mirror state, without a path. */
export interface LocalFileStatus {
  resourceId: number;
  /** queued | downloading | ok | failed | skipped | kept */
  status: string;
  error: string | null;
}

/** One resource's permanent local copy, resolved to an absolute path. */
export interface LocalFile {
  resourceId: number;
  /** Path relative to the mirror root, exactly as stored. */
  relPath: string;
  path: string;
  sizeBytes: number;
  mime: string | null;
  sha256: string | null;
  /** queued | downloading | ok | failed | skipped | kept */
  status: string;
  error: string | null;
}

/** Mirror occupancy and queue state, for Settings > Files and the sidebar. */
export interface MirrorStats {
  queued: number;
  downloading: number;
  done: number;
  failed: number;
  skipped: number;
  /** Local copies Quanta no longer serves. Never deleted automatically. */
  kept: number;
  totalResources: number;
  bytesDone: number;
  bytesTotal: number;
  /** idle | running | paused | low_disk | waiting_for_sign_in */
  state: string;
  root: string;
  freeBytes: number;
}

export interface ResourceFilter {
  courseId?: number | null;
  search?: string | null;
  kind?: string | null;
  limit?: number;
  offset?: number;
}

/** How a binary resource preview is rendered in the webview. */
export type PreviewMode = "pdf" | "image" | "audio" | "video";

/**
 * Result of the on-demand `preview_resource` command. Tagged by `kind` and
 * mirrors the Rust `ResourcePreview` enum exactly.
 *
 * - `text` — readable text extracted from an HTML/text response.
 * - `binary` — base64 bytes plus the renderer `mode` and `mime`.
 * - `unsupported` — a type the webview cannot render; open it externally.
 * - `tooLarge` — exceeded `limitBytes`; open it externally.
 */
export type ResourcePreview =
  | {
      kind: "text";
      text: string;
      truncated: boolean;
      sourceUrl: string;
      contentType: string | null;
    }
  | {
      kind: "binary";
      mode: PreviewMode;
      mime: string;
      data: string;
      sourceUrl: string;
      sizeBytes: number;
    }
  | {
      kind: "unsupported";
      reason: string;
      sourceUrl: string;
      contentType: string | null;
    }
  | {
      kind: "tooLarge";
      sizeBytes: number | null;
      limitBytes: number;
      sourceUrl: string;
    };

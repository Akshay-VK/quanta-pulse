// Types mirrored from the Rust backend (serde camelCase).

/** User-selected colour theme. "system" follows the OS appearance. */
export type ThemeMode = "system" | "light" | "dark";

export interface Course {
  id: number;
  externalCourseId: string;
  name: string;
  shortName: string | null;
  displayName: string | null;
  url: string;
  firstSeenAt: string;
  lastScannedAt: string | null;
  lastScanStatus: string | null;
  monitoringStatus: string;
  resourceCount: number;
}

export interface DesktopSearchInventory {
  courses: Course[];
  resources: Resource[];
  /** Canonical resource attention, from the same SQLite read transaction. */
  unreadResourceIds: number[];
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

export type HistoryChangeType =
  | "new"
  | "updated"
  | "announcement"
  | "deadline"
  | "unavailable"
  | "restored"
  | "baseline";

/** History date bounds are RFC 3339 instants; since is inclusive, until exclusive. */
export interface HistoryFilter {
  offset: number;
  limit: number;
  changeType?: HistoryChangeType;
  courseId?: number;
  since?: string;
  until?: string;
  search?: string;
}

export interface ScanFilter {
  offset: number;
  limit: number;
}

export interface HistoryPage {
  items: ChangeEvent[];
  total: number;
}

export interface ScanPage {
  items: ScanRun[];
  total: number;
}

/** Exact History IDs frozen for a destructive confirmation. */
export interface HistoryDeletionScope {
  eventIds: number[];
  scanIds: number[];
}

/** Number of rows removed from a previously confirmed History scope. */
export interface HistoryDeletionResult {
  eventsDeleted: number;
  scansDeleted: number;
}

export type ScanCourseStatus = "success" | "partial" | "failed" | "cancelled";

export interface ScanDetails {
  scanId: number;
  courses: ScanCourseDetail[];
}

export interface ScanCourseDetail {
  courseId: number | null;
  courseName: string;
  status: ScanCourseStatus;
  startedAt: string;
  completedAt: string | null;
  steps: ScanStep[];
  error: string | null;
}

export interface ScanStep {
  label: string;
  status: ScanCourseStatus;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
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
  attemptId: string | null;
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
  /** Check for updates in the background. Default on. */
  updateAutoCheck: boolean;
  notificationsEnabled: boolean;
  notifyNew: boolean;
  notifyUpdated: boolean;
  notifyAnnouncements: boolean;
  notifyDeadlines: boolean;
  notifyAvailability: boolean;
  notifyAuth: boolean;
  notifyScanFailures: boolean;
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
  // Telegram forwarding through the user's own bot.
  /** Forward change events to the configured chat. */
  telegramEnabled: boolean;
  /** Bot token from @BotFather. Sent only to api.telegram.org. */
  telegramBotToken: string | null;
  /** Numeric chat id, or @channel. */
  telegramChatId: string | null;
  maxCourses: number;
  maxResourcesPerCourse: number;
  maxDetailFetches: number;
  requestTimeoutSecs: number;
  concurrency: number;
}

/** What Settings > Telegram shows. Never carries the token. */
export interface TelegramStatus {
  enabled: boolean;
  configured: boolean;
  chatId: string | null;
  botUsername: string | null;
  error: string | null;
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
  committed: boolean;
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

/** Byte progress for one uniquely identified mirror attempt. */
export interface MirrorDownloadProgress {
  resourceId: number;
  attemptId: string;
  state: "queued" | "downloading" | "failed" | "cancelled" | "saved";
  bytesDone: number;
  bytesTotal: number | null;
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

/** Frozen mirror files captured for one destructive confirmation. */
export interface MirrorDeleteScope {
  scopeId: string;
  count: number;
}

/** One saved-file entry still needing cleanup in a frozen deletion scope. */
export interface MirrorDeleteFailure {
  resourceId: number;
  path: string;
  error: string;
}

/** Work completed and outstanding failures from one scoped deletion attempt. */
export interface MirrorDeleteResult {
  removed: number;
  failed: MirrorDeleteFailure[];
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

/** Type/search selects entire groups; pagination never limits counts or snapshots. */
export interface InboxFilter {
  courseId?: number;
  changeType?: "new" | "updated" | "announcement" | "deadline" | "unavailable" | "restored";
  attention?: "all" | "unread";
  search?: string;
  offset?: number;
  limit?: number;
}
export interface InboxItem {
  key: string;
  resourceId: number | null;
  courseId: number | null;
  latestEvent: ChangeEvent;
  eventIds: number[];
  changeTypes: string[];
  unread: boolean;
}
export interface InboxCourseCount {
  courseId: number | null;
  total: number;
  unreadTotal: number;
}
export interface InboxPage {
  items: InboxItem[];
  total: number;
  unreadTotal: number;
  courseCounts: InboxCourseCount[];
}
/** Range is [from, until), RFC 3339 or YYYY-MM-DD (midnight UTC).
 * Date-only source values remain dates; local agenda grouping belongs to the UI.
 */
export interface DueFilter {
  courseId?: number;
  resourceType?: string;
  search?: string;
  from?: string;
  until?: string;
  /** YYYY-MM-DD bounds for date-only sources; override instant range for them. */
  dateFrom?: string;
  dateUntil?: string;
  offset?: number;
  limit?: number;
}
export interface DueResource {
  resource: Resource;
  dateKind: "date" | "instant";
  coursePaused: boolean;
  /** Private display projection, kept off the shared material record. */
  projectedDueAt?: string;
}
export interface DuePage { items: DueResource[]; total: number }

// Private academic read contracts, version 1. Domain collectors remain unverified.
export interface AcademicOwner { origin: string; moodleUserId: number }
export interface AcademicContext { contractVersion: 1; generation: string; owner: AcademicOwner | null; collectorsEnabled: boolean }
export type AcademicCoverageStatus = "complete" | "partial" | "denied" | "unsupported" | "offline" | "cancelled" | "failed";
export type AcademicVisibility = "visible" | "hidden" | "unreleased" | "unknown";
export type AcademicDate = { kind: "unknown" } | { kind: "unset" } | { kind: "unsupported" } | { kind: "instant" | "dateOnly" | "ambiguous"; value: string };
export interface AcademicSource { sourceId: string; sourceUrl: string; observedAt: string; visibility: AcademicVisibility }
export interface AssignmentObservation {
  source: AcademicSource; title: string; courseModuleId: number | null; activityInstanceId: number | null;
  resourceId: number | null; due: AcademicDate; dueDisplay: string | null; submissionDisplay: string | null; calendarEventId: number | null; submissionStatus: "unknown" | "unsubmitted" | "draft" | "submitted" | "reopened" | "notRequired" | "notYetOpen"; attemptNumber: number | null;
  details?: AssignmentFacts | null;
}
export interface AssignmentFacts {
  baseDue: AcademicDate;
  effectiveDue: AcademicDate;
  opening: AcademicDate;
  extension: AcademicDate;
  cutOff: AcademicDate;
  gradingDue: AcademicDate;
  dueProvenance: "unknown" | "base" | "effective" | "extension";
  mode: "unknown" | "individual" | "team";
  pendingTeamConfirmations: number | null;
  timeLimitSeconds: number | null;
  description: string | null;
  attachments: { title: string; url: string }[];
  gradingStatus: string | null;
  releasedFeedback: string | null;
}
export interface GradeObservation {
  source: AcademicSource; title: string; gradeItemId: number | null; parentSourceId: string | null;
  itemKind: "item" | "category" | "categoryTotal" | "courseTotal"; displayValue: string | null; numericValue: number | null;
  rangeDisplay: string | null; weightDisplay: string | null; feedback: string | null;
  details?: {
    valueStatus: "reported" | "blank" | "ungraded" | "unknown";
    percentageDisplay: string | null;
    letterDisplay: string | null;
  } | null;
  omitted?: boolean;
}
export interface AttendanceObservation {
  source: AcademicSource; activityInstanceId: number; courseModuleId: number | null; sessionId: number | null; scopeDisplay: string;
  statusDisplay: string | null; pointsDisplay: string | null; maximumDisplay: string | null; summaryDisplay: string | null;
}
export interface AcademicCoverage {
  permission: "unknown" | "permitted" | "restricted";
  reason: "incompleteSource" | "permissionDenied" | "sourceUnverified" | "networkUnavailable" | "workCancelled" | "collectionFailed" | null;
  coverage: AcademicCoverageStatus; observedAt: string; lastSuccessfulAt: string | null; baselineEstablished: boolean; stale: boolean;
}
export interface AcademicPage<T> { context: AcademicContext; courseId: number; coverage: AcademicCoverage | null; records: T[] }

export interface SavedContentResults {
  state: "empty" | "building" | "cancelled" | "ready" | "limited" | "stale" | "tooLarge" | "queryTooLong" | "unavailable" | "unsupported";
  indexed: number;
  skipped: number;
  hits: { resourceId: number; snippet: string }[];
}

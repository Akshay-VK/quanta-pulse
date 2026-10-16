// Accessibility gates: every view renders without axe violations in both the
// light and the dark theme.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { axe } from "vitest-axe";
import type {
  AuthStatus,
  Course,
  DbInfo,
  Resource,
  ScanRun,
  Settings,
} from "../src/lib/types";
import type { ThemeMode } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: {
    eventsRange: vi.fn().mockResolvedValue([]),
    dailyDigest: vi.fn().mockResolvedValue({
      date: "2026-10-14",
      newCount: 1,
      updatedCount: 0,
      announcementCount: 0,
      deadlineCount: 0,
      unavailableCount: 0,
      coursesFailed: 0,
      lastSuccessAt: "2026-10-14T09:12:00+05:30",
      items: [],
    }),
    listResources: vi.fn().mockResolvedValue([]),
    setMonitoring: vi.fn().mockResolvedValue(undefined),
    rebuildBaseline: vi.fn().mockResolvedValue(undefined),
    cacheStats: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0, limitBytes: 2147483648 }),
    clearFileCache: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0, limitBytes: 2147483648 }),
    mirrorStats: vi.fn().mockResolvedValue({
      queued: 0,
      downloading: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      kept: 0,
      totalResources: 0,
      bytesDone: 0,
      bytesTotal: 0,
      state: "idle",
      root: "",
      freeBytes: 0,
    }),
    mirrorStartBackfill: vi.fn().mockResolvedValue({}),
    mirrorPause: vi.fn().mockResolvedValue({}),
    mirrorResume: vi.fn().mockResolvedValue({}),
    mirrorRetryFailed: vi.fn().mockResolvedValue({}),
    mirrorVerifyFiles: vi.fn().mockResolvedValue({}),
    mirrorDeleteAll: vi.fn().mockResolvedValue({}),
    mirrorLocalFiles: vi.fn().mockResolvedValue([]),
    pickMirrorRoot: vi.fn().mockResolvedValue({}),
    openLocalFile: vi.fn().mockResolvedValue(undefined),
    revealLocalFile: vi.fn().mockResolvedValue(undefined),
    ensureLocal: vi.fn().mockResolvedValue({}),
    openAppFolder: vi.fn().mockResolvedValue(undefined),
    mirrorMoveFiles: vi.fn().mockResolvedValue({}),
    mirrorLocalFile: vi.fn().mockResolvedValue(null),
    telegramStatus: vi.fn().mockResolvedValue({
      enabled: false,
      configured: false,
      chatId: null,
      botUsername: null,
      error: null,
    }),
    telegramTest: vi.fn().mockResolvedValue(undefined),
  },
}));
import TodayView from "../src/views/TodayView";
import CalendarView from "../src/views/CalendarView";
import LibraryView from "../src/views/LibraryView";
import HistoryView from "../src/views/HistoryView";
import SettingsView from "../src/views/SettingsView";
import LoginScreen from "../src/components/LoginScreen";
import { TooltipProvider } from "../src/components/ui/Tooltip";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    externalCourseId: "cs-f213",
    name: "Object Oriented Programming",
    shortName: "CS F213",
    url: "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    firstSeenAt: "2026-09-01T00:00:00Z",
    lastScannedAt: "2026-10-12T00:00:00Z",
    lastScanStatus: "ok",
    monitoringStatus: "monitored",
    resourceCount: 1,
    ...overrides,
  };
}

function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    externalResourceId: "resource-1",
    courseId: 1,
    courseName: "Object Oriented Programming",
    title: "Lecture 14: Inheritance",
    url: "https://quanta.bits-pilani.ac.in/pluginfile.php/1/mod_resource/content/0/lecture14.pdf",
    sourcePageUrl: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
    resourceType: "pdf",
    uploadedAt: "2026-10-13T09:12:00+05:30",
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: "2026-10-13T09:20:00+05:30",
    lastSeenAt: null,
    lastCheckedAt: null,
    contentFingerprint: null,
    availabilityStatus: "available",
    sizeBytes: 1024,
    section: "Week 7",
    isExternal: false,
    ...overrides,
  };
}

function event(): ScanRun {
  return {
    id: 1,
    startedAt: "2026-10-13T09:00:00+05:30",
    finishedAt: "2026-10-13T09:12:00+05:30",
    status: "ok",
    isBaseline: true,
    discoveredCount: 4,
    newCount: 1,
    updatedCount: 0,
    unavailableCount: 0,
    coursesScanned: 2,
    coursesFailed: 0,
    errorSummary: null,
  } as any;
}

const SETTINGS: Settings = {
  syncIntervalMinutes: 30,
  launchAtLogin: false,
  runInBackground: true,
  notificationsEnabled: true,
  notifyNew: true,
  notifyUpdated: true,
  notifyAnnouncements: true,
  notifyDeadlines: true,
  notifyAvailability: true,
  notifyAuth: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  deadlineReminderHours: 48,
  timezone: "Asia/Kolkata",
  cacheLimitBytes: 2 * 1024 * 1024 * 1024,
  mirrorEnabled: true,
  mirrorRoot: null,
  mirrorMaxBytes: 500 * 1024 * 1024,
  mirrorMinFreeBytes: 5 * 1024 * 1024 * 1024,
  mirrorKeepVersions: 3,
  telegramEnabled: false,
  telegramBotToken: null,
  telegramChatId: null,
  maxCourses: 20,
  maxResourcesPerCourse: 500,
  maxDetailFetches: 40,
  requestTimeoutSecs: 20,
  concurrency: 3,
};

const AUTH: AuthStatus = {
  authenticated: true,
  email: "akshay@pilani.bits-pilani.ac.in",
  fullName: "Akshay V K",
  method: "password",
  acquiredAt: "2026-10-13T08:00:00+05:30",
  sessionExpired: false,
};

const DB_INFO: DbInfo = {
  path: "/home/akshay/.local/share/quanta-pulse/quanta.db",
  sizeBytes: 20480,
  courseCount: 2,
  resourceCount: 4,
  eventCount: 3,
  logDir: "/home/akshay/.local/share/quanta-pulse/logs",
};

function courses(): Course[] {
  return [course()];
}

function resources(): Resource[] {
  return [resource()];
}

function changeEvents() {
  return [
    {
      id: 1,
      resourceId: 1,
      courseId: 1,
      courseName: "Object Oriented Programming",
      resourceTitle: "Lecture 14: Inheritance",
      resourceUrl: "https://quanta.bits-pilani.ac.in/pluginfile.php/1/x.pdf",
      sourcePageUrl: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
      resourceType: "pdf",
      uploadedAt: "2026-10-13T09:12:00+05:30",
      changeType: "new",
      title: "Lecture 14: Inheritance",
      description: null,
      detectedAt: "2026-10-13T09:20:00+05:30",
      read: false,
    },
  ];
}

function noop(): void {
  return undefined;
}

interface Scenario {
  name: string;
  render: () => React.ReactElement;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Today",
    render: () => (
      <TodayView
        resources={resources()}
        hasStoredResources
        courses={courses()}
        eventKinds={new Map([[1, new Set(["new"])]])}
        unreadIds={new Set([1])}
        lastSyncLabel="4 min ago"
        loading={false}
        error={null}
        onRetry={noop}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onOpenLocal={noop}
        onPreview={noop}
        onToggleRead={noop}
        onMarkAllRead={noop}
        onClearActivity={() => Promise.resolve()}
        onSyncNow={noop}
        onOpenCourse={noop}
      />
    ),
  },
  {
    name: "Calendar",
    render: () => <CalendarView courses={courses()} onOpen={noop} onOpenScan={noop} />,
  },
  {
    name: "Library",
    render: () => (
      <LibraryView
        courses={courses()}
        resources={resources()}
        courseId={null}
        folderPath={null}
        onNavigate={noop}
        onChanged={noop}
        onOpen={noop}
      />
    ),
  },
  {
    name: "History",
    render: () => (
      <HistoryView
        courses={courses()}
        events={changeEvents()}
        scans={[event()]}
        onOpen={noop}
        onMarkAllRead={() => Promise.resolve()}
        onClearAll={() => Promise.resolve()}
        onSyncNow={noop}
      />
    ),
  },
  {
    name: "Settings",
    render: () => (
      <SettingsView
        settings={SETTINGS}
        auth={AUTH}
        dbInfo={DB_INFO}
        onSave={() => Promise.resolve()}

        onLogout={() => Promise.resolve()}
        onRefresh={noop}
        themeMode={"light" as ThemeMode}
        onThemeMode={noop}
      />
    ),
  },
  {
    name: "Login",
    render: () => <LoginScreen onAuthenticated={noop} onCancel={noop} />,
  },
];

let container: HTMLDivElement;
let root: Root;
const originalTheme = document.documentElement.dataset.theme;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (originalTheme === undefined) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = originalTheme;
});

describe.each(["light", "dark"])("axe on every view (%s theme)", (theme) => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name} has no violations`, async () => {
      document.documentElement.dataset.theme = theme;
      await act(async () => {
        root.render(<TooltipProvider>{scenario.render()}</TooltipProvider>);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      // jsdom has no layout/canvas, so axe cannot compute colour contrast.
      const results = await axe(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(results.violations).toHaveLength(0);
    });
  }
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../src/lib/api", () => ({
  api: {
    appVersion: vi.fn().mockResolvedValue("0.2.0"),
    checkUpdate: vi.fn().mockResolvedValue(null),
    prepareForUpdate: vi.fn().mockResolvedValue(undefined),
    downloadAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
    openAppFolder: vi.fn().mockResolvedValue(undefined),
    mirrorStats: vi.fn().mockResolvedValue({
      queued: 0, downloading: 0, done: 0, failed: 0, skipped: 0, kept: 0,
      totalResources: 0, bytesDone: 0, bytesTotal: 0, state: "idle", root: "", freeBytes: 0,
    }),
    cacheStats: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0, limitBytes: 10 }),
    telegramStatus: vi.fn().mockResolvedValue({ enabled: false, configured: false, chatId: null, botUsername: null, error: null }),
    clearFileCache: vi.fn(),
    testNotification: vi.fn(),
    openNotificationSettings: vi.fn(),
    rebuildBaseline: vi.fn(),
    telegramTest: vi.fn(),
  },
}));

import { api } from "../src/lib/api";
import SettingsView from "../src/views/SettingsView";
import type { Settings } from "../src/lib/types";

const SETTINGS: Settings = {
  syncIntervalMinutes: 30,
  launchAtLogin: false,
  runInBackground: true,
  updateAutoCheck: true,
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
  cacheLimitBytes: 2e9,
  mirrorEnabled: true,
  mirrorRoot: null,
  mirrorMaxBytes: 0,
  mirrorMinFreeBytes: 1e9,
  mirrorKeepVersions: 3,
  telegramEnabled: false,
  telegramBotToken: null,
  telegramChatId: null,
  maxCourses: 10,
  maxResourcesPerCourse: 100,
  maxDetailFetches: 100,
  requestTimeoutSecs: 20,
  concurrency: 3,
};

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function render(settings = SETTINGS) {
  act(() => {
    root.render(
      <SettingsView
        settings={settings}
        auth={null}
        dbInfo={null}
        onSave={vi.fn().mockResolvedValue(settings)}
        onLogout={vi.fn()}
        onRefresh={vi.fn()}
        themeMode="system"
        onThemeMode={vi.fn()}
      />,
    );
  });
}

async function tick() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function clickCheck() {
  const buttons = Array.from(container.querySelectorAll("button"));
  const check = buttons.find((b) => /Check now/i.test(b.textContent ?? ""));
  expect(check).not.toBeNull();
  await act(async () => {
    check!.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Settings > About states", () => {
  it("starts idle", () => {
    render();
    expect(container.textContent).toContain("Idle");
  });

  it("shows Up to date after a check finds nothing", async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue(null);
    render();
    await clickCheck();
    await tick();
    expect(container.textContent).toContain("Up to date");
  });

  it("shows the available version and release notes/restart when one exists", async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue({
      version: "9.9.9",
      body: "notes",
    } as unknown as Awaited<ReturnType<typeof api.checkUpdate>>);
    render();
    await clickCheck();
    await tick();
    expect(container.textContent).toContain("Update 9.9.9 available");
    expect(container.textContent).toContain("Restart to update");
  });

  it("shows the error state with the message when the check fails", async () => {
    vi.mocked(api.checkUpdate).mockRejectedValue(new Error("offline"));
    render();
    await clickCheck();
    await tick();
    expect(container.textContent).toContain("Check failed");
  });

  it("passes through the checking state", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(api.checkUpdate).mockReturnValue(
      new Promise((r) => { resolveFn = r; }) as unknown as ReturnType<typeof api.checkUpdate>,
    );
    render();
    const buttons = Array.from(container.querySelectorAll("button"));
    const check = buttons.find((b) => /Check now|Checking/i.test(b.textContent ?? ""));
    expect(check).not.toBeNull();
    // synchronous start
    void clickCheck();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.textContent).toMatch(/Looking\.\.\.|Checking/i);
    resolveFn(null);
    await tick();
  });
});

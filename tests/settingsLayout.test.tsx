// A2: Settings is a centred 160px + 720px grid with an unstyled-link section
// nav, sentence-case section titles and no doubled separators. jsdom does not
// lay out CSS, so the structural contract is asserted against the stylesheet
// source as well as the DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ThemeMode } from "../src/lib/types";
import type { Settings } from "../src/lib/types";
import contentCssRaw from "../src/styles/components/content.css?raw";
import screensCssRaw from "../src/styles/components/screens.css?raw";
import uiCssRaw from "../src/styles/components/ui.css?raw";

vi.mock("../src/lib/api", () => ({
  api: {
    cacheStats: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0, limitBytes: 2147483648 }),
    clearFileCache: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0, limitBytes: 2147483648 }),
    testNotification: vi.fn().mockResolvedValue(undefined),
    openNotificationSettings: vi.fn().mockResolvedValue(undefined),
    rebuildBaseline: vi.fn().mockResolvedValue(undefined),
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
    mirrorStartBackfill: vi.fn().mockResolvedValue(undefined),
    mirrorPause: vi.fn().mockResolvedValue(undefined),
    mirrorResume: vi.fn().mockResolvedValue(undefined),
    mirrorRetryFailed: vi.fn().mockResolvedValue(undefined),
    mirrorVerifyFiles: vi.fn().mockResolvedValue(undefined),
    mirrorDeleteAll: vi.fn().mockResolvedValue(undefined),
    pickMirrorRoot: vi.fn().mockResolvedValue(null),
    mirrorMoveFiles: vi.fn().mockResolvedValue(undefined),
    openAppFolder: vi.fn().mockResolvedValue(undefined),
  },
}));

import SettingsView from "../src/views/SettingsView";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Comments removed, so a rule's selector capture is not glued to the comment
 *  above it. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const screensCss = stripComments(screensCssRaw);
const contentCss = stripComments(contentCssRaw);
const uiCss = stripComments(uiCssRaw);

/** The first declaration block whose selector list contains `selector`. The body
 *  may not contain braces, which keeps the `@layer` wrapper from swallowing the
 *  first rule inside it. */
function rule(css: string, selector: string): string {
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(",").some((s) => s.trim() === selector)) return body;
  }
  return "";
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <SettingsView
        settings={SETTINGS}
        auth={null}
        dbInfo={null}
        onSave={() => Promise.resolve()}
        onLogout={() => Promise.resolve()}
        onRefresh={() => {}}
        themeMode={"light" as ThemeMode}
        onThemeMode={() => {}}
      />,
    );
  });
}

describe("Settings structure", () => {
  it("lists one nav item per section, in spec order", async () => {
    await render();
    const labels = [...container.querySelectorAll(".settings-link")].map((el) => el.textContent);
    expect(labels).toEqual([
      "Appearance",
      "Account",
      "Notifications",
      "Monitoring",
      "Files",
      "Data",
    ]);
    expect(container.querySelectorAll(".settings-section")).toHaveLength(6);
    // The first section is the one highlighted on load.
    expect(container.querySelector(".settings-link[aria-current='true']")?.textContent).toBe(
      "Appearance",
    );
  });

  it("renders no group dividers; the rows carry the separators", async () => {
    await render();
    expect(container.querySelectorAll(".settings-group-divider")).toHaveLength(0);
    // Exactly one hairline per section, and the rule removing the last one.
    expect(rule(contentCss, ".setting-row")).toContain("border-bottom: 1px solid var(--line)");
    expect(rule(screensCss, ".settings-section .setting-row:last-child")).toContain(
      "border-bottom: 0",
    );
  });

  it("shows the notification permission as muted text beside its action", async () => {
    await render();
    const row = [...container.querySelectorAll(".setting-row")].find((el) =>
      el.querySelector(".setting-title")?.textContent?.includes("Notification permission"),
    );
    expect(row?.querySelector(".settings-inline .muted")).toBeTruthy();
    // Each control is its own element, spaced by the flex gap.
    expect(row?.querySelectorAll(".settings-inline > *").length).toBeGreaterThan(1);
  });

  it("makes Sign out a danger ghost button that opens the confirm dialog", async () => {
    await render();
    const button = [...container.querySelectorAll<HTMLButtonElement>(".btn-danger-ghost")].find(
      (el) => el.textContent?.includes("Sign out"),
    );
    expect(button).toBeTruthy();
    const row = button!.closest(".setting-row");
    expect(row?.querySelector(".setting-desc")?.textContent).toBe(
      "Ends your Quanta session on this computer.",
    );

    await act(async () => button!.click());
    expect(document.body.textContent).toContain("Sign out?");
  });
});

describe("Settings stylesheet contract", () => {
  it("centres a 160px + 720px grid with a 48px gap", () => {
    expect(rule(screensCss, ".settings-layout")).toContain(
      "grid-template-columns: 160px minmax(0, 720px)",
    );
    expect(rule(screensCss, ".settings-layout")).toContain("gap: var(--sp-12)");
    expect(rule(screensCss, ".settings-page")).toContain("margin-inline: auto");
  });

  it("renders the section list as plain 32px rows, not underlined links", () => {
    const link = rule(screensCss, ".settings-link");
    expect(link).toContain("text-decoration: none");
    expect(link).toContain("height: 32px");
    expect(link).toContain("border-radius: var(--radius-sm)");
    expect(rule(screensCss, ".settings-link[aria-current=\"true\"]")).toContain("font-weight: 600");
  });

  it("uses sentence-case dialog titles with 40px above each", () => {
    const title = rule(screensCss, ".settings-group-title");
    expect(title).toContain("font: 400 20px/26px var(--type-dialog)");
    expect(title).toContain("padding: var(--sp-10) 0 var(--sp-2)");
    expect(title).not.toContain("uppercase");
    // Only the first section loses the lead-in; the old rule matched every h2.
    expect(rule(screensCss, ".settings-section:first-child .settings-group-title")).toContain(
      "padding-top: 0",
    );
  });

  it("defines the danger ghost variant without a solid fill", () => {
    const ghost = rule(uiCss, ".btn-danger-ghost");
    expect(ghost).toContain("color: var(--t-red-fg)");
    expect(ghost).not.toContain("--danger-solid");
    expect(rule(uiCss, ".btn-danger-ghost:hover")).toContain("background: var(--t-red-bg)");
  });
});

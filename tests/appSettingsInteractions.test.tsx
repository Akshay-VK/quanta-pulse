import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import type { Settings } from "../src/lib/types";
import { appApi, button, click, deferred, emitAppEvent, escape, flushApp, renderApp, setupApp } from "./helpers/renderApp";
import { settings } from "./helpers/data";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
}));

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

async function editInterval(label = "60 min") {
  await click(button("Sync interval"));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.trim() === label);
  if (!option) throw new Error(`Missing ${label} option`);
  await click(option);
}

async function setInput(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing ${label} field`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flushApp();
}

async function openSettings() {
  await click(button("Settings"));
  await flushApp();
}

async function toggleScanFailureNotifications() {
  const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Scan failures and incomplete scans"]');
  if (!toggle) throw new Error("Missing scan-failure notification toggle");
  await click(toggle);
}

describe("Settings save and navigation in the real application", () => {
  it("keeps the scan-failure preference draft-only until save, reloads it, and discards edits", async () => {
    appApi.setSettings.mockImplementation(async (next) => next);
    app = await renderApp();
    await openSettings();
    await toggleScanFailureNotifications();
    expect(appApi.setSettings).not.toHaveBeenCalled();
    await click(button("Save settings"));
    expect(appApi.setSettings).toHaveBeenCalledWith(expect.objectContaining({ notifyScanFailures: false }));
    expect(document.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("unchecked");

    await toggleScanFailureNotifications();
    expect(document.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("checked");
    await click(button("Discard"));
    await click(button("Discard", document.querySelector('[role="alertdialog"]')!));
    expect(document.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("unchecked");
  });

  it("retains the scan-failure preference after failed save and can discard it", async () => {
    appApi.setSettings.mockRejectedValueOnce(new Error("Disk is busy"));
    app = await renderApp();
    await openSettings();
    await toggleScanFailureNotifications();
    await click(button("Save settings"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Disk is busy");
    expect(document.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("unchecked");
    await click(button("Discard"));
    await click(button("Discard", document.querySelector('[role="alertdialog"]')!));
    expect(document.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("checked");
  });

  it("preserves the scan-failure preference draft when navigation is guarded", async () => {
    app = await renderApp();
    await openSettings();
    await toggleScanFailureNotifications();
    await click(button("Inbox"));
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click(button("Stay", document.querySelector('[role="alertdialog"]')!));
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
    expect(document.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("unchecked");
    await click(button("Save settings"));
    expect(appApi.setSettings).toHaveBeenCalledWith(expect.objectContaining({ notifyScanFailures: false }));
  });

  it("retains a failed draft and retries save before navigating", async () => {
    appApi.setSettings.mockRejectedValueOnce(new Error("Disk is busy")).mockImplementationOnce(async (next) => next);
    app = await renderApp();
    await openSettings();
    await editInterval();
    await click(button("Inbox"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Save");
    await click(button("Save"));
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
    expect(document.querySelector('[aria-label="Sync interval"]')).toBeTruthy();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Disk is busy");
    await click(button("Save"));
    expect(document.querySelector("main h1")?.textContent).toBe("Inbox");
    expect(appApi.setSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps history unchanged until the user discards a dirty draft", async () => {
    app = await renderApp();
    await openSettings();
    await editInterval();
    await emitAppEvent("ui:navigate", "history");
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
    await click(button("Discard", document.querySelector('[role="alertdialog"]')!));
    expect(document.querySelector("main h1")?.textContent).toBe("History");
    expect(appApi.setSettings).not.toHaveBeenCalled();
  });

  it.each(["Stay", "Escape"])("cancels pending save navigation with %s while allowing persistence to finish", async (dismiss) => {
    const pending = deferred<Settings>();
    appApi.setSettings.mockReturnValueOnce(pending.promise);
    app = await renderApp();
    await openSettings();
    await editInterval();
    await click(button("Inbox"));
    await click(button("Save", document.querySelector('[role="alertdialog"]')!));
    if (dismiss === "Escape") await escape();
    else await click(button("Stay"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("60 min");
    await act(async () => pending.resolve({ ...settings, syncIntervalMinutes: 60 }));
    await flushApp();
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("60 min");
    expect(appApi.setSettings).toHaveBeenCalledTimes(1);
    await emitAppEvent("ui:navigate", "history");
    expect(document.querySelector("main h1")?.textContent).toBe("History");
  });

  it.each(["course", "palette", "back"])("cancels pending %s navigation without losing a newer draft edit", async (intent) => {
    const pending = deferred<Settings>();
    appApi.setSettings.mockReturnValueOnce(pending.promise);
    app = await renderApp();
    await openSettings();
    await editInterval();
    if (intent === "course") await click(document.querySelector<HTMLButtonElement>(".course-nav-item")!);
    else if (intent === "palette") {
      await click(document.querySelector<HTMLButtonElement>(".search-trigger")!);
      const target = [...document.querySelectorAll<HTMLElement>(".palette-item")].find((node) => node.textContent?.startsWith("Go to History"))!;
      await click(target);
    } else {
      await act(async () => {
        const event = new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true, bubbles: true, cancelable: true });
        Object.defineProperty(event, "getModifierState", { value: (modifier: string) => modifier === "Control" });
        document.body.dispatchEvent(event);
      });
    }
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click(button("Save"));
    await click(button("Stay"));
    await editInterval("5 min");
    await act(async () => pending.resolve({ ...settings, syncIntervalMinutes: 60 }));
    await flushApp();
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("5 min");
    await click(button("Save settings"));
    expect(appApi.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ syncIntervalMinutes: 5 }));
  });

  it("does not let an older save consume a replacement navigation intent", async () => {
    const pending = deferred<Settings>();
    appApi.setSettings.mockReturnValueOnce(pending.promise);
    app = await renderApp();
    await openSettings();
    await editInterval();
    await click(button("Inbox"));
    await click(button("Save"));
    await click(button("Stay"));
    await emitAppEvent("ui:navigate", "history");
    await act(async () => pending.resolve({ ...settings, syncIntervalMinutes: 60 }));
    await flushApp();
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click(button("Discard"));
    expect(document.querySelector("main h1")?.textContent).toBe("History");
  });

  it("does not replace an unsaved draft when the app refreshes settings", async () => {
    app = await renderApp();
    await openSettings();
    await editInterval();
    appApi.getSettings.mockResolvedValue({ ...settings, syncIntervalMinutes: 120 });
    await emitAppEvent("auth:changed", {});
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("60 min");
  });

  it("prevents duplicate submissions while the save is pending", async () => {
    const pending = deferred<Settings>();
    appApi.setSettings.mockReturnValue(pending.promise);
    app = await renderApp();
    await openSettings();
    await editInterval();
    await click(button("Save settings"));
    await click(button("Save settings"));
    expect(appApi.setSettings).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(settings));
  });

  it("blocks invalid navigation saves and saves a valid draft with Mod+S", async () => {
    app = await renderApp();
    await openSettings();
    await setInput("Quiet hours start", "08:00");
    await setInput("Quiet hours end", "08:00");
    await click(button("Inbox"));
    const guard = document.querySelector('[role="alertdialog"]')!;
    expect(button("Save", guard).disabled).toBe(true);
    await click(button("Stay", guard));
    await setInput("Quiet hours end", "09:00");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(appApi.setSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
  });

  it.each([
    ["sync shortcut", { ctrlKey: true, shiftKey: true }],
    ["Alt modifier", { ctrlKey: true, altKey: true }],
    ["composition", { ctrlKey: true, isComposing: true }],
    ["legacy composition", { ctrlKey: true, keyCode: 229 }],
    ["repeat", { ctrlKey: true, repeat: true }],
  ] as const)("does not save Settings for %s", async (_label, options) => {
    app = await renderApp();
    await openSettings();
    await editInterval();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", bubbles: true, cancelable: true, ...options }));
    });
    expect(appApi.setSettings).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("60 min");
  });

  it.each(["navigation", "discard", "palette"])("does not save beneath the %s modal", async (surface) => {
    app = await renderApp();
    await openSettings();
    await editInterval();
    if (surface === "navigation") await click(button("Inbox"));
    else if (surface === "discard") await click(button("Discard"));
    else await click(document.querySelector<HTMLButtonElement>(".search-trigger")!);
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeTruthy();
    await act(async () => {
      (document.activeElement ?? document).dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(appApi.setSettings).not.toHaveBeenCalled();
    await escape();
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("60 min");
  });

  it("does not save Settings while the narrow sidebar drawer is open", async () => {
    setupApp({ width: 820 });
    app = await renderApp();
    await openSettings();
    await editInterval();
    await click(document.querySelector<HTMLButtonElement>(".sidebar-brand")!);
    expect(document.querySelector(".sidebar.overlay")).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(appApi.setSettings).not.toHaveBeenCalled();
    await escape();
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("60 min");
  });

  it.each(["Linux", "MacIntel"])("accepts the normal save modifier in a Settings input on %s", async (platform) => {
    setupApp({ platform });
    app = await renderApp();
    await openSettings();
    await editInterval();
    const input = document.querySelector<HTMLInputElement>('[aria-label="Quiet hours start"]')!;
    input.focus();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: platform === "Linux", metaKey: platform === "MacIntel", bubbles: true, cancelable: true }));
    });
    expect(appApi.setSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
  });

  it("shows an immediate mirror-operation rejection without losing another draft edit", async () => {
    appApi.mirrorStartBackfill.mockRejectedValueOnce(new Error("Mirror is unavailable"));
    app = await renderApp();
    await openSettings();
    await editInterval();
    await click(button("Download all"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Mirror is unavailable");
    expect(document.querySelector('[aria-label="Sync interval"]')?.textContent).toContain("60 min");
    expect(appApi.setSettings).not.toHaveBeenCalled();
  });
});

describe("Settings task 14A account, notifications and Telegram", () => {
  it("shows the signed-in username and the sign-in method badge", async () => {
    app = await renderApp();
    await openSettings();
    expect(document.body.textContent).toContain("Student");
    expect(document.body.textContent).toContain("Password");
  });

  it("shows the BITS SSO badge instead of a password badge for SSO sessions", async () => {
    appApi.authStatus.mockResolvedValue({ authenticated: true, attemptId: null, email: "student@example.test", fullName: "Student", method: "sso", acquiredAt: null, sessionExpired: false });
    app = await renderApp();
    await openSettings();
    expect(document.body.textContent).toContain("BITS SSO");
  });

  it("offers only the approved monitoring intervals", async () => {
    app = await renderApp();
    await openSettings();
    await click(button("Sync interval"));
    const labels = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((node) => node.textContent?.trim());
    expect(labels).toEqual(["5 min", "10 min", "15 min", "30 min", "60 min"]);
  });

  it("keeps the keep-in-tray and start-at-login toggles in the draft until save", async () => {
    app = await renderApp();
    await openSettings();
    const tray = document.querySelector<HTMLButtonElement>('[aria-label="Run in background"]')!;
    expect(tray.getAttribute("data-state")).toBe("checked");
    await click(tray);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Run in background"]')?.getAttribute("data-state")).toBe("unchecked");
    await click(button("Save settings"));
    expect(appApi.setSettings).toHaveBeenCalledWith(expect.objectContaining({ runInBackground: false }));
  });

  it("shows the permission-denied state and opens the system settings page", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("denied");
    app = await renderApp();
    await openSettings();
    await click(button("Allow notifications"));
    expect(document.body.textContent).toContain("Blocked");
    await click(button("Open system settings"));
    expect(appApi.openNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it("asks the OS for notification permission from the settings row", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    app = await renderApp();
    await openSettings();
    await click(button("Allow notifications"));
    expect(requestPermission).toHaveBeenCalled();
  });

  it("blocks saving a quiet-hours range whose end is not after its start", async () => {
    app = await renderApp();
    await openSettings();
    await setInput("Quiet hours start", "22:00");
    await setInput("Quiet hours end", "06:00");
    await click(button("Save settings"));
    expect(appApi.setSettings).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Quiet hours start must be before the end.");
  });

  it("masks the bot token and reveals it for editing", async () => {
    app = await renderApp();
    await openSettings();
    const token = document.querySelector<HTMLInputElement>('#integrations input[aria-label="Bot token"]')!;
    expect(token.type).toBe("password");
    expect(token.getAttribute("autocomplete")).toBe("off");
    await click(button("Show password"));
    expect(token.type).toBe("text");
    await click(button("Hide password"));
    expect(token.type).toBe("password");
  });

  it("flags an invalid chat id on the field and blocks the save", async () => {
    app = await renderApp();
    await openSettings();
    const chatId = document.querySelector<HTMLInputElement>('#integrations input[aria-label="Chat id"]')!;
    await setInput("Chat id", "not a chat");
    expect(chatId.getAttribute("aria-invalid")).toBe("true");
    await click(button("Save settings"));
    expect(appApi.setSettings).not.toHaveBeenCalled();
  });

  it("sends a Telegram test message and shows the inline result", async () => {
    appApi.telegramStatus.mockResolvedValue({ enabled: true, configured: true, chatId: "123456789", botUsername: "@quanta_pulse", error: null });
    appApi.telegramTest.mockResolvedValue(undefined);
    app = await renderApp();
    await openSettings();
    const test = button("Send test message");
    expect(test.disabled).toBe(false);
    await click(test);
    expect(appApi.telegramTest).toHaveBeenCalledTimes(1);
    await flushApp();
    expect(document.body.textContent).toContain("Sent. Check your Telegram chat.");
  });

  it("shows the inline failure result when the Telegram test message fails", async () => {
    appApi.telegramStatus.mockResolvedValue({ enabled: true, configured: true, chatId: "123456789", botUsername: "@quanta_pulse", error: null });
    appApi.telegramTest.mockRejectedValueOnce(new Error("Bot was kicked"));
    app = await renderApp();
    await openSettings();
    await click(button("Send test message"));
    await flushApp();
    expect(document.body.textContent).toContain("Bot was kicked");
  });
});

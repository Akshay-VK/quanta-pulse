import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import type { Settings } from "../src/lib/types";
import { appApi, button, click, deferred, emitAppEvent, flushApp, renderApp, setupApp } from "./helpers/renderApp";
import { settings } from "./helpers/data";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

async function editInterval() {
  await click(button("Sync interval"));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.trim() === "60 min");
  if (!option) throw new Error("Missing 60 minute option");
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

describe("Settings save and navigation in the real application", () => {
  it("retains a failed draft and retries save before navigating", async () => {
    appApi.setSettings.mockRejectedValueOnce(new Error("Disk is busy")).mockImplementationOnce(async (next) => next);
    app = await renderApp();
    await openSettings();
    await editInterval();
    await click(button("Today"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Save");
    await click(button("Save"));
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
    expect(document.querySelector('[aria-label="Sync interval"]')).toBeTruthy();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Disk is busy");
    await click(button("Save"));
    expect(document.querySelector("main h1")?.textContent).toBe("Today");
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
    await click(button("Today"));
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
});


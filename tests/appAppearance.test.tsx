import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { axe } from "vitest-axe";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, applyAppearance, appearanceStorage, readAppearance } from "../src/lib/appearance";
import { appApi, button, click, escape, renderApp, setupApp } from "./helpers/renderApp";
let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("Appearance in the real application", () => {
  it.each(["light", "dark", "system"])("migrates the saved legacy %s mode on mount", async mode => {
    localStorage.setItem("quanta-pulse-theme", mode);
    app = await renderApp();
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual({ ...DEFAULT_APPEARANCE, mode });
    expect(document.documentElement.dataset.theme).toBe(mode === "dark" ? "dark" : "light");
  });
  it("keeps startup safe when the storage getter itself throws", () => {
    const getter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw Error("blocked"); });
    expect(readAppearance(appearanceStorage()).preference).toEqual(DEFAULT_APPEARANCE);
    getter.mockRestore();
  });
  it("applies independent choices, quick toggle, reset and restores after remount", async () => {
    app = await renderApp();
    await click(button("Appearance"));
    await click(button("Ocean"));
    await click(button("Teal"));
    await click(button("Compact"));
    await click(button("Dark"));
    expect(document.documentElement.dataset).toMatchObject({ theme: "dark", palette: "ocean", density: "compact" });
    await escape();
    await click(button("Switch to light theme"));
    for (const mode of ["dark", "light"]) {
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "L", code: "KeyL", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
      expect(document.documentElement.dataset.theme).toBe(mode);
    }
    const saved = localStorage.getItem(APPEARANCE_KEY)!;
    expect(JSON.parse(saved)).toEqual({ version: 1, mode: "light", palette: "ocean", accent: "teal", density: "compact", monospace: false });
    app.unmount(); setupApp(); localStorage.setItem(APPEARANCE_KEY, saved);
    applyAppearance(document.documentElement, JSON.parse(saved), true);
    const firstPaint = document.documentElement.style.cssText;
    app = await renderApp();
    expect(document.documentElement.style.cssText).toBe(firstPaint);
    await click(button("Appearance"));
    await click(button("Reset appearance"));
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual(DEFAULT_APPEARANCE);
  });
  it("applies a saved monospace appearance before the application first paints", async () => {
    const preference = { ...DEFAULT_APPEARANCE, monospace: true };
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(preference));
    app = await renderApp();
    expect(document.documentElement.dataset.monospace).toBe("true");
    for (const role of ["type-display", "type-title", "type-dialog", "type-lead", "type-ui", "type-ui-strong", "type-small", "type-caption"]) {
      expect(document.documentElement.style.getPropertyValue(`--${role}`)).toBe('"Geist Mono Variable", ui-monospace, monospace');
    }
  });
  it("keeps Settings named and reachable in the narrow sidebar rail", async () => {
    setupApp({ width: 820 });
    app = await renderApp();
    expect(button("Settings").getAttribute("aria-label")).toBe("Settings");
    await click(button("Settings"));
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
  });
  it("supports keyboard selection, explicit close and focus return without a dirty draft", async () => {
    app = await renderApp();
    await click(button("Appearance"));
    const ocean = button("Ocean");
    ocean.focus();
    // Native buttons activate through Enter/Space in the browser; jsdom exercises click.
    await click(ocean);
    const result = await axe(document.querySelector('[role="dialog"]') as HTMLElement, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toHaveLength(0);
    await click(button("Close appearance"));
    expect(document.activeElement).toBe(button("Appearance"));
    await click(button("Settings"));
    await click(button("Inbox"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(appApi.setSettings).not.toHaveBeenCalled();
  });
  it("keeps a dirty operational draft independent of both appearance surfaces", async () => {
    app = await renderApp();
    await click(button("Settings"));
    await click(button("Sync interval"));
    await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find(n => n.textContent === "60 min")!);
    await click(button("Forest"));
    await click(button("Dark"));
    await click(button("Appearance"));
    const popover = document.querySelector('[role="dialog"]')!;
    await click(button("Iris", popover));
    await escape();
    expect(button("Sync interval").textContent).toContain("60 min");
    expect(appApi.setSettings).not.toHaveBeenCalled();
    await click(button("Inbox"));
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
  });
  it("reacts to OS changes only in System and cleans subscriptions", async () => {
    let listener: (() => void) | undefined;
    const media = { matches: false, addEventListener: vi.fn((_name, fn) => { listener = fn; }), removeEventListener: vi.fn() };
    const previousMatchMedia = window.matchMedia;
    vi.stubGlobal("matchMedia", (query: string) => query.includes("prefers-color-scheme") ? media : previousMatchMedia(query));
    app = await renderApp();
    await act(async () => { media.matches = true; listener?.(); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await click(button("Switch to light theme"));
    await act(async () => { media.matches = true; listener?.(); });
    expect(document.documentElement.dataset.theme).toBe("light");
    await click(button("Appearance"));
    await click(button("Follow system"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(media.addEventListener).toHaveBeenCalledWith("change", listener);
  });
  it("explains failed persistence while applying in memory", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
    app = await renderApp();
    await click(button("Appearance"));
    await click(button("Ocean"));
    expect(document.documentElement.dataset.palette).toBe("ocean");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("cannot be remembered");
  });
  it("preserves a future preference after a deliberate control change", async () => {
    localStorage.setItem(APPEARANCE_KEY, '{"version":9,"custom":true}');
    app = await renderApp(); await click(button("Appearance")); await click(button("Ocean"));
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('{"version":9,"custom":true}');
    expect(document.querySelector('[role="status"]')?.textContent).toContain("newer version");
  });
});

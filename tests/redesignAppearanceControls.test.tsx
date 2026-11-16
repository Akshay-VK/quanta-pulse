import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE } from "../src/lib/appearance";
import { appApi, button, click, renderApp, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>>;

beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("shared appearance controls", () => {
  it("changes all UI text to Geist Mono immediately and resets it off", async () => {
    app = await renderApp();
    await click(button("Appearance"));

    const monospace = button("Use Geist Mono for all UI text");
    expect(monospace.getAttribute("role")).toBe("switch");
    expect(monospace.getAttribute("aria-checked")).toBe("false");
    await click(monospace);
    expect(document.documentElement.dataset.monospace).toBe("true");
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!).monospace).toBe(true);
    for (const role of ["type-display", "type-title", "type-dialog", "type-lead", "type-ui", "type-ui-strong", "type-small", "type-caption"]) {
      expect(document.documentElement.style.getPropertyValue(`--${role}`)).toContain("Geist Mono");
    }
    expect(document.querySelectorAll(".appearance-mode-tile")).toHaveLength(3);
    expect(document.querySelectorAll(".appearance-accent-radio[role='radio']")).toHaveLength(6);

    await click(button("Reset appearance"));
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual(DEFAULT_APPEARANCE);
    expect(document.documentElement.dataset.monospace).toBe("false");
  });

  it("previews light and dark modes independently from the active theme", async () => {
    app = await renderApp();
    await click(button("Appearance"));
    const color = (mode: string) => document.querySelector<HTMLElement>(`.appearance-mode-preview[data-mode="${mode}"]`)!.style.getPropertyValue("--appearance-mode-bg");
    const light = color("light");
    const dark = color("dark");
    expect(light).not.toBe("");
    expect(dark).not.toBe(light);
    await click(button("Dark"));
    expect(color("light")).toBe(light);
    expect(color("dark")).toBe(dark);
  });

  it("keeps immediate appearance independent from dirty settings and navigation guards", async () => {
    app = await renderApp();
    await click(button("Settings"));
    await click(button("Sync interval"));
    await click([...document.querySelectorAll<HTMLElement>("[role='option']")].find((node) => node.textContent === "60 min")!);
    await click(button("Use Geist Mono for all UI text"));

    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!).monospace).toBe(true);
    expect(appApi.setSettings).not.toHaveBeenCalled();
    await click(button("Inbox"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("leaving Settings");
    expect(button("Sync interval").textContent).toContain("60 min");
  });
});

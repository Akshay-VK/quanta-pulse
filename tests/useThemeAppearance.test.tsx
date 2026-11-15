import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE } from "../src/lib/appearance";
import { useTheme } from "../src/hooks/useTheme";

let container: HTMLDivElement;
let root: Root;
let controller: ReturnType<typeof useTheme>;
function Harness() {
  controller = useTheme();
  return null;
}
function mount() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
}
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  localStorage.clear();
});

describe("useTheme monospace preference", () => {
  it("applies and persists live changes, then reset restores the default font", () => {
    mount();
    act(() => controller.changeAppearance({ monospace: true }));
    expect(controller.preference.monospace).toBe(true);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toMatchObject({ version: 1, monospace: true });
    expect(document.documentElement.dataset.monospace).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--type-ui")).toBe('"Geist Mono Variable", ui-monospace, monospace');
    act(() => controller.resetAppearance());
    expect(controller.preference).toEqual(DEFAULT_APPEARANCE);
    expect(document.documentElement.dataset.monospace).toBe("false");
    expect(document.documentElement.style.getPropertyValue("--type-ui")).toBe('"Geist Variable", system-ui, sans-serif');
  });
  it("keeps future records untouched while applying a live font change", () => {
    localStorage.setItem(APPEARANCE_KEY, '{"version":9,"future":"kept"}');
    mount();
    act(() => controller.changeAppearance({ monospace: true }));
    expect(document.documentElement.dataset.monospace).toBe("true");
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('{"version":9,"future":"kept"}');
    expect(controller.persistence).toBe("future");
  });
});

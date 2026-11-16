import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Settings } from "../src/lib/types";
import type { SettingsNavigationController } from "../src/views/SettingsView";
import { settings } from "./helpers/data";

vi.mock("../src/lib/api", () => ({
  api: {
    cacheStats: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0, limitBytes: 2147483648 }),
    mirrorStats: vi.fn().mockResolvedValue({ queued: 0, downloading: 0, done: 0, failed: 0, skipped: 0, kept: 0, totalResources: 0, bytesDone: 0, bytesTotal: 0, state: "idle", root: "", freeBytes: 0 }),
    telegramStatus: vi.fn().mockResolvedValue(null),
    appVersion: vi.fn().mockResolvedValue("test"),
  },
}));

const retentionChange = vi.hoisted(() => ({ current: (_value: string) => {} }));

// Keep the real Radix control; capture only its value boundary to test malformed drafts.
vi.mock("../src/components/ui/Select", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/ui/Select")>();
  return { Select: (props: React.ComponentProps<typeof actual.Select>) => {
    if (props.ariaLabel === "Number of previous versions to keep") retentionChange.current = props.onValueChange;
    return <actual.Select {...props} />;
  } };
});

import SettingsView from "../src/views/SettingsView";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let controller: SettingsNavigationController | null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  controller = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(current: Settings, onSave: (next: Settings) => Promise<void>) {
  await act(async () => root.render(
    <SettingsView
      settings={current}
      auth={null}
      dbInfo={null}
      onSave={onSave}
      onLogout={() => {}}
      onRefresh={() => {}}
      appearance={<p>Appearance controls</p>}
      onController={(next) => { controller = next; }}
    />,
  ));
}

const retention = () => container.querySelector<HTMLButtonElement>('[aria-label="Number of previous versions to keep"]')!;

async function choose(value: string) {
  await act(async () => retentionChange.current(value));
}

describe("previous-version retention", () => {
  it.each([0, 1, 2, 3, 5, 10])("displays persisted %i without changing it", async (count) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await render({ ...settings, mirrorKeepVersions: count }, onSave);
    expect(retention().textContent).toBe(count === 0 ? "None" : String(count));
    expect(controller?.dirty).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([2, 10])("saves and reloads persisted nonpreset %i unchanged", async (count) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const current = { ...settings, mirrorKeepVersions: count };
    await render(current, onSave);
    // Edit another preference: retention must round-trip without reinterpretation.
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Download new files automatically"]')!.click());
    await act(async () => { await controller?.save(); });
    const saved = onSave.mock.calls[0][0] as Settings;
    expect(saved.mirrorKeepVersions).toBe(count);
    await render(saved, onSave);
    expect(retention().textContent).toBe(String(count));
    expect(controller?.dirty).toBe(false);
  });

  it.each([2, 10])("discards a preset edit back to persisted %i", async (count) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await render({ ...settings, mirrorKeepVersions: count }, onSave);
    await choose("0");
    expect(retention().textContent).toBe("None");
    expect(controller?.dirty).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => controller?.discard());
    expect(retention().textContent).toBe(String(count));
    expect(controller?.dirty).toBe(false);
  });

  it.each(["0", "1", "3", "5"])("saves offered preset %s exactly", async (value) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await render({ ...settings, mirrorKeepVersions: 2 }, onSave);
    await choose(value);
    await act(async () => { await controller?.save(); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mirrorKeepVersions: Number(value) }));
  });

  it.each(["-1", "1.5", "NaN", "Infinity", "-Infinity", "11"])("blocks malformed draft %s through button, controller and shortcut", async (value) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await render(settings, onSave);
    await choose(value);
    expect(container.textContent).toContain("Previous versions must be a whole number between 0 and 10.");
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Save settings");
    expect(save?.disabled).toBe(true);
    await act(async () => { await controller?.save(); });
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })));
    expect(onSave).not.toHaveBeenCalled();
    expect(controller?.dirty).toBe(true);
  });

  it("explains history separately from the retained current saved copy and file age", async () => {
    await render(settings, vi.fn().mockResolvedValue(undefined));
    const row = retention().closest(".setting-row");
    expect(row?.textContent).toContain("Previous versions to keep");
    expect(row?.textContent).toContain(".history");
    expect(row?.textContent).toContain("current saved copy is kept separately");
    expect(row?.textContent).toContain("Saved files are not removed by age");
  });
});

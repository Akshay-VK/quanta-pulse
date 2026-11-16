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

describe("scan-failure notification setting", () => {
  it("follows the global notifications switch", async () => {
    await render({ ...settings, notificationsEnabled: false }, vi.fn().mockResolvedValue(undefined));
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Scan failures and incomplete scans"]')?.disabled).toBe(true);
  });

  it("keeps changes in the draft until save and preserves a persisted false value on reload", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await render(settings, onSave);
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Scan failures and incomplete scans"]')!;
    expect(toggle.getAttribute("data-state")).toBe("checked");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
    expect(onSave).not.toHaveBeenCalled();
    expect(controller?.dirty).toBe(true);
    await act(async () => { await controller?.save(); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ notifyScanFailures: false }));

    await render({ ...settings, notifyScanFailures: false }, onSave);
    expect(container.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("unchecked");
  });

  it("retains the changed value after failed save and discards to the persisted false value", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Disk is busy"));
    const current = { ...settings, notifyScanFailures: false };
    await render(current, onSave);
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Scan failures and incomplete scans"]')!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("data-state")).toBe("checked");
    await act(async () => { await controller?.save(); });
    expect(toggle.getAttribute("data-state")).toBe("checked");
    expect(controller?.error).toContain("Disk is busy");
    await act(async () => controller?.discard());
    expect(container.querySelector('[aria-label="Scan failures and incomplete scans"]')?.getAttribute("data-state")).toBe("unchecked");
  });
});

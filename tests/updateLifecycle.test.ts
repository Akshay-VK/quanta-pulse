import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/api", () => ({
  api: {
    checkUpdate: vi.fn(),
    prepareForUpdate: vi.fn(),
    downloadAndInstallUpdate: vi.fn(),
    relaunchApp: vi.fn(),
  },
}));

import { api } from "../src/lib/api";
import { installAvailableUpdate } from "../src/lib/updateLifecycle";

afterEach(() => vi.resetAllMocks());

describe("update installation lifecycle", () => {
  it("checks, prepares, installs, then relaunches in order", async () => {
    const order: string[] = [];
    const update = { version: "0.3.0", close: async () => { order.push("close"); } } as never;
    vi.mocked(api.checkUpdate).mockImplementation(async () => { order.push("check"); return update; });
    vi.mocked(api.prepareForUpdate).mockImplementation(async () => { order.push("prepare"); });
    vi.mocked(api.downloadAndInstallUpdate).mockImplementation(async () => { order.push("install"); });
    vi.mocked(api.relaunchApp).mockImplementation(async () => { order.push("relaunch"); });

    await installAvailableUpdate();

    expect(order).toEqual(["check", "prepare", "install", "close", "relaunch"]);
  });

  it.each(["prepare", "install"] as const)("does not relaunch when %s fails and can be retried", async (failedStep) => {
    const update = { version: "0.3.0" } as never;
    vi.mocked(api.checkUpdate).mockResolvedValue(update);
    vi.mocked(api.prepareForUpdate).mockImplementation(async () => {
      if (failedStep === "prepare") throw new Error("busy");
    });
    vi.mocked(api.downloadAndInstallUpdate).mockImplementation(async () => {
      if (failedStep === "install") throw new Error("download failed");
    });

    await expect(installAvailableUpdate()).rejects.toThrow(failedStep === "prepare" ? "busy" : "download failed");
    expect(api.relaunchApp).not.toHaveBeenCalled();

    vi.mocked(api.prepareForUpdate).mockResolvedValue(undefined);
    vi.mocked(api.downloadAndInstallUpdate).mockResolvedValue(undefined);
    await installAvailableUpdate();
    expect(api.relaunchApp).toHaveBeenCalledTimes(1);
  });

  it("does not prepare or relaunch if the second update check finds nothing", async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue(null);

    await expect(installAvailableUpdate()).resolves.toBe(false);

    expect(api.prepareForUpdate).not.toHaveBeenCalled();
    expect(api.downloadAndInstallUpdate).not.toHaveBeenCalled();
    expect(api.relaunchApp).not.toHaveBeenCalled();
  });

  it("reports a restart failure only after installation has succeeded", async () => {
    const order: string[] = [];
    vi.mocked(api.checkUpdate).mockResolvedValue({ version: "0.3.0", close: async () => { order.push("close"); } } as never);
    vi.mocked(api.prepareForUpdate).mockImplementation(async () => { order.push("prepare"); });
    vi.mocked(api.downloadAndInstallUpdate).mockImplementation(async () => { order.push("install"); });
    vi.mocked(api.relaunchApp).mockImplementation(async () => { order.push("relaunch"); throw new Error("process unavailable"); });

    await expect(installAvailableUpdate()).rejects.toThrow("Update installed, but the app could not restart");
    expect(order).toEqual(["prepare", "install", "close", "relaunch"]);
  });
});

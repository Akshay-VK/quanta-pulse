import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));

import { check } from "@tauri-apps/plugin-updater";
import { api } from "../src/lib/api";

afterEach(() => vi.clearAllMocks());

describe("updater request bounds", () => {
  it("gives manual and shell-triggered update checks a 30 second request limit", async () => {
    await api.checkUpdate();
    expect(check).toHaveBeenCalledWith({ timeout: 30_000 });
  });
});

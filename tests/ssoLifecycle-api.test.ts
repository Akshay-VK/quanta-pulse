import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { api } from "../src/lib/api";

afterEach(() => vi.clearAllMocks());

describe("SSO lifecycle API", () => {
  it("sends the requested attempt ID to focus and cancel commands", async () => {
    await api.focusSsoLogin("attempt-1");
    expect(invoke).toHaveBeenLastCalledWith("focus_sso_login", { attemptId: "attempt-1" });

    await api.cancelSsoLogin("attempt-1");
    expect(invoke).toHaveBeenLastCalledWith("cancel_sso_login", { attemptId: "attempt-1" });
  });

  it("preserves native command failures", async () => {
    const failure = new Error("native failure");
    invoke.mockRejectedValueOnce(failure);
    await expect(api.focusSsoLogin("attempt-1")).rejects.toBe(failure);
  });
});

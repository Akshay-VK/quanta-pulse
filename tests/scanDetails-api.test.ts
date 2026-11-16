import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { api } from "../src/lib/api";

describe("scan diagnostics API", () => {
  beforeEach(() => invoke.mockReset());

  it("queries details by scan ID and preserves legacy absence", async () => {
    invoke.mockResolvedValueOnce(null);
    await expect(api.scanDetails(42)).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("scan_details", { scanId: 42 });
  });

  it("returns nested camelCase details unchanged", async () => {
    const details = {
      scanId: 42,
      courses: [{
        courseId: null,
        courseName: "Unknown course",
        status: "partial" as const,
        startedAt: "2026-11-16T10:00:00Z",
        completedAt: null,
        steps: [{
          label: "Discover resources",
          status: "failed" as const,
          startedAt: "2026-11-16T10:00:01Z",
          completedAt: "2026-11-16T10:00:02Z",
          error: "safe detail",
        }],
        error: "safe summary",
      }],
    };
    invoke.mockResolvedValueOnce(details);
    await expect(api.scanDetails(42)).resolves.toEqual(details);
    expect(invoke).toHaveBeenCalledWith("scan_details", { scanId: 42 });
  });
});

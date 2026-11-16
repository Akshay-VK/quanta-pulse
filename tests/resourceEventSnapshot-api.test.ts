import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue([2, 5]) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { api } from "../src/lib/api";

describe("resource event snapshot API", () => {
  beforeEach(() => invoke.mockClear());

  it("invokes the complete resource snapshot command with camelCase arguments", async () => {
    const resourceIds = [4, 8];
    await expect(api.snapshotResourceEventIds(resourceIds)).resolves.toEqual([2, 5]);
    expect(invoke).toHaveBeenCalledWith("snapshot_resource_event_ids", { resourceIds });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { api } from "../src/lib/api";

describe("durable course display names", () => {
  beforeEach(() => invoke.mockReset());

  it("sets a display name and returns the updated course", async () => {
    const updated = { id: 7, name: "Original course", displayName: "My course" };
    invoke.mockResolvedValueOnce(updated);

    await expect(api.setCourseDisplayName(7, "My course")).resolves.toBe(updated);
    expect(invoke).toHaveBeenCalledWith("set_course_display_name", {
      courseId: 7,
      displayName: "My course",
    });
  });

  it("uses null as the explicit reset operation", async () => {
    invoke.mockResolvedValueOnce({ id: 7, name: "Original course", displayName: null });

    await api.setCourseDisplayName(7, null);
    expect(invoke).toHaveBeenCalledWith("set_course_display_name", {
      courseId: 7,
      displayName: null,
    });
  });
});

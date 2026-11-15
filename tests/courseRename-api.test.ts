import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { api } from "../src/lib/api";
import { ALIASES_KEY, courseTitle, registerCourseLabels } from "../src/lib/courseName";
import { course } from "./helpers/data";

describe("durable course display names", () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
  });

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
    localStorage.setItem(ALIASES_KEY, JSON.stringify({ "7": "Old alias" }));
    invoke.mockResolvedValueOnce({ id: 7, name: "Original course", displayName: null });

    await api.setCourseDisplayName(7, null);
    expect(invoke).toHaveBeenCalledWith("set_course_display_name", {
      courseId: 7,
      displayName: null,
    });
    expect(JSON.parse(localStorage.getItem(ALIASES_KEY)!)).toEqual({});
  });

  it("does not resurrect a legacy alias after setting and resetting the durable name", async () => {
    localStorage.setItem(ALIASES_KEY, JSON.stringify({ "7": "Old alias", "8": "Other alias" }));
    const original = { ...course, id: 7, name: "1166_CS F111", displayName: null };
    invoke.mockResolvedValueOnce({ ...original, displayName: "New name" });
    registerCourseLabels([await api.setCourseDisplayName(7, "New name")]);
    expect(courseTitle(7)).toBe("New name");

    invoke.mockResolvedValueOnce(original);
    registerCourseLabels([await api.setCourseDisplayName(7, null)]);
    expect(courseTitle(7)).toBe("CS F111");
    expect(JSON.parse(localStorage.getItem(ALIASES_KEY)!)).toEqual({ "8": "Other alias" });
  });

  it("keeps the legacy alias when a durable rename fails", async () => {
    localStorage.setItem(ALIASES_KEY, JSON.stringify({ "7": "Old alias" }));
    invoke.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(api.setCourseDisplayName(7, null)).rejects.toThrow("Database unavailable");
    expect(JSON.parse(localStorage.getItem(ALIASES_KEY)!)).toEqual({ "7": "Old alias" });
  });
});

import { describe, expect, it } from "vitest";
import { hasValidationErrors, isSettingsDirty, isValidHHMM, validateSettingsDraft } from "../src/lib/settingsDraft";
import type { Settings } from "../src/lib/types";

const base: Settings = {
  syncIntervalMinutes: 60,
  launchAtLogin: false,
  runInBackground: true,
  notificationsEnabled: true,
  notifyNew: true,
  notifyUpdated: true,
  notifyAnnouncements: true,
  notifyDeadlines: true,
  notifyAvailability: true,
  notifyAuth: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  deadlineReminderHours: 48,
  timezone: "system",
  maxCourses: 60,
  maxResourcesPerCourse: 400,
  maxDetailFetches: 600,
  requestTimeoutSecs: 25,
  concurrency: 4,
};

describe("settingsDraft", () => {
  it("validates HH:MM", () => {
    expect(isValidHHMM("00:00")).toBe(true);
    expect(isValidHHMM("23:59")).toBe(true);
    expect(isValidHHMM("24:00")).toBe(false);
    expect(isValidHHMM("12:60")).toBe(false);
    expect(isValidHHMM("abc")).toBe(false);
    expect(isValidHHMM(null)).toBe(true);
  });

  it("detects dirty state", () => {
    expect(isSettingsDirty(base, base)).toBe(false);
    const changed = { ...base, syncIntervalMinutes: 30 };
    expect(isSettingsDirty(changed, base)).toBe(true);
  });

  it("validates ranges", () => {
    const bad = { ...base, syncIntervalMinutes: 10, deadlineReminderHours: 0 };
    const errs = validateSettingsDraft(bad);
    expect(hasValidationErrors(errs)).toBe(true);
    expect(errs.syncIntervalMinutes).toBeDefined();
    expect(errs.deadlineReminderHours).toBeDefined();
  });
});

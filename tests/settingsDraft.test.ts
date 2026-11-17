import { describe, expect, it } from "vitest";
import { hasValidationErrors, isSettingsDirty, isValidHHMM, validateSettingsDraft } from "../src/lib/settingsDraft";
import type { Settings } from "../src/lib/types";

const base: Settings = {
  syncIntervalMinutes: 60,
  launchAtLogin: false,
  runInBackground: true,
  updateAutoCheck: true,
  notificationsEnabled: true,
  notifyNew: true,
  notifyUpdated: true,
  notifyAnnouncements: true,
  notifyDeadlines: true,
  notifyAvailability: true,
  notifyAuth: true,
  notifyScanFailures: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  deadlineReminderHours: 48,
  timezone: "system",
  cacheLimitBytes: 2 * 1024 * 1024 * 1024,
  mirrorEnabled: true,
  mirrorRoot: null,
  mirrorMaxBytes: 500 * 1024 * 1024,
  mirrorMinFreeBytes: 5 * 1024 * 1024 * 1024,
  mirrorKeepVersions: 3,
  telegramEnabled: false,
  telegramBotToken: null,
  telegramChatId: null,
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

  it("compares scan-failure preference edits and preserves a persisted false value", () => {
    const current = { ...base, notifyScanFailures: false };
    expect(isSettingsDirty(current, current)).toBe(false);
    expect(isSettingsDirty({ ...current, notifyScanFailures: true }, current)).toBe(true);
    expect(current.notifyScanFailures).toBe(false);
  });

  it("accepts offered and persisted monitoring intervals", () => {
    for (const interval of [5, 10, 15, 30, 60, 61, 120, 1440]) {
      expect(validateSettingsDraft({ ...base, syncIntervalMinutes: interval }).syncIntervalMinutes).toBeUndefined();
    }
  });

  it("accepts the approved monitoring intervals offered by the settings UI", () => {
    for (const interval of [5, 10, 15, 30, 60]) {
      expect(validateSettingsDraft({ ...base, syncIntervalMinutes: interval }).syncIntervalMinutes).toBeUndefined();
    }
  });

  it("rejects a quiet-hours range whose end is not after its start", () => {
    expect(validateSettingsDraft({ ...base, quietHoursStart: "22:00", quietHoursEnd: "06:00" }).quietHours).toBeDefined();
    expect(validateSettingsDraft({ ...base, quietHoursStart: "22:00", quietHoursEnd: "22:00" }).quietHours).toBeDefined();
    expect(validateSettingsDraft({ ...base, quietHoursStart: "08:00", quietHoursEnd: "09:00" }).quietHours).toBeUndefined();
  });

  it("rejects invalid monitoring intervals and other out-of-range settings", () => {
    for (const interval of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 4, 1441, 5.5]) {
      expect(validateSettingsDraft({ ...base, syncIntervalMinutes: interval }).syncIntervalMinutes).toBeDefined();
    }

    const bad = { ...base, syncIntervalMinutes: 10, deadlineReminderHours: 0 };
    const errs = validateSettingsDraft(bad);
    expect(hasValidationErrors(errs)).toBe(true);
    expect(errs.syncIntervalMinutes).toBeUndefined();
    expect(errs.deadlineReminderHours).toBeDefined();
  });

  it("accepts every previous-version count from 0 through 10, including the default 3", () => {
    for (let count = 0; count <= 10; count++) {
      expect(validateSettingsDraft({ ...base, mirrorKeepVersions: count })).toEqual({});
    }
    expect(base.mirrorKeepVersions).toBe(3);
  });

  it("rejects invalid previous-version counts with a field error", () => {
    for (const count of [-1, 0.5, 3.5, 11, Number.NaN, Infinity, -Infinity]) {
      const errors = validateSettingsDraft({ ...base, mirrorKeepVersions: count });
      expect(errors).toEqual({ mirrorKeepVersions: expect.stringContaining("0 and 10") });
      expect(hasValidationErrors(errors)).toBe(true);
    }
  });

  it("validates the Telegram bot token and chat id", () => {
    const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    expect(validateSettingsDraft({ ...base, telegramBotToken: token }).telegramBotToken).toBeUndefined();
    expect(validateSettingsDraft({ ...base, telegramBotToken: null }).telegramBotToken).toBeUndefined();
    for (const bad of ["nope", "123456789:short", "abc:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"]) {
      expect(validateSettingsDraft({ ...base, telegramBotToken: bad }).telegramBotToken).toBeDefined();
    }

    for (const good of ["123456789", "-1001234567890", "@quanta_pulse"]) {
      expect(validateSettingsDraft({ ...base, telegramChatId: good }).telegramChatId).toBeUndefined();
    }
    for (const bad of ["room name", "@", "abc"]) {
      expect(validateSettingsDraft({ ...base, telegramChatId: bad }).telegramChatId).toBeDefined();
    }
  });
});

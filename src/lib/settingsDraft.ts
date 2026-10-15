import type { Settings } from "./types";

export type SettingsDraftValidation = {
  syncIntervalMinutes?: string;
  deadlineReminderHours?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHours?: string;
};

const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isValidHHMM(s: string | null | undefined): boolean {
  if (!s) return true;
  return HHMM_RE.test(s);
}

export function validateSettingsDraft(draft: Settings): SettingsDraftValidation {
  const errors: SettingsDraftValidation = {};
  const sync = draft.syncIntervalMinutes;
  if (!Number.isFinite(sync) || sync < 15 || sync > 24 * 60) {
    errors.syncIntervalMinutes = "Sync interval must be between 15 and 1440 minutes.";
  }
  const deadline = draft.deadlineReminderHours;
  if (!Number.isFinite(deadline) || deadline < 1 || deadline > 24 * 30) {
    errors.deadlineReminderHours = "Deadline reminder must be between 1 and 720 hours.";
  }
  if (!isValidHHMM(draft.quietHoursStart)) {
    errors.quietHoursStart = "Quiet hours start must be in HH:MM format.";
  }
  if (!isValidHHMM(draft.quietHoursEnd)) {
    errors.quietHoursEnd = "Quiet hours end must be in HH:MM format.";
  }
  if (draft.quietHoursStart && draft.quietHoursEnd && isValidHHMM(draft.quietHoursStart) && isValidHHMM(draft.quietHoursEnd)) {
    if (draft.quietHoursStart === draft.quietHoursEnd) {
      errors.quietHours = "Quiet hours start and end cannot be the same.";
    }
  }
  return errors;
}

export function isSettingsDirty(draft: Settings, original: Settings): boolean {
  return JSON.stringify(draft) !== JSON.stringify(original);
}

export function hasValidationErrors(errors: SettingsDraftValidation): boolean {
  return Object.keys(errors).length > 0;
}

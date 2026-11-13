import type { ChangeEvent, Course, Resource, Settings } from "../../src/lib/types";

export function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1, externalResourceId: "r1", courseId: 1, courseName: "Discrete Maths",
    title: "Lecture 4", url: "https://quanta.bits-pilani.ac.in/lecture4.pdf",
    sourcePageUrl: "https://quanta.bits-pilani.ac.in/course/view.php?id=1", resourceType: "pdf",
    uploadedAt: null, publishedAt: null, modifiedAt: null, dueAt: null,
    firstSeenAt: "2026-10-14T09:05:00Z", lastSeenAt: null, lastCheckedAt: null,
    contentFingerprint: null, availabilityStatus: "available", sizeBytes: null, section: null,
    isExternal: false, ...overrides,
  };
}
export function change(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: 10, resourceId: 1, courseId: 1, courseName: "Discrete Maths", resourceTitle: "Lecture 4",
    resourceUrl: resource().url, sourcePageUrl: null, resourceType: "pdf", uploadedAt: null,
    changeType: "new", title: "New lecture", description: null, detectedAt: "2026-10-14T09:05:00Z",
    read: false, ...overrides,
  };
}
export const course: Course = {
  id: 1, externalCourseId: "1124", name: "1124_MATH_INSTR_MATH F111", shortName: "MATH F111",
  url: "https://quanta.bits-pilani.ac.in/course/view.php?id=1", firstSeenAt: "2026-09-01T00:00:00Z",
  lastScannedAt: null, lastScanStatus: null, monitoringStatus: "monitored", resourceCount: 2,
};
export const settings: Settings = {
  syncIntervalMinutes: 30, launchAtLogin: false, runInBackground: true, updateAutoCheck: true,
  notificationsEnabled: true, notifyNew: true, notifyUpdated: true, notifyAnnouncements: true,
  notifyDeadlines: true, notifyAvailability: true, notifyAuth: true, quietHoursStart: null,
  quietHoursEnd: null, deadlineReminderHours: 48, timezone: "Asia/Kolkata", cacheLimitBytes: 2147483648,
  mirrorEnabled: true, mirrorRoot: null, mirrorMaxBytes: 0, mirrorMinFreeBytes: 0, mirrorKeepVersions: 2,
  telegramEnabled: false, telegramBotToken: null, telegramChatId: null, maxCourses: 100,
  maxResourcesPerCourse: 2000, maxDetailFetches: 100, requestTimeoutSecs: 30, concurrency: 4,
};

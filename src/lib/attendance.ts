import type { AcademicCoverage, AttendanceObservation, AttendanceReportDetails, AttendanceSession } from "./types";

export type ScopedAttendance = AttendanceObservation & { details: AttendanceReportDetails };

export function attendanceActivities(records: AttendanceObservation[]) {
  const activities = new Map<string, ScopedAttendance[]>();
  for (const record of records) {
    if (record.source.visibility !== "visible" || !record.details || record.courseModuleId === null) continue;
    const key = `${record.courseModuleId}:${record.activityInstanceId}`;
    const group = activities.get(key) ?? [];
    group.push({ ...record, details: record.details });
    activities.set(key, group);
  }
  return Array.from(activities, ([id, reports]) => ({ id, title: reports[0].details.title, reports }));
}

export function attendanceSource(report: ScopedAttendance): string | null {
  const moduleId = report.courseModuleId;
  if (!Number.isSafeInteger(moduleId) || moduleId === null || moduleId <= 0) return null;
  const canonical = `https://quanta.bits-pilani.ac.in/mod/attendance/view.php?id=${moduleId}`;
  return report.source.sourceUrl === canonical ? canonical : null;
}

/** Allow the course page as a fallback without inferring an attendance route. */
export function attendanceCourseSource(courseUrl: string): string | null {
  return /^https:\/\/quanta\.bits-pilani\.ac\.in\/course\/view\.php\?id=[1-9][0-9]*$/.test(courseUrl) ? courseUrl : null;
}

export function attendanceScope(details: AttendanceReportDetails): string {
  const group = details.groupDisplay ?? "Course-wide";
  if (details.range === "all") return `All dates · ${group}`;
  const range = { month: "Month", week: "Week", custom: "Date range" }[details.range];
  return `${range} (${details.from} to ${details.through}) · ${group}`;
}

export function attendanceCoverage(coverage: AcademicCoverage | null | undefined): string {
  switch (coverage?.coverage) {
    case "complete": return coverage.stale ? "Saved attendance · session expired" : "Local attendance report";
    case "partial": return "Latest attendance report is partial";
    case "denied": return "Latest attendance report access is restricted";
    case "unsupported": return "Unsupported attendance report";
    case "offline": return "Attendance report unavailable";
    case "cancelled": return "Attendance report check cancelled";
    case "failed": return "Attendance report check failed";
    default: return "Attendance source awaiting verification";
  }
}

export const attendanceStates: Record<AttendanceSession["state"], string> = {
  recorded: "Recorded",
  absent: "Absent",
  unrecorded: "Unrecorded",
  future: "Future session",
  enrollmentBoundary: "Enrollment boundary",
  unknown: "Status unavailable",
};

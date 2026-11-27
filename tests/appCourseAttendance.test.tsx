import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appApi, button, click, deferred, emitAppEvent, flushApp, renderApp, setupApp } from "./helpers/renderApp";
import { invalidateAcademicSession } from "../src/lib/academicSession";
import type { AcademicContext, AcademicCoverage, AcademicPage, AttendanceObservation } from "../src/lib/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const origin = "https://quanta.bits-pilani.ac.in";
const ownerA: AcademicContext = { contractVersion: 1, generation: "A", owner: { origin, moodleUserId: 42 }, collectorsEnabled: false };
const ownerB: AcademicContext = { ...ownerA, generation: "B", owner: { origin, moodleUserId: 84 } };
const seen = "2026-11-22T08:00:00Z";
const coverage: AcademicCoverage = {
  permission: "permitted", reason: null, coverage: "partial", observedAt: seen,
  lastSuccessfulAt: null, baselineEstablished: false, stale: true,
};
const lab: AttendanceObservation = {
  source: { sourceId: "nov-lab", sourceUrl: origin + "/mod/attendance/view.php?id=29", observedAt: seen, visibility: "visible" },
  activityInstanceId: 61, courseModuleId: 29, sessionId: null, scopeDisplay: "November",
  statusDisplay: null, pointsDisplay: null, maximumDisplay: "0.00", summaryDisplay: "Undefined by source",
  details: {
    title: "Field methods lab", groupId: 7, groupDisplay: "Group Cedar", range: "month",
    from: "2026-11-01", through: "2026-11-30", page: 1, totalPages: 2, complete: false,
    summaryLabel: "Points percentage",
    sessions: [
      { sessionId: null, dateDisplay: "4 Nov 2026", description: "Calibration", state: "recorded",
        statusDisplay: "Field credit", pointsDisplay: "0.00", maximumDisplay: "2.50", remarks: "<b>source text</b>" },
      ...(["absent", "unrecorded", "future", "enrollmentBoundary"] as const).map(state => ({
        sessionId: null, dateDisplay: "11 Nov 2026", description: null, state,
        statusDisplay: null, pointsDisplay: null, maximumDisplay: null, remarks: null,
      })),
    ],
  },
};
const january = {
  ...lab, source: { ...lab.source, sourceId: "jan-lab" }, summaryDisplay: "January-only summary",
  details: { ...lab.details!, from: "2026-01-01", through: "2026-01-31", complete: true, totalPages: 1, sessions: [] },
};
const lecture = {
  ...lab, source: { ...lab.source, sourceId: "nov-lecture", sourceUrl: origin + "/mod/attendance/view.php?id=30" },
  activityInstanceId: 62, courseModuleId: 30, summaryDisplay: "Lecture-only summary",
  details: { ...lab.details!, title: "Field methods lecture", groupId: null, groupDisplay: null, sessions: [] },
};
let app: Awaited<ReturnType<typeof renderApp>> | undefined;
let owner: AcademicContext;
let read: () => AcademicPage<AttendanceObservation> | Promise<AcademicPage<AttendanceObservation>>;
const page = (records = [lab, january, lecture], state = coverage) => ({ context: owner, courseId: 1, coverage: state, records });

beforeEach(async () => {
  setupApp({ width: 390 });
  invalidateAcademicSession();
  owner = ownerA;
  read = () => page();
  invoke.mockReset().mockImplementation((command: string) => {
    if (command === "academic_context") return Promise.resolve(owner);
    if (command === "academic_attendance") return Promise.resolve(read());
    if (command === "academic_grades") return Promise.resolve({ context: owner, courseId: 1, coverage: null, records: [] });
    throw new Error(command);
  });
  const { api } = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
  appApi.academicContext.mockImplementation(api.academicContext);
  appApi.academicAttendance.mockImplementation(api.academicAttendance);
  appApi.academicGrades.mockImplementation(api.academicGrades);
});
afterEach(() => { app?.unmount(); app = undefined; });

async function openAttendance() {
  app = await renderApp();
  await click(button("Library"));
  await click(button("Open MATH F111 library"));
  expect(appApi.academicAttendance).not.toHaveBeenCalled();
  await act(async () => {
    const materials = button("Materials");
    materials.focus();
    materials.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  });
  await flushApp();
  expect(document.activeElement).toBe(button("Attendance"));
  expect(button("Attendance").getAttribute("aria-controls")).toBe(document.querySelector('[role="tabpanel"]')?.id);
}

function report() {
  const region = document.querySelector<HTMLElement>('[aria-label="Course attendance report"]');
  expect(region).not.toBeNull();
  return region!;
}

async function choose(label: string, text: string) {
  const control = report().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const option = Array.from(control.options).find(option => option.text.includes(text));
  expect(option).toBeDefined();
  await act(async () => {
    control.value = option!.value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("shows the source's scoped rows, zero denominator and page bounds, with local activity and range selection", async () => {
  await openAttendance();
  for (const text of ["Page 1 of 2", "Group Cedar", "2026-11-01", "Points percentage", "Undefined by source", "Denominator",
    "0.00", "Field credit", "2.50", "Absent", "Unrecorded", "Future session", "Enrollment boundary", "Scoped snapshot", "Observed",
    "<b>source text</b>"]) expect(report().textContent).toContain(text);
  expect(report().querySelector("b")).toBeNull();
  expect(report().textContent).not.toContain("Lecture-only summary");
  await choose("Attendance range", "2026-01-01");
  expect(report().textContent).toContain("January-only summary");
  expect(report().textContent).not.toContain("Calibration");
  await choose("Attendance activity", "Field methods lecture");
  expect(report().textContent).toContain("Lecture-only summary");
  await click(button("Open in Quanta", report()));
  expect(appApi.openExternal).toHaveBeenCalledWith(origin + "/mod/attendance/view.php?id=30");
  expect(invoke).toHaveBeenCalledWith("academic_attendance", { generation: "A", courseId: 1 });
  expect(appApi.academicAttendance).toHaveBeenCalledTimes(1);
  expect(appApi.academicGrades).not.toHaveBeenCalled();
  await click(button("Grades"));
  expect(document.querySelector('[aria-label="Course grade report"]')).not.toBeNull();
  await click(button("Activity"));
  await click(button("Materials"));
  expect(document.querySelector('[role="tree"]')).not.toBeNull();
});

it("discards delayed prior-owner results and keeps attendance errors local", async () => {
  await openAttendance();
  expect(report().textContent).toContain("Calibration");
  const delayed = deferred<AcademicPage<AttendanceObservation>>();
  read = () => delayed.promise;
  await click(button("Reload local attendance", report()));
  owner = ownerB;
  read = () => page([], { ...coverage, coverage: "unsupported", permission: "unknown", reason: "sourceUnverified" });
  await emitAppEvent("auth:changed", undefined);
  expect(report().textContent).toContain("Unsupported attendance report");
  await click(button("Open course in Quanta", report()));
  expect(appApi.openExternal).toHaveBeenCalledWith(origin + "/course/view.php?id=1");
  delayed.resolve({ ...page(), context: ownerA });
  await flushApp();
  expect(report().textContent).not.toContain("Calibration");
  read = () => { throw new Error("private diagnostic"); };
  await click(button("Reload local attendance", report()));
  expect(report().textContent).toContain("Couldn’t load local attendance");
  expect(report().textContent).not.toContain("private diagnostic");
  await click(button("Grades"));
  expect(document.querySelector('[aria-label="Course grade report"]')?.textContent).toContain("No grades checked yet");
});

it("shows retained scope freshness after an unavailable check and hides restricted records and unsafe source actions", async () => {
  read = () => page([{ ...lab, source: { ...lab.source, sourceUrl: origin + "/mod/attendance/attendance.php?sessid=911" } }],
    { ...coverage, coverage: "offline", reason: "networkUnavailable" });
  await openAttendance();
  expect(report().textContent).toContain("Attendance report unavailable");
  expect(report().textContent).toContain("Observed");
  expect(report().textContent).toContain("Field credit");
  expect(report().textContent).not.toContain("Open in Quanta");
  read = () => page([lab], { ...coverage, coverage: "denied", permission: "restricted", reason: "permissionDenied" });
  await click(button("Reload local attendance", report()));
  expect(report().textContent).toContain("access is restricted");
  expect(report().textContent).not.toContain("Field credit");
});

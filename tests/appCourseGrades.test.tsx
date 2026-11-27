import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appApi, button, click, deferred, emitAppEvent, flushApp, renderApp, setupApp } from "./helpers/renderApp";
import { invalidateAcademicSession } from "../src/lib/academicSession";
import type { AcademicContext, AcademicCoverage, AcademicPage, GradeObservation } from "../src/lib/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const origin = "https://quanta.bits-pilani.ac.in";
const ownerA: AcademicContext = { contractVersion: 1, generation: "A", owner: { origin, moodleUserId: 42 }, collectorsEnabled: false };
const ownerB: AcademicContext = { ...ownerA, generation: "B", owner: { origin, moodleUserId: 84 } };
const seen = "2026-11-21T08:00:00Z";
const coverage: AcademicCoverage = {
  permission: "permitted", reason: null, coverage: "complete", observedAt: seen, lastSuccessfulAt: seen, baselineEstablished: true, stale: false,
};
const grade = (id: string, title: string, extra: Partial<GradeObservation> = {}): GradeObservation => ({
  source: { sourceId: id, sourceUrl: `${origin}/grade/report/user/index.php?id=1124`, observedAt: seen, visibility: "visible" },
  title, gradeItemId: null, parentSourceId: null, itemKind: "item", displayValue: null, numericValue: null,
  rangeDisplay: null, weightDisplay: null, feedback: null, ...extra,
});
const grades = [
  grade("grade:900", "Course total", { itemKind: "courseTotal", displayValue: "71.25 / 95" }),
  grade("category:12", "Assessments", { itemKind: "category" }),
  grade("grade:11", "Manual checkpoint", { parentSourceId: "category:12", displayValue: "0.00", rangeDisplay: "0–10", feedback: "<img src=x onerror=alert(1)> literal", details: { valueStatus: "reported", percentageDisplay: "0.00 %", letterDisplay: null } }),
  grade("grade:12", "Hidden component", { source: { ...grade("grade:12", "").source, visibility: "hidden" }, displayValue: "PRIVATE", feedback: "PRIVATE" }),
  grade("grade:13", "Missed observation", { displayValue: "A−", omitted: true }),
  grade("grade:14", "Blank total", { itemKind: "categoryTotal", details: { valueStatus: "blank", percentageDisplay: null, letterDisplay: null } }),
  grade("grade:15", "Pending mark", { details: { valueStatus: "ungraded", percentageDisplay: null, letterDisplay: null } }),
  grade("grade:16", "Mark not shown"),
];
let app: Awaited<ReturnType<typeof renderApp>> | undefined;
let owner: AcademicContext;
let read: () => AcademicPage<GradeObservation> | Promise<AcademicPage<GradeObservation>>;
let check: typeof read;

function page(records = grades, state: AcademicCoverage | null = coverage): AcademicPage<GradeObservation> {
  return { context: owner, courseId: 1, coverage: state, records };
}

beforeEach(async () => {
  setupApp({ width: 390 });
  invalidateAcademicSession();
  owner = ownerA;
  read = () => page();
  check = () => page();
  invoke.mockReset().mockImplementation((command: string) => {
    if (command === "academic_context") return Promise.resolve(owner);
    if (command === "academic_grades") return Promise.resolve(read());
    if (command === "check_course_grades") return Promise.resolve(check());
    throw new Error(command);
  });
  const { api } = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
  appApi.academicContext.mockImplementation(api.academicContext);
  appApi.academicGrades.mockImplementation(api.academicGrades);
  appApi.checkCourseGrades.mockImplementation(api.checkCourseGrades);
});
afterEach(() => { app?.unmount(); app = undefined; });

async function openCourse(keyboard = false) {
  app = await renderApp();
  await click(button("Library"));
  await click(button("Open MATH F111 library"));
  expect(appApi.academicGrades).not.toHaveBeenCalled();
  if (keyboard) {
    await act(async () => {
      const activity = button("Activity");
      activity.focus();
      activity.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    await flushApp();
    expect(document.activeElement).toBe(button("Grades"));
    expect(button("Grades").getAttribute("aria-controls")).toBe(document.querySelector('[role="tabpanel"]')?.id);
  } else {
    await click(button("Grades"));
  }
}

function report() {
  const result = document.querySelector<HTMLElement>('[aria-label="Course grade report"]');
  expect(result).not.toBeNull();
  return result!;
}

it("fetches grades only when asked and displays the checked report", async () => {
  read = () => page([], null);
  const pending = deferred<AcademicPage<GradeObservation>>();
  check = () => pending.promise;
  await openCourse();
  const gradeChecks = () => invoke.mock.calls.filter(([command]) => command === "check_course_grades");
  expect(gradeChecks()).toHaveLength(0);
  await click(button("Check grades", report()));
  expect(gradeChecks()).toEqual([["check_course_grades", { generation: "A", courseId: 1 }]]);
  expect(button("Checking grades…", report()).hasAttribute("disabled")).toBe(true);
  pending.resolve(page());
  await flushApp();
  expect(report().textContent).toContain("71.25 / 95");
  expect(button("Check grades", report()).hasAttribute("disabled")).toBe(false);
});

it("discards an in-flight grade check after an account change", async () => {
  const pending = deferred<AcademicPage<GradeObservation>>();
  check = () => pending.promise;
  await openCourse();
  await click(button("Check grades", report()));
  owner = ownerB;
  read = () => page([], null);
  await emitAppEvent("auth:changed", undefined);
  pending.resolve({ context: ownerA, courseId: 1, coverage, records: grades });
  await flushApp();
  expect(report().textContent).not.toContain("71.25 / 95");
  expect(report().textContent).not.toContain("Couldn’t check grades");
  expect(button("Check grades", report()).hasAttribute("disabled")).toBe(false);
});

it("keeps a rejected check local and allows another attempt", async () => {
  read = () => page([], null);
  check = () => { throw new Error("private diagnostic"); };
  await openCourse();
  await click(button("Check grades", report()));
  expect(report().textContent).toContain("Couldn’t check grades");
  expect(report().textContent).not.toContain("private diagnostic");
  check = () => page();
  await click(button("Check grades", report()));
  expect(report().textContent).toContain("71.25 / 95");
  expect(report().textContent).not.toContain("Couldn’t check grades");
});

it("renders source totals and disclosures while preserving Course Materials and Activity", async () => {
  await openCourse(true);
  const view = report();
  expect(view.textContent).toContain("71.25 / 95");
  for (const value of ["0.00", "Hidden", "Blank", "Ungraded", "Unknown", "Missing from latest report", "A−"]) {
    expect(view.textContent).toContain(value);
  }
  expect(view.textContent).not.toContain("PRIVATE");
  expect(view.querySelector(".course-grade-group")?.textContent).toContain("Manual checkpoint");
  const detail = Array.from(view.querySelectorAll("summary")).find(row => row.textContent?.includes("Manual checkpoint"));
  expect(detail).toBeTruthy();
  detail!.click();
  expect(detail!.parentElement?.hasAttribute("open")).toBe(true);
  expect(detail!.parentElement?.textContent).toContain("<img src=x onerror=alert(1)> literal");
  expect(view.querySelector("img")).toBeNull();
  await click(button("Open in Quanta", view));
  expect(appApi.openExternal).toHaveBeenCalledWith(`${origin}/grade/report/user/index.php?id=1124`);
  expect(appApi.previewResource).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("academic_grades", { generation: "A", courseId: 1 });
  await click(button("Activity"));
  expect(document.querySelector('[aria-label="Course grade report"]')).toBeNull();
  await click(button("Materials"));
  expect(document.querySelector('[role="tree"]')).not.toBeNull();
});

it("retains permissible stale values and clears them for restricted or unsupported reports", async () => {
  read = () => page(grades, { ...coverage, coverage: "offline", reason: "networkUnavailable", stale: true });
  await openCourse();
  expect(report().textContent).toContain("Stale");
  expect(report().textContent).toContain("71.25 / 95");
  read = () => page([], { ...coverage, coverage: "denied", reason: "permissionDenied", permission: "restricted", stale: true });
  await click(button("Reload local grades", report()));
  expect(report().textContent).toContain("Grade report access is restricted");
  expect(report().textContent).not.toContain("71.25 / 95");
  read = () => page([], { ...coverage, coverage: "unsupported", reason: "sourceUnverified", permission: "unknown" });
  await click(button("Reload local grades", report()));
  expect(report().textContent).toContain("Unsupported grade report");
  expect(report().textContent).not.toContain("0.00");
});

it("discards prior-owner data and delayed results and keeps a grade read failure local", async () => {
  await openCourse();
  expect(report().textContent).toContain("Manual checkpoint");
  const delayed = deferred<AcademicPage<GradeObservation>>();
  read = () => delayed.promise;
  await click(button("Reload local grades", report()));
  owner = ownerB;
  read = () => page([grade("grade:100", "Owner B total", { itemKind: "courseTotal", displayValue: "B+" })]);
  await emitAppEvent("auth:changed", undefined);
  expect(report().textContent).toContain("B+");
  expect(report().textContent).not.toContain("Manual checkpoint");
  delayed.resolve({ context: ownerA, courseId: 1, coverage, records: grades });
  await emitAppEvent("test:flush", undefined);
  expect(report().textContent).not.toContain("71.25 / 95");
  read = () => { throw new Error("private diagnostic"); };
  await click(button("Reload local grades", report()));
  expect(report().textContent).toContain("Couldn’t load local grades");
  expect(report().textContent).not.toContain("private diagnostic");
  await click(button("Materials"));
  expect(document.querySelector('[role="tree"]')).not.toBeNull();
});

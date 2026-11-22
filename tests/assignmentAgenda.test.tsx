import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptAcademicContext, academicEpoch, invalidateAcademicSession } from "../src/lib/academicSession";
import type { AcademicContext, AcademicPage, AssignmentObservation } from "../src/lib/types";
import { appApi, button, click, deferred, emitAppEvent, flushApp, renderApp, resource, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>> | undefined;
const owner: AcademicContext = { contractVersion: 1, generation: "A", owner: { origin: "https://quanta.bits-pilani.ac.in", moodleUserId: 42 }, collectorsEnabled: false };
const assignment = resource({ id: 13, externalResourceId: "assign:13", title: "Systems assignment", resourceType: "assignment", url: owner.owner!.origin + "/mod/assign/view.php?id=13", dueAt: "2026-11-20" });
const quiz = resource({ id: 14, externalResourceId: "quiz:14", title: "Systems quiz", resourceType: "quiz", dueAt: "2026-11-19" });
const page: AcademicPage<AssignmentObservation> = {
  context: owner, courseId: assignment.courseId!, coverage: {
    permission: "permitted", reason: null, coverage: "complete", observedAt: "2026-11-16T12:00:00Z",
    lastSuccessfulAt: "2026-11-16T12:00:00Z", stale: false, baselineEstablished: true,
  }, records: [{
    source: { sourceUrl: assignment.url, sourceId: "assign:13", observedAt: "2026-11-16T12:00:00Z", visibility: "visible" },
    title: assignment.title, courseModuleId: 13, activityInstanceId: null, resourceId: 13,
    due: { kind: "dateOnly", value: "2026-11-18" }, dueDisplay: null,
    submissionStatus: "submitted", submissionDisplay: null, attemptNumber: 1, calendarEventId: null,
  }],
};
beforeEach(() => {
  setupApp();
  invalidateAcademicSession();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  appApi.academicContext.mockImplementation(async () => {
    acceptAcademicContext(owner, academicEpoch());
    return owner;
  });
  appApi.academicAssignments.mockResolvedValue(page);
  appApi.listResources.mockResolvedValue([assignment, quiz]);
  appApi.queryDueResources.mockResolvedValue({ total: 2, items: [assignment, quiz].map(resource => ({ resource, dateKind: "date", coursePaused: false })) });
});
afterEach(() => { app?.unmount(); app = undefined; invalidateAcademicSession(); vi.useRealTimers(); });

it("projects the self deadline once, shows submission details, and restores the material deadline on a failed private read", async () => {
  app = await renderApp();
  await click(button("Calendar"));
  expect(document.querySelectorAll('[aria-label="Show details for Systems assignment"]')).toHaveLength(1);
  expect(button("Show details for Systems quiz")).toBeTruthy();
  appApi.snapshotResourceUnreadEventIds.mockResolvedValue([77]);
  await click(button("Show details for Systems assignment"));
  expect(document.querySelector(".peek")?.textContent).toContain("2026-11-18");
  expect(document.querySelector(".peek")?.textContent).toContain("Submitted");
  expect(appApi.setEventReadState).not.toHaveBeenCalled();
  appApi.academicAssignments.mockRejectedValue(new Error("private database failure"));
  await emitAppEvent("sync:done", {});
  expect(document.querySelector(".peek")?.textContent).toContain("2026-11-20");
  expect(document.querySelector(".peek")?.textContent).toContain("Assignment details unavailable");
  expect(document.querySelector(".peek")?.textContent).not.toContain("Submitted");
  const heading = document.querySelector(".peek-title")!;
  await act(async () => { heading.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); });
  await flushApp();
  expect(appApi.previewResource).toHaveBeenCalledWith(assignment.id);
});

it("rejects a delayed previous-owner page while baseline Agenda remains usable", async () => {
  const old = deferred<typeof page>();
  appApi.academicAssignments.mockReturnValueOnce(old.promise).mockResolvedValue({ ...page, context: { ...owner, generation: "B" }, records: [], coverage: null });
  app = await renderApp();
  await click(button("Calendar"));
  appApi.academicContext.mockImplementation(async () => {
    const next = { ...owner, generation: "B", owner: { ...owner.owner!, moodleUserId: 43 } };
    acceptAcademicContext(next, academicEpoch());
    return next;
  });
  await emitAppEvent("auth:changed", {});
  old.resolve(page);
  await click(button("Show details for Systems assignment"));
  expect(document.querySelector(".peek")?.textContent).toContain("2026-11-20");
  expect(document.querySelector(".peek")?.textContent).not.toContain("Submitted");
});

it("adds an undated assignment once and hides restricted details while keeping its canonical Quanta action", async () => {
  appApi.listResources.mockResolvedValue([{ ...assignment, dueAt: null, sourcePageUrl: "https://quanta.bits-pilani.ac.in/course/view.php?id=101" }, quiz]);
  appApi.queryDueResources.mockResolvedValue({ total: 1, items: [{ resource: quiz, dateKind: "date", coursePaused: false }] });
  appApi.academicAssignments.mockResolvedValue({ ...page, records: [{ ...page.records[0], submissionStatus: "unknown", attemptNumber: null }] });
  app = await renderApp();
  await click(button("Calendar"));
  await click(button("Show details for Systems assignment"));
  expect(document.querySelector(".peek")?.textContent).toContain("SubmissionUnknown");
  expect(document.querySelector(".peek")?.textContent).toContain("Unavailable from source");
  await click(button("Open in Quanta", document.querySelector(".peek")!));
  expect(appApi.openExternal).toHaveBeenCalledWith(assignment.url);
  appApi.academicAssignments.mockResolvedValue({ ...page, coverage: {
    ...page.coverage!, coverage: "denied", permission: "restricted", reason: "permissionDenied", stale: true,
  } });
  await emitAppEvent("sync:done", {});
  expect(document.querySelector('[aria-label="Show details for Systems assignment"]')).toBeNull();
  expect(document.querySelector(".peek")).toBeNull();
  expect(button("Show details for Systems quiz")).toBeTruthy();
});

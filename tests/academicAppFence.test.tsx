import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appApi, deferred, emitAppEvent, renderApp, setupApp } from "./helpers/renderApp";
import { currentAcademicPage } from "../src/lib/academicSession";
import type { AcademicContext, AcademicPage, GradeObservation } from "../src/lib/types";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => { setupApp(); invoke.mockReset(); });
afterEach(() => app?.unmount());
const a: AcademicContext = { contractVersion: 1, generation: "A", owner: { origin: "https://quanta.bits-pilani.ac.in", moodleUserId: 4242 }, collectorsEnabled: false };
const page: AcademicPage<GradeObservation> = { context: a, courseId: 101, coverage: null, records: [] };
it("real App auth changes hide already-resolved academic pages and reject delayed A responses while materials remain usable", async () => {
  const { api: realApi } = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
  app = await renderApp();
  invoke.mockResolvedValueOnce(page).mockResolvedValueOnce(a);
  const loaded = await realApi.academicGrades("A", 101);
  expect(currentAcademicPage(loaded)).toEqual(page);
  const delayed = deferred<AcademicPage<GradeObservation>>();
  invoke.mockImplementationOnce(() => delayed.promise);
  const pending = realApi.academicGrades("A", 101);
  const rejected = expect(pending).rejects.toThrow("Academic session changed");
  appApi.authStatus.mockResolvedValue({ authenticated: true, attemptId: null, email: "b@example.invalid", fullName: "B", method: "password", acquiredAt: null, sessionExpired: false });
  await emitAppEvent("auth:changed", undefined);
  expect(currentAcademicPage(loaded)).toBeNull();
  delayed.resolve(page);
  await rejected;
  expect(appApi.listResources).toHaveBeenCalled();
  expect(appApi.academicGrades).not.toHaveBeenCalled(); // no academic polling is wired
});

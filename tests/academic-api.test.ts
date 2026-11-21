import { beforeEach, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { api } from "../src/lib/api";
import type { AcademicContext, AcademicPage, GradeObservation } from "../src/lib/types";
const context: AcademicContext = { contractVersion: 1, generation: "A-generation", owner: { origin: "https://quanta.bits-pilani.ac.in", moodleUserId: 4242 }, collectorsEnabled: false };
const page: AcademicPage<GradeObservation> = { context, courseId: 101, coverage: null, records: [] };
beforeEach(() => invoke.mockReset());
it("uses registered camelCase read contracts and requires the current generation", async () => {
  invoke.mockResolvedValueOnce(context);
  expect(await api.academicContext()).toEqual(context);
  expect(invoke).toHaveBeenLastCalledWith("academic_context");
  invoke.mockResolvedValueOnce(page).mockResolvedValueOnce(context);
  expect(await api.academicGrades(context.generation, 101)).toEqual(page);
  expect(invoke).toHaveBeenCalledWith("academic_grades", { generation: context.generation, courseId: 101 });
  expect(invoke).toHaveBeenLastCalledWith("academic_context");
});
it("rejects an old response after logout, including a backend response that escaped before logout", async () => {
  let resolve!: (page: AcademicPage<GradeObservation>) => void;
  invoke.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = api.academicGrades(context.generation, 101);
  invoke.mockResolvedValueOnce(undefined);
  await api.logout();
  invoke.mockResolvedValueOnce(context); // a response that escaped before backend logout
  resolve(page);
  await expect(pending).rejects.toThrow("Academic session changed");
});
it("rejects backend generation or owner replacement and propagates domain failures", async () => {
  invoke.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...context, generation: "B-generation", owner: { ...context.owner!, moodleUserId: 5252 } });
  await expect(api.academicGrades(context.generation, 101)).rejects.toThrow("Academic session changed");
  invoke.mockRejectedValueOnce(new Error("Academic storage unavailable"));
  await expect(api.academicAttendance(context.generation, 101)).rejects.toThrow("Academic storage unavailable");
});

// Run with npx vite-node scripts/bench/desktop-search.ts -- <inventory size>
import { performance } from "node:perf_hooks";
import { searchDesktop } from "../../src/lib/desktopSearch";
import type { Course, Resource } from "../../src/lib/types";

const size = Number(process.argv.at(-1));
const stamp = "2026-11-20T12:00:00Z";
const courses: Course[] = Array.from({ length: 100 }, (_, id) => ({
  id: id + 1, externalCourseId: String(id + 1), name: `Synthetic Course ${id + 1}`,
  shortName: `SYN ${id + 1}`, url: "https://example.test/course", firstSeenAt: stamp,
  lastScannedAt: null, lastScanStatus: null, monitoringStatus: "monitored", resourceCount: size / 100,
}));
const before = process.memoryUsage();
const started = performance.now();
const resources: Resource[] = Array.from({ length: size }, (_, n) => {
  const id = n + 1;
  const courseId = (n % 100) + 1;
  const sectionPath = [`Unit ${n % 9}`, n % 3 ? "Lectures" : "Exercises"];
  return {
    id, courseId, sectionPath, externalResourceId: `fixture:${id}`, courseName: courses[courseId - 1].name,
    resourceType: n % 3 ? "pdf" : "text", title: `Lecture ${id} ${n % 7 ? "regression" : "statistics"}`,
    url: `https://example.test/resource/${id}`, sourcePageUrl: null, uploadedAt: stamp,
    publishedAt: null, modifiedAt: null, dueAt: null, firstSeenAt: stamp, lastSeenAt: stamp, lastCheckedAt: stamp,
    contentFingerprint: null, availabilityStatus: "available", sizeBytes: null, section: sectionPath[1], isExternal: false,
  };
});
const inventory = { courses, resources, unreadIds: new Set(resources.filter(r => r.id % 10 === 0).map(r => r.id)) };
const derivedMs = performance.now() - started;
const fixture = process.memoryUsage();
const samples = [];
for (let iteration = 0; iteration < 21; iteration++) {
  const start = performance.now();
  const raw = iteration % 2 ? "statistics" : "regression";
  const result = searchDesktop({ raw, scope: { kind: "everywhere" }, timeZone: "UTC" }, inventory);
  if (!result.files.length || new Set(result.files.map(r => r.id)).size !== result.files.length) throw new Error("Invalid result");
  samples.push(performance.now() - start);
}
const warm = samples.slice(1).sort((a, b) => a - b);
console.log(JSON.stringify({ size, derivedMs, fixtureHeapMiB: (fixture.heapUsed - before.heapUsed) / 2**20,
  peakRssMiB: process.resourceUsage().maxRSS / 1024, coldMs: samples[0], warmP50Ms: warm[9], warmP95Ms: warm[18] }));

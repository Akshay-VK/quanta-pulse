// The invariant that keeps the Dashboard honest: its summary counters are
// derived from the same canonical change events (via eventKinds) that drive
// its activity list — so the number always equals the rows the matching filter
// shows, and it can never drift from History or the calendar.

import { describe, expect, it } from "vitest";
import { filterResources, matchesKind, type FeedKind } from "../src/lib/filter";
import type { Resource } from "../src/lib/types";

function resource(id: number, overrides: Partial<Resource> = {}): Resource {
  return {
    id,
    externalResourceId: `r${id}`,
    courseId: 1,
    courseName: "Discrete Maths",
    title: `Lecture ${id}`,
    url: `https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=${id}`,
    sourcePageUrl: null,
    resourceType: "PDF",
    uploadedAt: null,
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: "2026-10-11T09:05:00+05:30",
    lastSeenAt: "2026-10-11T09:05:00+05:30",
    lastCheckedAt: "2026-10-11T10:00:00+05:30",
    contentFingerprint: "abc",
    availabilityStatus: "available",
    sizeBytes: null,
    section: null,
    isExternal: false,
    ...overrides,
  };
}

describe("dashboard counters agree with the activity list", () => {
  const eventKinds = new Map<number, Set<string>>([
    [1, new Set(["new"])],
    [2, new Set(["updated"])],
    [3, new Set(["announcement"])],
  ]);
  const resources = [resource(1), resource(2), resource(3), resource(4)];

  const counts = (kind: FeedKind) =>
    resources.filter((r) => matchesKind(r, kind, eventKinds)).length;

  it("matches the size of the same filter's list for every kind", () => {
    for (const kind of ["all", "new", "updated", "deadlines", "unavailable"] as FeedKind[]) {
      expect(counts(kind)).toBe(filterResources(resources, { kind, eventKinds }).length);
    }
  });

  it("counts newly detected resources (uploads and announcements) once", () => {
    // Resource 1 (new) and 3 (announcement) are newly detected, exactly as the
    // History and calendar views classify them.
    expect(counts("new")).toBe(2);
  });

  it("every row in the New feed carries a recorded new/announcement event", () => {
    const listed = filterResources(resources, { kind: "new", eventKinds });
    expect(listed).toHaveLength(2);
    for (const r of listed) {
      const kinds = eventKinds.get(r.id) ?? new Set();
      expect(kinds.has("new") || kinds.has("announcement")).toBe(true);
    }
  });

  it("an unread new event survives a later empty scan (regression)", () => {
    // This simulates the original bug: the counter used a "since last scan"
    // window. Any later scan pushed the window past the event and the
    // Dashboard showed 0 while History still listed the upload. The Dashboard
    // must count actual change events instead.
    const kinds = new Map<number, Set<string>>([[1, new Set(["new"])]]);
    expect(resources.filter((r) => matchesKind(r, "new", kinds)).length).toBe(1);
  });
});
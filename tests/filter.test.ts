import { describe, expect, it } from "vitest";
import {
  activityTimestamp,
  filterResources,
  groupByDate,
  isBaselineResource,
  matchesKind,
  sortByRecency,
  statusLabel,
} from "../src/lib/filter";
import type { Resource } from "../src/lib/types";

function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    externalResourceId: "r1",
    courseId: 1,
    courseName: "Discrete Maths",
    title: "Lecture 4",
    url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
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

describe("activityTimestamp / sortByRecency", () => {
  it("uses upload before publication before modification", () => {
    const r = resource({
      publishedAt: "2026-10-01T00:00:00Z",
      uploadedAt: "2026-10-02T00:00:00Z",
      modifiedAt: "2026-10-03T00:00:00Z",
    });
    expect(activityTimestamp(r)).toBe("2026-10-02T00:00:00Z");
  });

  it("never uses the last scan time as the activity timestamp", () => {
    const r = resource({
      uploadedAt: null,
      publishedAt: null,
      modifiedAt: null,
      firstSeenAt: "2026-10-01T00:00:00Z",
      lastSeenAt: "2026-10-15T00:00:00Z", // a later scan must not win the sort
    });
    expect(activityTimestamp(r)).toBe("2026-10-01T00:00:00Z");
  });

  it("falls back to the detection timestamp when no source date exists", () => {
    const r = resource({
      uploadedAt: null,
      publishedAt: null,
      modifiedAt: null,
      firstSeenAt: "2026-10-01T00:00:00Z",
    });
    expect(activityTimestamp(r)).toBe("2026-10-01T00:00:00Z");
  });

  it("orders newest first", () => {
    const older = resource({ id: 1, uploadedAt: "2026-10-01T00:00:00Z" });
    const newer = resource({ id: 2, uploadedAt: "2026-10-05T00:00:00Z" });
    expect(sortByRecency([older, newer]).map((r) => r.id)).toEqual([2, 1]);
  });

  it("breaks timestamp ties deterministically by title then id", () => {
    const same = "2026-10-01T00:00:00Z";
    const z = resource({ id: 3, title: "Zebra", uploadedAt: same });
    const a2 = resource({ id: 2, title: "Aardvark", uploadedAt: same });
    const a1 = resource({ id: 1, title: "Aardvark", uploadedAt: same });
    // Same timestamp: title ascending (Aardvark before Zebra), then id ascending
    // within the title tie — fully deterministic regardless of input order.
    expect(sortByRecency([z, a2, a1]).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input array", () => {
    const input = [resource({ id: 1 }), resource({ id: 2, uploadedAt: "2026-10-05T00:00:00Z" })];
    const copy = [...input];
    sortByRecency(input);
    expect(input).toEqual(copy);
  });
});

describe("matchesKind", () => {
  const kinds = new Map<number, Set<string>>([[1, new Set(["new", "updated"])]]);

  it("all always matches", () => {
    expect(matchesKind(resource(), "all", kinds)).toBe(true);
  });
  it("new matches new and announcement events", () => {
    expect(matchesKind(resource({ id: 1 }), "new", kinds)).toBe(true);
    const announce = new Map<number, Set<string>>([[2, new Set(["announcement"])]]);
    expect(matchesKind(resource({ id: 2 }), "new", announce)).toBe(true);
  });
  it("updated only matches updated events", () => {
    const onlyNew = new Map<number, Set<string>>([[3, new Set(["new"])]]);
    expect(matchesKind(resource({ id: 3 }), "updated", onlyNew)).toBe(false);
  });
  it("deadlines matches only resources with a future due date", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    expect(matchesKind(resource({ dueAt: "2026-10-20" }), "deadlines", undefined, now)).toBe(true);
    expect(matchesKind(resource({ dueAt: "2026-10-10" }), "deadlines", undefined, now)).toBe(false);
    expect(matchesKind(resource(), "deadlines", undefined, now)).toBe(false);
  });
  it("unavailable matches any non-available status", () => {
    expect(matchesKind(resource({ availabilityStatus: "unavailable" }), "unavailable")).toBe(true);
    expect(matchesKind(resource({ availabilityStatus: "authentication_required" }), "unavailable")).toBe(
      true,
    );
    expect(matchesKind(resource(), "unavailable")).toBe(false);
  });
});

describe("filterResources", () => {
  const list = [
    resource({ id: 1, courseId: 1, courseName: "Discrete Maths", title: "Lecture 4" }),
    resource({ id: 2, courseId: 2, courseName: "Data Structures", title: "Assignment 1", dueAt: "2026-10-20" }),
    resource({
      id: 3,
      courseId: 1,
      courseName: "Discrete Maths",
      title: "Slides",
      availabilityStatus: "unavailable",
    }),
  ];

  it("filters by course", () => {
    expect(filterResources(list, { courseId: 1 }).map((r) => r.id)).toEqual([1, 3]);
  });

  it("searches across title, course and type", () => {
    expect(filterResources(list, { search: "assign" }).map((r) => r.id)).toEqual([2]);
    expect(filterResources(list, { search: "data" }).map((r) => r.id)).toEqual([2]);
    expect(filterResources(list, { search: "pdf" }).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("combines course and kind filters", () => {
    expect(filterResources(list, { kind: "unavailable", courseId: 1 }).map((r) => r.id)).toEqual([3]);
  });

  it("ignores surrounding whitespace in search", () => {
    expect(filterResources(list, { search: "  slides  " }).map((r) => r.id)).toEqual([3]);
  });
});

describe("statusLabel", () => {
  const now = new Date(2026, 9, 11, 12, 0, 0);

  it("reports unavailable first", () => {
    expect(statusLabel(resource({ availabilityStatus: "unavailable" }), undefined, now)).toBe(
      "UNAVAILABLE",
    );
  });
  it("reports a near deadline", () => {
    const due = new Date(2026, 9, 13, 12, 0).toISOString();
    expect(statusLabel(resource({ dueAt: due }), undefined, now)).toBe("DEADLINE");
  });
  it("prefers updated over new", () => {
    const kinds = new Map<number, Set<string>>([[1, new Set(["new", "updated"])]]);
    expect(statusLabel(resource({ id: 1 }), kinds, now)).toBe("UPDATED");
  });
  it("returns null for a plain available resource", () => {
    expect(statusLabel(resource(), undefined, now)).toBeNull();
  });
});

describe("groupByDate", () => {
  const now = new Date(2026, 9, 11, 18, 0, 0);

  it("groups by local calendar day with friendly labels", () => {
    const list = [
      resource({ id: 1, publishedAt: "2026-10-11T09:00:00" }), // today
      resource({ id: 2, publishedAt: "2026-10-10T09:00:00" }), // yesterday
      resource({ id: 3, publishedAt: "2026-10-01T09:00:00" }), // earlier
    ];
    const groups = groupByDate(list, now);
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      expect.stringContaining("October"),
    ]);
    expect(groups[0].items.map((r) => r.id)).toEqual([1]);
  });

  it("orders groups and items newest first", () => {
    const list = [
      resource({ id: 1, publishedAt: "2026-10-11T08:00:00" }),
      resource({ id: 2, publishedAt: "2026-10-11T16:00:00" }),
    ];
    const groups = groupByDate(list, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("isBaselineResource", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("treats an untouched discovered file as baseline", () => {
    expect(isBaselineResource(resource(), undefined, now)).toBe(true);
  });

  it("keeps any file that produced a change event", () => {
    const kinds = new Map([[1, new Set(["new"])]]);
    expect(isBaselineResource(resource(), kinds, now)).toBe(false);
  });

  it("keeps an unavailable file, which has its own row to explain", () => {
    expect(isBaselineResource(resource({ availabilityStatus: "unavailable" }), undefined, now)).toBe(
      false,
    );
  });

  it("keeps a file with a future deadline even without an event", () => {
    expect(
      isBaselineResource(resource({ dueAt: "2026-11-01T00:00:00Z" }), undefined, now),
    ).toBe(false);
  });

  it("treats an already-due file with no event as baseline", () => {
    expect(
      isBaselineResource(resource({ dueAt: "2026-10-01T00:00:00Z" }), undefined, now),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  categoryOptions,
  filterCourseResources,
  groupByCategory,
  resourceCategory,
  sortResources,
  typeOptions,
} from "../src/lib/courseLibrary";
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
    resourceType: "pdf",
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

describe("resourceCategory", () => {
  it("maps resource types to the canonical category, case-insensitively", () => {
    expect(resourceCategory("PDF")).toBe("pdf");
    expect(resourceCategory("presentation")).toBe("presentations");
    expect(resourceCategory("assignment")).toBe("assignments");
    expect(resourceCategory("quiz")).toBe("papers");
    expect(resourceCategory("announcement")).toBe("announcements");
    expect(resourceCategory("external link")).toBe("links");
    expect(resourceCategory("folder")).toBe("folders");
  });

  it("files unknown types under 'other' rather than guessing", () => {
    expect(resourceCategory("hologram")).toBe("other");
    expect(resourceCategory(null)).toBe("other");
    expect(resourceCategory("")).toBe("other");
  });
});

describe("sortResources", () => {
  const older = resource({ id: 1, title: "Older", firstSeenAt: "2026-10-01T00:00:00Z" });
  const newer = resource({ id: 2, title: "Newer", firstSeenAt: "2026-10-10T00:00:00Z" });
  const unknown = resource({ id: 3, title: "Unknown", firstSeenAt: "" });

  it("orders newest and oldest first", () => {
    expect(sortResources([older, newer], "newest").map((r) => r.title)).toEqual([
      "Newer",
      "Older",
    ]);
    expect(sortResources([older, newer], "oldest").map((r) => r.title)).toEqual([
      "Older",
      "Newer",
    ]);
  });

  it("always sinks records with no timestamp, in either direction", () => {
    const newest = sortResources([unknown, newer, older], "newest");
    const oldest = sortResources([unknown, newer, older], "oldest");
    expect(newest[newest.length - 1].title).toBe("Unknown");
    expect(oldest[oldest.length - 1].title).toBe("Unknown");
  });

  it("sorts by name and by type deterministically", () => {
    expect(sortResources([newer, older], "name").map((r) => r.title)).toEqual([
      "Newer",
      "Older",
    ]);
    const byType = sortResources(
      [
        resource({ id: 5, title: "b", resourceType: "pdf" }),
        resource({ id: 6, title: "a", resourceType: "assignment" }),
      ],
      "type",
    );
    expect(byType.map((r) => r.resourceType)).toEqual(["assignment", "pdf"]);
  });
});

describe("filterCourseResources", () => {
  const items = [
    resource({ id: 1, title: "Lecture 1", resourceType: "pdf", section: "Week 1" }),
    resource({ id: 2, title: "Assignment 1", resourceType: "assignment" }),
    resource({ id: 3, title: "Slides", resourceType: "presentation" }),
  ];

  it("searches title, type and section", () => {
    expect(filterCourseResources(items, { search: "lecture" }).map((r) => r.id)).toEqual([1]);
    expect(filterCourseResources(items, { search: "week 1" }).map((r) => r.id)).toEqual([1]);
    expect(filterCourseResources(items, { search: "presentation" }).map((r) => r.id)).toEqual([
      3,
    ]);
  });

  it("filters by exact type and by category", () => {
    expect(filterCourseResources(items, { type: "pdf" }).map((r) => r.id)).toEqual([1]);
    expect(
      filterCourseResources(items, { category: "presentations" }).map((r) => r.id),
    ).toEqual([3]);
    expect(filterCourseResources(items, { category: "all" }).length).toBe(3);
  });
});

describe("groupByCategory", () => {
  it("groups in canonical order and omits empty categories", () => {
    const groups = groupByCategory([
      resource({ id: 1, resourceType: "presentation" }),
      resource({ id: 2, resourceType: "pdf" }),
      resource({ id: 3, resourceType: "pdf" }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["pdf", "presentations"]);
    expect(groups[0].items.length).toBe(2);
  });
});

describe("typeOptions / categoryOptions", () => {
  it("counts distinct types and categories", () => {
    const items = [
      resource({ id: 1, resourceType: "pdf" }),
      resource({ id: 2, resourceType: "pdf" }),
      resource({ id: 3, resourceType: "assignment" }),
    ];
    expect(typeOptions(items)).toEqual([
      { type: "assignment", count: 1 },
      { type: "pdf", count: 2 },
    ]);
    expect(categoryOptions(items)).toEqual([
      { id: "pdf", label: "PDFs", count: 2 },
      { id: "assignments", label: "Assignments", count: 1 },
    ]);
  });
});

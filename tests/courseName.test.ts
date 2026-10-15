// Course presentation: the trailing course code, alias overrides, collisions
// that need a suffix, and first-sight colour assignment (spec 12, Task 3).

import { beforeEach, describe, expect, it } from "vitest";
import {
  ALIASES_KEY,
  COLORS_KEY,
  DOT_COUNT,
  assignDotIndices,
  buildDisplayNames,
  deriveDisplayName,
  displayName,
  loadAliases,
  loadDotIndices,
  registerCourseLabels,
  courseTitle,
  courseTooltip,
  courseDot,
} from "../src/lib/courseName";
import type { Course } from "../src/lib/types";

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    externalCourseId: "1166",
    name: "1166_ECE_INSTR_EEE_ECOM F215",
    shortName: "ECOM F215",
    url: "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    firstSeenAt: "2026-09-01T00:00:00Z",
    lastScannedAt: null,
    lastScanStatus: null,
    monitoringStatus: "monitored",
    resourceCount: 125,
    ...overrides,
  };
}

describe("deriveDisplayName", () => {
  it("extracts the trailing course code from a raw Moodle name", () => {
    expect(deriveDisplayName("1166_ECE_INSTR_EEE_ECOM F215")).toBe("ECOM F215");
    expect(deriveDisplayName("1124_MATH_INSTR_MATH F111")).toBe("MATH F111");
    expect(deriveDisplayName("1177_BITS F214")).toBe("BITS F214");
  });

  it("leaves a name that carries no course code untouched", () => {
    expect(deriveDisplayName("Discrete Mathematics")).toBe("Discrete Mathematics");
    expect(deriveDisplayName("Physics")).toBe("Physics");
  });
});

describe("displayName", () => {
  it("prefers a user alias over the derived code", () => {
    const aliases = { "1": "VLSI Design" };
    expect(displayName(course(), aliases)).toBe("VLSI Design");
  });

  it("falls back to the derived code when the alias is blank", () => {
    expect(displayName(course(), { "1": "   " })).toBe("ECOM F215");
  });
});

describe("buildDisplayNames", () => {
  it("disambiguates two courses that derive the same code", () => {
    const courses = [
      course({ id: 1 }),
      course({ id: 2, name: "1167_ECE_EEE_ECOM F215", externalCourseId: "1167" }),
    ];
    const names = buildDisplayNames(courses);
    expect(names.get(1)).toBe("ECOM F215 (ECE/INSTR/EEE)");
    expect(names.get(2)).toBe("ECOM F215 (ECE/EEE)");
  });

  it("leaves unique names alone", () => {
    const names = buildDisplayNames([course(), course({ id: 2, name: "1151_BITS F211" })]);
    expect(names.get(1)).toBe("ECOM F215");
    expect(names.get(2)).toBe("BITS F211");
  });

  it("respects aliases when grouping collisions", () => {
    const courses = [
      course({ id: 1 }),
      course({ id: 2, name: "1167_ECE_EEE_ECOM F215", externalCourseId: "1167" }),
    ];
    const names = buildDisplayNames(courses, { "1": "Embedded" });
    expect(names.get(1)).toBe("Embedded");
    expect(names.get(2)).toBe("ECOM F215");
  });
});

describe("assignDotIndices", () => {
  const courses = Array.from({ length: DOT_COUNT }, (_, i) => course({ id: i + 1 }));

  it("gives the first twelve courses twelve distinct hues", () => {
    const { index } = assignDotIndices(courses);
    expect(new Set(index.values()).size).toBe(DOT_COUNT);
  });

  it("keeps a stored colour so a course never changes hue", () => {
    const { index, stored } = assignDotIndices(courses, { "1": 5 });
    expect(index.get(1)).toBe(5);
    expect(index.get(2)).toBe(0);
    // The existing assignment is what gets persisted, not a fresh shuffle.
    expect(stored["1"]).toBe(5);
  });

  it("ignores a nonsense stored index", () => {
    const { index } = assignDotIndices(courses, { "1": 99 });
    expect(index.get(1)).toBe(0);
  });
});

describe("the registry views read", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("serves display name, raw tooltip and dot from one place", () => {
    registerCourseLabels([course()]);
    expect(courseTitle(1)).toBe("ECOM F215");
    expect(courseTitle(99, "Fallback")).toBe("Fallback");
    expect(courseTooltip(1)).toContain("1166_ECE_INSTR_EEE_ECOM F215");
    expect(courseDot(1)).toBe(0);
  });

  it("round-trips aliases and colours through localStorage", () => {
    localStorage.setItem(ALIASES_KEY, JSON.stringify({ "1": "VLSI Design" }));
    localStorage.setItem(COLORS_KEY, JSON.stringify({ "1": 4 }));

    registerCourseLabels([course()]);
    expect(courseTitle(1)).toBe("VLSI Design");
    expect(courseDot(1)).toBe(4);

    expect(loadAliases()).toEqual({ "1": "VLSI Design" });
    expect(loadDotIndices()).toEqual({ "1": 4 });
  });

  it("survives corrupt storage instead of throwing", () => {
    localStorage.setItem(ALIASES_KEY, "{not json");
    expect(loadAliases()).toEqual({});
    localStorage.setItem(COLORS_KEY, "null");
    expect(loadDotIndices()).toEqual({});
  });
});

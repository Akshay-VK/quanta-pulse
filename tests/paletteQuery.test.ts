import { describe, expect, it } from "vitest";
import { parsePaletteQuery } from "../src/lib/paletteQuery";

const courses = [
  { id: 1, name: "CS F111 Computer Programming", shortName: "CS F111" },
  { id: 2, name: "MATH F111 Mathematics I", shortName: "MATH F111" },
];
const resources = [
  { id: 10, title: "Lecture 04 Data structures", courseId: 1, courseName: "CS F111", resourceType: "PDF", dueAt: null, availabilityStatus: "available" },
  { id: 11, title: "Assignment 02", courseId: 1, courseName: "CS F111", resourceType: "PDF", dueAt: "2099-01-02T00:00:00Z", availabilityStatus: "available" },
  { id: 12, title: "Old link", courseId: 2, courseName: "MATH F111", resourceType: "URL", dueAt: null, availabilityStatus: "unavailable" },
] as const;

describe("parsePaletteQuery", () => {
  it("parses recognized tokens against complete inventories and keeps free text", () => {
    const q = parsePaletteQuery("course:cs is:unread lecture", { courses, resources });
    expect(q.freeText).toBe("lecture");
    expect(q.tokens).toEqual([
      { key: "course", value: "cs", raw: "course:cs", recognized: true, valid: true },
      { key: "is", value: "unread", raw: "is:unread", recognized: true, valid: true },
    ]);
  });

  it("discloses unknown keys and invalid recognized values without throwing", () => {
    const q = parsePaletteQuery("type:pdf due:banana foo:bar", { courses, resources });
    expect(q.tokens[0]).toMatchObject({ key: "type", recognized: true, valid: true });
    expect(q.tokens[1]).toMatchObject({ key: "due", recognized: true, valid: false, reason: "invalid-value" });
    expect(q.tokens[2]).toMatchObject({ key: "foo", recognized: false, valid: false, reason: "unknown-key" });
  });

  it("matches courses/types across inventory and exposes highlight text safely", () => {
    const q = parsePaletteQuery("type:url course:math", { courses, resources });
    expect(q.filters.types).toEqual(["URL"]);
    expect(q.filters.courseIds).toEqual([2]);
    expect(q.highlight("A+B", "a+b")).toEqual([
      { text: "A+B", match: true },
    ]);
  });
});

it('retains quoted punctuation and literal quote/backslash escapes when editing controls', () => {
  const raw = 'course:"ECOM \\"F222\\"" "A\\\\B" "lecture: 4"';
  const result = parsePaletteQuery(raw, { courses: [{ id: 3, name: 'Econometrics', shortName: 'ECOM "F222"' }], resources: [] });
  expect(result.errors).toEqual([]);
  expect(result.filters.courseIds).toEqual([3]);
  expect(result.terms).toEqual(['A\\B', 'lecture: 4']);
  expect(result.freeRaw).toBe('"A\\\\B" "lecture: 4"');
});

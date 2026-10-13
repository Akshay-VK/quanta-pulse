import { describe, expect, it } from "vitest";
import { buildCourseTree, dedupeCourseResources, findNode } from "../src/lib/courseTree";
import { filterCourseResources } from "../src/lib/courseLibrary";
import type { Resource } from "../src/lib/types";

function resource(id: number, sectionPath: string[]): Resource {
  return {
    id,
    externalResourceId: `r-${id}`,
    courseId: 1,
    courseName: "BITS F225",
    title: `Lecture ${id}`,
    url: `https://quanta.bits-pilani.ac.in/file/${id}.pdf`,
    sourcePageUrl: `https://quanta.bits-pilani.ac.in/mod/page/view.php?id=${id}`,
    resourceType: "pdf",
    uploadedAt: null,
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: "2026-10-12T00:00:00Z",
    lastSeenAt: null,
    lastCheckedAt: null,
    contentFingerprint: null,
    availabilityStatus: "available",
    sizeBytes: null,
    section: sectionPath[0] ?? null,
    sectionPath,
    isExternal: false,
  };
}

describe("course hierarchy", () => {
  it("builds arbitrarily nested folders and counts resources up the tree", () => {
    const resources = [
      resource(1, ["Lecture Notes", "Recorded Lectures", "Recorded Lecture 2.1"]),
      resource(2, ["Lecture Notes", "Recorded Lectures", "Recorded Lecture 2.1"]),
      resource(3, ["Assignments"]),
    ];
    const tree = buildCourseTree(resources, "BITS F225");
    expect(tree.count).toBe(3);
    expect(findNode(tree, ["Lecture Notes"])?.count).toBe(2);
    expect(findNode(tree, ["Lecture Notes", "Recorded Lectures", "Recorded Lecture 2.1"])?.resources).toHaveLength(2);
    expect(tree.children.map((node) => node.name)).toEqual(["Assignments", "Lecture Notes"]);
  });

  it("finds deep resources across the tree without losing their path", () => {
    const item = resource(1, ["Lecture Notes", "Recorded Lectures", "Recorded Lecture 2.1"]);
    expect(filterCourseResources([item], { search: "Recorded Lecture 2.1" })).toEqual([item]);
  });

  it("uses stable, unambiguous path keys and unique descendant counts", () => {
    const first = resource(1, ["Worksheet Folder", "Long / Nested Section"]);
    const second = resource(2, ["Worksheet Folder", "Long / Nested Section"]);
    const duplicate = { ...first, id: 99, title: "Duplicate response row" };
    const tree = buildCourseTree([first, second, duplicate], "MATH F211");
    const repeatedBuild = buildCourseTree([second, first], "MATH F211");

    expect(tree.count).toBe(2);
    expect(findNode(tree, ["Worksheet Folder"])?.count).toBe(2);
    expect(findNode(tree, ["Worksheet Folder", "Long / Nested Section"])?.resources).toHaveLength(2);
    expect(tree.children[0].id).toBe(repeatedBuild.children[0].id);
    expect(dedupeCourseResources([first, duplicate])).toEqual([first]);
  });

  it("keeps distinct path boundaries distinct even when names contain slashes", () => {
    const left = resource(1, ["A/B", "C"]);
    const right = resource(2, ["A", "B/C"]);
    const tree = buildCourseTree([left, right], "MATH F211");
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].id).not.toBe(tree.children[1].id);
  });

  it("matches MATH F211's sibling sections, folder counts and total inventory", () => {
    const inventory: Resource[] = [];
    let id = 1;
    const add = (count: number, path: string[]) => {
      for (let index = 0; index < count; index++) inventory.push(resource(id++, path));
    };

    add(15, ["MATH F211"]);
    add(5, ["Notices"]);
    add(9, ["Worksheets", "Worksheets"]);
    add(21, ["Section-1", "Section-1 Slides"]);
    add(23, ["Section-2", "Section-2 Slides"]);
    add(8, ["Section-3", "Section-3 Slides"]);
    add(20, ["Section-4: Consultation Hour: Monday from 4.30 PM to 5.30 PM", "Section-4 Slides"]);
    add(4, ["Section-4: Consultation Hour: Monday from 4.30 PM to 5.30 PM", "Lecture Attendance"]);
    add(7, ["Tuesday_Tutorials attendance"]);
    add(7, ["Thursday_Tutorials attendance"]);

    const tree = buildCourseTree([...inventory, { ...inventory[0], id: 1000 }], "MATH F211");
    const repeated = buildCourseTree(inventory, "MATH F211");

    expect(tree.count).toBe(119);
    expect(tree.children.map((node) => node.name)).toEqual(repeated.children.map((node) => node.name));
    expect(findNode(tree, ["Worksheets"])?.count).toBe(9);
    expect(findNode(tree, ["Worksheets", "Worksheets"])?.resources).toHaveLength(9);
    expect(findNode(tree, ["Section-1"])?.count).toBe(21);
    expect(findNode(tree, ["Section-2"])?.count).toBe(23);
    expect(findNode(tree, ["Section-3"])?.count).toBe(8);
    expect(findNode(tree, ["Section-4: Consultation Hour: Monday from 4.30 PM to 5.30 PM"])?.count).toBe(24);
    expect(findNode(tree, ["Worksheets", "Section-1 Slides"])).toBeNull();
    expect(tree.count).toBe(inventory.length);
  });
});

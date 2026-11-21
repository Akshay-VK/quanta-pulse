import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, click, course, renderApp, resource, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>> | undefined;

beforeEach(() => {
  setupApp();
  appApi.listCourses.mockResolvedValue([course, { ...course, id: 2, name: "Physics", shortName: "Physics" }]);
  appApi.listResources.mockResolvedValue([
    resource({ id: 1, externalResourceId: "r1", title: "Lecture slides", sectionPath: ["Week 4", "Lectures"] }),
    resource({ id: 2, externalResourceId: "r2", title: "Tutorial sheet", sectionPath: ["Week 4", "Tutorials"] }),
    resource({ id: 3, externalResourceId: "r3", title: "Physics notes", courseId: 2 }),
  ]);
});

afterEach(() => { app?.unmount(); app = undefined; });

describe("course folders in the primary sidebar", () => {
  it("opens the chosen folder in one materials pane and keeps siblings in the sidebar", async () => {
    app = await renderApp();
    const sidebar = app.container.querySelector(".sidebar")!;
    const main = app.container.querySelector("main")!;
    await click(button("Expand MATH F111", sidebar));
    expect(main.querySelector("h1")?.textContent).toBe("Inbox");
    await click(button("Expand Week 4", sidebar));
    await click(button("Lectures", sidebar));

    expect(button("Lectures", sidebar).getAttribute("aria-current")).toBe("page");
    expect(button("Tutorials", sidebar)).toBeTruthy();
    expect(button("Physics", sidebar)).toBeTruthy();
    expect(main.querySelector(".course-folder-rail")).toBeNull();
    expect(main.textContent).toContain("Lecture slides");
    expect(main.textContent).not.toContain("Tutorial sheet");
    expect(main.textContent).not.toContain("Physics notes");

    await click(button("MATH F111", sidebar));
    expect(button("MATH F111", sidebar).getAttribute("aria-current")).toBe("page");
    expect(main.textContent).toContain("Lecture slides");
    expect(main.textContent).toContain("Tutorial sheet");
    expect(main.textContent).not.toContain("Physics notes");
  });
});

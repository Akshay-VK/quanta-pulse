// A1: ResourceRow is a grid, so a long title ellipsises instead of pushing the
// course pill, status tag or time out of their columns. Narrow containers get
// the two-line compact layout. jsdom does not lay out CSS, so the structural
// contract is asserted against the stylesheet source as well as the DOM.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ResourceRow from "../src/components/ResourceRow";
import { TooltipProvider } from "../src/components/ui/Tooltip";
import contentCssRaw from "../src/styles/components/content.css?raw";
import uiCssRaw from "../src/styles/components/ui.css?raw";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const LONG_TITLE = "Digital Design Lecture 14_Combinational_Circuits_4.pdf";

/** Comments removed, so a rule's selector capture is not glued to the comment
 *  above it. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const contentCss = stripComments(contentCssRaw);
const uiCss = stripComments(uiCssRaw);

/** The first declaration block whose selector list contains `selector`. Handles
 *  grouped selectors like `.a, .b { … }`. The body may not contain braces, which
 *  keeps the `@layer` wrapper from swallowing the first rule inside it. */
function rule(css: string, selector: string): string {
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(",").some((s) => s.trim() === selector)) return body;
  }
  return "";
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(density?: "comfortable" | "compact") {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <ResourceRow
          title={LONG_TITLE}
          type="PDF"
          courseId={1}
          courseCode="DES F211"
          courseName="Digital Design"
          unread
          selected={false}
          unavailable={false}
          status={{ kind: "new", label: "New" }}
          timeLabel="09:05"
          openLabel="Open in Quanta"
          density={density}
          onSelect={() => {}}
          menu={[]}
        />
      </TooltipProvider>,
    );
  });
}

describe("ResourceRow layout", () => {
  it("is one line by default and two lines when compact", async () => {
    await render();
    expect(container.querySelector(".resource-row")?.className).not.toContain("row-compact");

    await render("compact");
    expect(container.querySelector(".resource-row")?.className).toContain("row-compact");
  });

  it("keeps title, pill, tag and time as separate grid children", async () => {
    await render();
    const row = container.querySelector(".resource-row")!;
    // The pill must stay outside the select button: a button inside a button is
    // invalid and fails the a11y check.
    expect(row.querySelector(".row-select .course-pill")).toBeNull();
    expect(row.querySelector(".row-meta .course-pill")).toBeTruthy();
    expect(row.querySelector(".row-meta .tag")).toBeTruthy();
    expect(row.querySelector(".row-time")).toBeTruthy();
    expect(row.querySelector(".row-actions")).toBeTruthy();
  });

  it("gives a long title an ellipsis hook and its full text as a title", async () => {
    await render();
    const title = container.querySelector(".row-title");
    expect(title?.textContent).toBe(LONG_TITLE);
    expect(title?.getAttribute("title")).toBe(LONG_TITLE);
  });
});

describe("ResourceRow stylesheet contract", () => {
  it("lays the row out as a grid with a shrinkable main column", () => {
    const row = rule(contentCss, ".resource-row");
    expect(row).toContain("display: grid");
    expect(row).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("repeats the dot, icon and title tracks inside the select button", () => {
    const select = rule(contentCss, ".row-select");
    expect(select).toContain("grid-template-columns: 7px 16px minmax(0, 1fr)");
  });

  it("lets every text holder shrink to zero", () => {
    for (const selector of [".row-select", ".row-title-wrap", ".row-title", ".row-meta"]) {
      expect(rule(contentCss, selector)).toContain("min-width: 0");
    }
  });

  it("stacks the compact row onto two lines", () => {
    expect(rule(contentCss, ".resource-row.row-compact")).toContain("grid-template-columns");
    // Line 2: the pill, tag and time move off the title's row.
    expect(rule(contentCss, ".row-compact .row-meta")).toContain("grid-row: 2");
    expect(rule(contentCss, ".row-compact .row-time")).toContain("grid-row: 2");
  });

  it("caps the course pill at 16ch and ellipsises its label", () => {
    expect(rule(uiCss, ".course-pill")).toContain("max-width: 16ch");
    expect(rule(uiCss, ".cp-code")).toContain("text-overflow: ellipsis");
    // The pill never shrinks, so the row's other columns keep their width.
    expect(rule(contentCss, ".row-meta .course-pill")).toContain("flex: 0 0 auto");
  });

  it("drops the dead .row-tags rule", () => {
    expect(contentCss).not.toContain(".row-tags");
  });
});

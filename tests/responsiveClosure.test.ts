import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = (file: string) => readFileSync(resolve(process.cwd(), "src/styles", file), "utf8");

/** Body of the first media query with the exact condition, including nested blocks. */
function media(source: string, condition: string): string {
  const start = source.lastIndexOf(`@media ${condition}`);
  expect(start, `missing @media ${condition}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated @media ${condition}`);
}

describe("responsive closure rules", () => {
  const content = css("components/content.css");
  const layout = css("layout.css");
  const overlays = css("components/overlays.css");

  it("drops table Section before Detected and scrolls filters locally", () => {
    const narrow = media(content, "(max-width: 959px)");
    expect(narrow).toContain(".data-table th.section-cell");
    expect(narrow).toContain(".data-table td.section-cell");
    const zoom = media(content, "(max-width: 759px)");
    expect(zoom).toContain(".data-table th.detected-cell");
    expect(zoom).toContain(".filter-bar");
    expect(zoom).toContain("overflow-x: auto");
  });

  it("wraps the header and prevents page-level horizontal scroll at 200% zoom", () => {
    const zoom = media(layout, "(max-width: 760px)");
    expect(zoom).toContain(".topbar");
    expect(zoom).toContain("flex-wrap: wrap");
    expect(zoom).toContain(".app-main");
    expect(zoom).toContain("overflow-x: hidden");
  });

  it("fits dialogs to the viewport minus 16px at 200% zoom", () => {
    expect(media(overlays, "(max-width: 760px)")).toContain("calc(100vw - 16px)");
  });
});

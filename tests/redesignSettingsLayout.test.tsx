import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import screensCss from "../src/styles/components/screens.css?raw";
import { button, click, renderApp, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>>;

beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("redesigned Settings layout", () => {
  it("uses a 216px sticky section nav beside a 640px content column", () => {
    expect(screensCss).toContain("grid-template-columns: 216px minmax(0, 640px)");
    expect(screensCss).toContain("position: sticky");
    expect(screensCss).toContain("max-width: 888px");
  });

  it("scrolls to named sections and switches to a section select at narrow width", async () => {
    app = await renderApp();
    await click(button("Settings"));
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const files = [...document.querySelectorAll<HTMLAnchorElement>(".settings-link")].find((link) => link.textContent === "Files & storage")!;
    await click(files);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(files.getAttribute("aria-current")).toBe("true");

    app.unmount();
    setupApp({ width: 820 });
    app = await renderApp();
    await click(button("Settings"));
    const sectionSelect = document.querySelector<HTMLSelectElement>("select[aria-label='Settings section']");
    expect(sectionSelect).toBeTruthy();
    expect(screensCss).toContain(".settings-section-select");
    await act(async () => {
      sectionSelect!.value = "about";
      sectionSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(sectionSelect?.value).toBe("about");
  });
});

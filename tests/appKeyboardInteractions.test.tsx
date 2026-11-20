import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, click, renderApp, setupApp } from "./helpers/renderApp";

let app: Awaited<ReturnType<typeof renderApp>>;

function key(key: string, options: KeyboardEventInit = {}) {
  const code = options.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...options });
  Object.defineProperty(event, "getModifierState", { value: (modifier: string) =>
    modifier === "Control" ? Boolean(options.ctrlKey)
      : modifier === "Meta" ? Boolean(options.metaKey)
        : modifier === "Shift" ? Boolean(options.shiftKey)
          : modifier === "Alt" ? Boolean(options.altKey) : false,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("App keyboard shortcuts", () => {
  it("keeps the original view shortcut hint when the palette filters", async () => {
    app = await renderApp();
    await act(async () => { document.querySelector<HTMLButtonElement>(".search-trigger")!.click(); });
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "settings");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(document.querySelector(".palette-item")?.textContent).toContain("Ctrl+5");
  });

  it("inspects palette file matches and sends See all results to Library with the same query", async () => {
    app = await renderApp();
    await act(async () => { document.querySelector<HTMLButtonElement>(".search-trigger")!.click(); });
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Lecture 4");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Files");
    const match = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes("Lecture 4"));
    expect(match).toBeTruthy();
    await click(match!);
    expect(document.querySelector("main h1")?.textContent).toBe("Library");
    expect(document.querySelector(".peek-title")?.textContent).toBe("Lecture 4");
    expect(appApi.openExternal).not.toHaveBeenCalled();
    expect(appApi.markRead).not.toHaveBeenCalled();
  });

  it("opens all palette matches in All files with the entered query", async () => {
    app = await renderApp();
    await act(async () => { document.querySelector<HTMLButtonElement>(".search-trigger")!.click(); });
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Lecture");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const all = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => /See all results/.test(item.textContent ?? ""));
    expect(all).toBeTruthy();
    await click(all!);
    expect(document.querySelector("main h1")?.textContent).toBe("Library");
    expect(document.querySelector<HTMLInputElement>('[aria-label="Search library"]')?.value).toBe("Lecture");
    expect(document.querySelector('[aria-label="All course files"]')).toBeTruthy();
  });

  it("keeps token-only palette queries scoped to matching files", async () => {
    app = await renderApp();
    await act(async () => { document.querySelector<HTMLButtonElement>(".search-trigger")!.click(); });
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "course:math");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].some((item) =>
      item.textContent?.includes("Lecture 4"))).toBe(true);
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].some((item) =>
      /See all results/.test(item.textContent ?? ""))).toBe(true);
  });

  it("uses Mod+comma for Settings and leaves bare comma alone", async () => {
    app = await renderApp();
    await act(async () => { key(","); });
    expect(document.querySelector("main h1")?.textContent).toBe("Inbox");

    await act(async () => { key(",", { code: "Comma", ctrlKey: true }); });
    expect(document.querySelector("main h1")?.textContent).toBe("Settings");
  });

  it("does not navigate or open the palette while editing text, except Mod+K", async () => {
    app = await renderApp();
    await click(button("Filter"));
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search Inbox"]')!;
    expect(document.activeElement?.getAttribute("aria-label")).toBe(search.getAttribute("aria-label"));
    await act(async () => { key("2", { ctrlKey: true }); });
    expect(document.querySelector("main h1")?.textContent).toBe("Inbox");
    await act(async () => { key("/", { code: "Slash", shiftKey: true }); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => { key("k", { ctrlKey: true }); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("guards textarea, select, contenteditable, composition, and extra modifiers", async () => {
    app = await renderApp();
    const main = document.querySelector("main")!;
    const editors: HTMLElement[] = [
      document.createElement("textarea"),
      document.createElement("select"),
      Object.assign(document.createElement("div"), { contentEditable: "true" }),
    ];
    editors.forEach((editor) => main.append(editor));

    for (const editor of editors) {
      editor.focus();
      await act(async () => { key("2", { ctrlKey: true }); });
      expect(document.querySelector("main h1")?.textContent).toBe("Inbox");
    }
    editors.forEach((editor) => editor.remove());

    await act(async () => { key("2", { ctrlKey: true, isComposing: true }); });
    await act(async () => { key("2", { ctrlKey: true, altKey: true }); });
    expect(document.querySelector("main h1")?.textContent).toBe("Inbox");
  });

  it("guards focusable descendants of contenteditable and ARIA editors", async () => {
    app = await renderApp();
    for (const attribute of ['contenteditable="true"', 'role="textbox"']) {
      const editor = document.createElement("div");
      editor.innerHTML = `<div ${attribute}><span tabindex="0">Editing</span></div>`;
      document.querySelector("main")!.append(editor);
      editor.querySelector<HTMLElement>("span")!.focus();
      await act(async () => { key("2", { ctrlKey: true }); });
      expect(document.querySelector("main h1")?.textContent).toBe("Inbox");
      await act(async () => { key("k", { ctrlKey: true, isComposing: true }); });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => { key("k", { ctrlKey: true }); });
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      await act(async () => { key("Escape"); });
      editor.remove();
    }
  });

  it("sends slash to the current view search, or opens the palette when none exists", async () => {
    app = await renderApp();
    await act(async () => { key("/", { code: "Slash", shiftKey: true }); });
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search Inbox"]')!;
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search Inbox");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    search.blur();
    await act(async () => { key("5", { ctrlKey: true }); });
    await act(async () => { key("/", { code: "Slash", shiftKey: true }); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("ignores navigation during IME composition and when another modifier is held", async () => {
    app = await renderApp();
    await act(async () => { key("2", { ctrlKey: true, isComposing: true }); });
    await act(async () => { key("2", { ctrlKey: true, altKey: true }); });
    expect(document.querySelector("main h1")?.textContent).toBe("Inbox");
  });

  it("keeps a modal palette in charge of navigation and Escape", async () => {
    app = await renderApp();
    await act(async () => { document.querySelector<HTMLButtonElement>(".search-trigger")!.click(); });
    await act(async () => { key("5", { ctrlKey: true }); });
    expect(document.querySelector("main h1")?.textContent).toBe("Inbox");
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { key("Escape"); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(appApi.openExternal).not.toHaveBeenCalled();
  });

  it("closes the active filter before closing the details surface", async () => {
    app = await renderApp();
    await click(button("Show details for Lecture 4"));
    await click(button("Filter"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search Inbox");
    await act(async () => { key("Escape"); });
    expect(document.querySelector('[role="search"][aria-label="Filter Inbox"]')).toBeNull();
    await act(async () => { key("Escape"); });
    expect(document.querySelector(".peek")).toBeNull();
  });
});

it("reapplies the same See all query after the Library query was edited", async () => {
  app = await renderApp();
  async function type(selector: string, value: string) {
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>(selector)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function seeAll() {
    await click(document.querySelector<HTMLButtonElement>(".search-trigger")!);
    await type(".palette-input", "Lecture");
    await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => /See all results|Search all files/.test(item.textContent ?? ""))!);
  }
  await seeAll();
  await type('[aria-label="Search library"]', "Different query");
  await seeAll();
  expect(document.querySelector<HTMLInputElement>('[aria-label="Search library"]')?.value).toBe("Lecture");
});

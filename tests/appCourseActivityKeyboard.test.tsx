import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, click, flushApp, renderApp, setupApp } from "./helpers/renderApp";
import type { ChangeEvent } from "../src/lib/types";
import { change, resource } from "./helpers/data";

let app: Awaited<ReturnType<typeof renderApp>> | undefined;
let inventory: ChangeEvent[] = [];

beforeEach(() => {
  setupApp();
  inventory = [change()];
  appApi.eventsRange.mockImplementation(async (_from, _to, _courseId, limit = 2000, offset = 0) =>
    inventory.slice(offset, offset + limit),
  );
  appApi.listResources.mockResolvedValue([resource()]);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
});

async function open(events: ChangeEvent[] = [change()]) {
  inventory = events;
  app = await renderApp();
  await click(button("Library"));
  await click(button("Open MATH F111 library"));
  await click(button("Activity"));
  await flushApp();
}

async function key(value: string, target: HTMLElement = document.activeElement as HTMLElement, options: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: value, code: value === " " ? "Space" : value.length === 1 ? `Key${value.toUpperCase()}` : value, bubbles: true, cancelable: true, ...options }));
  });
  await flushApp();
}

function row(title = "Lecture 4") {
  return button(`Show details for ${title}`);
}

function focus(title = "Lecture 4") {
  act(() => row(title).focus());
}

describe("Course Activity keyboard in the real App", () => {
  it("separates focus, selection and inspection without acknowledgement", async () => {
    await open([change(), change({ id: 2, title: "Sibling", resourceTitle: "Sibling" })]);
    focus();
    await key("x");
    await key("j");
    expect(document.activeElement).toBe(row("Sibling"));
    expect(row().closest(".resource-row")?.classList.contains("multi-selected")).toBe(true);
    expect(document.querySelector(".peek")).toBeNull();
    await key("Enter");
    expect(document.querySelector(".peek-title")?.textContent).toBe("Sibling");
  });

  it("captures selected event IDs and excludes baseline from E/U", async () => {
    await open([
      change({ id: 10, read: true }),
      change({ id: 11, resourceTitle: "Sibling" }),
      change({ id: 12, resourceId: null, resourceTitle: "Orphan" }),
      change({ id: 13, changeType: "baseline", resourceTitle: "Baseline" }),
    ]);
    focus();
    await key("x");
    focus("Orphan");
    await key("x");
    await key("u");
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 12], false);
    focus();
    await key("x");
    focus("Orphan");
    await key("x");
    focus("Baseline");
    await key("x");
    focus("Sibling");
    await key("e");
    expect(appApi.setEventReadState).toHaveBeenCalledTimes(1);
  });

  it("Shift+A captures all eligible events excluding baseline", async () => {
    await open(Array.from({ length: 5 }, (_, i) => change({ id: i + 1, resourceTitle: `Event ${i}`, changeType: i === 0 ? "baseline" : "new" })));
    focus("Event 0");
    await key("A", undefined, { shiftKey: true });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("4 recorded changes");
  });

  it("Delete confirms Inbox dismissal, Cancel returns identity", async () => {
    await open();
    focus();
    await key("Delete");
    expect(document.activeElement).toBe(button("Cancel"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("baseline are kept");
    await click(button("Cancel"));
    expect(document.activeElement).toBe(row());
    expect(appApi.dismissInboxEvents).not.toHaveBeenCalled();
    await key("Delete");
    await click(button("Dismiss captured changes"));
    expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([10]);
  });

  it("previews through the material action policy on Space", async () => {
    await open();
    focus();
    await key(" ");
    expect(appApi.previewResource).toHaveBeenCalledTimes(1);
  });

  it("ignores row actions on the inactive tab controls", async () => {
    await open();
    await key("e", button("Activity"));
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });
});
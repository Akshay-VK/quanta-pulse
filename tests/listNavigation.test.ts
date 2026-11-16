import { describe, expect, it } from "vitest";
import { getListNavigationIntent, recoverFocusedId, type ListNavigationInput } from "../src/lib/listNavigation";

const base: Omit<ListNavigationInput, "key"> = {
  ids: ["a", "b", "c"],
  focusedId: "b",
  inspectedId: "a",
  selectedIds: ["c"],
  activeSurface: true,
  editableTarget: false,
  nestedControl: false,
  modalOpen: false,
  isComposing: false,
  imeKeyCode229: false,
  repeat: false,
  defaultPrevented: false,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  completeEventIds: [11, 12],
};

function press(key: string, overrides: Partial<typeof base> = {}) {
  return getListNavigationIntent({ ...base, key, ...overrides });
}

describe("list navigation policy", () => {
  it.each([
    ["j", "c"],
    ["ArrowDown", "c"],
    ["k", "a"],
    ["ArrowUp", "a"],
  ])("moves focus with %s without inspecting or acknowledging", (key, id) => {
    expect(press(key)).toEqual({ type: "focus", id });
  });

  it("clamps movement at either boundary", () => {
    expect(press("j", { focusedId: "c" })).toEqual({ type: "focus", id: "c" });
    expect(press("k", { focusedId: "a" })).toEqual({ type: "focus", id: "a" });
  });

  it("starts at the nearest list edge when focus is missing", () => {
    expect(press("j", { focusedId: null })).toEqual({ type: "focus", id: "a" });
    expect(press("k", { focusedId: null })).toEqual({ type: "focus", id: "c" });
  });

  it("returns no intent for an empty list", () => {
    expect(press("j", { ids: [], focusedId: null })).toBeNull();
  });

  it("keeps inspect, multi-select, read-state, delete, and preview as distinct intents", () => {
    expect(press("Enter")).toEqual({ type: "inspect", id: "b" });
    expect(press("x")).toEqual({ type: "toggleSelection", id: "b" });
    expect(press("e")).toEqual({ type: "setReadState", ids: ["c"], isRead: true });
    expect(press("u")).toEqual({ type: "setReadState", ids: ["c"], isRead: false });
    expect(press("Delete")).toEqual({ type: "confirmDelete", ids: ["c"] });
    expect(press(" ")).toEqual({ type: "preview", id: "b" });
  });

  it("uses the focused row for bulk intents when selection is empty", () => {
    expect(press("e", { selectedIds: [] })).toEqual({ type: "setReadState", ids: ["b"], isRead: true });
  });

  it("captures a copied authoritative complete event ID list for Shift+A", () => {
    const completeEventIds = [11, 12];
    const intent = press("a", { shiftKey: true, completeEventIds });
    completeEventIds.push(13);
    expect(intent).toEqual({ type: "openCapturedScope", eventIds: [11, 12] });
    if (intent?.type === "openCapturedScope") {
      expect(Object.isFrozen(intent.eventIds)).toBe(true);
      expect(() => (intent.eventIds as number[]).push(14)).toThrow();
    }
  });

  it.each([
    ["inactive", { activeSurface: false }],
    ["editable", { editableTarget: true }],
    ["nested control", { nestedControl: true }],
    ["modal", { modalOpen: true }],
    ["composition", { isComposing: true }],
    ["legacy IME", { imeKeyCode229: true }],
    ["repeat", { repeat: true }],
    ["prevented", { defaultPrevented: true }],
  ])("suppresses keys for %s state", (_label, overrides) => {
    expect(press("j", overrides)).toBeNull();
    expect(press("Enter", overrides)).toBeNull();
  });

  it("allows only Shift+A with Shift and suppresses other modifier combinations", () => {
    expect(press("j", { shiftKey: true })).toBeNull();
    expect(press("e", { ctrlKey: true })).toBeNull();
    expect(press("a", { shiftKey: true, metaKey: true })).toBeNull();
    expect(press("a", { shiftKey: true })).toMatchObject({ type: "openCapturedScope" });
  });

  it("recovers focus by stable identity after filtering or removal", () => {
    expect(recoverFocusedId(["a", "b", "c", "d"], ["a", "c", "d"], "b")).toBe("c");
    expect(recoverFocusedId(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
    expect(recoverFocusedId(["a", "b", "c"], ["a", "b"], "c")).toBe("b");
    expect(recoverFocusedId(["a", "b"], [], "b")).toBeNull();
    expect(recoverFocusedId(["a", "b"], ["x"], "b")).toBe("x");
  });
});

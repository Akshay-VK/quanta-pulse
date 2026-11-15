import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import ConfirmDialog from "../src/components/ConfirmDialog";
import { Dialog } from "../src/components/ui/Dialog";
import { Menu } from "../src/components/ui/Menu";
import { Toaster } from "../src/components/ui/Toast";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

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
  vi.useRealTimers();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

describe("redesign shared overlays", () => {
  it("focuses a dialog primary action, traps focus, closes on Escape and restores focus", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open</button><Dialog open={open} onOpenChange={setOpen} label="Example"><button data-dialog-primary>Save</button><button>Cancel</button></Dialog></>;
    }
    await render(<Harness />);
    const trigger = container.querySelector("button")!;
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const buttons = dialog.querySelectorAll("button");
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[1].focus());
    expect(document.activeElement).toBe(buttons[1]);
    await act(async () => buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await act(async () => {});
    expect(document.activeElement).toBe(trigger);
  });

  it("starts destructive confirmation on Cancel", async () => {
    await render(<ConfirmDialog open onOpenChange={() => {}} title="Delete?" body="This is permanent." confirmLabel="Delete" destructive onConfirm={() => {}} />);
    expect(document.activeElement?.textContent).toContain("Cancel");
  });

  it("opens a menu with keyboard navigation and returns focus when dismissed", async () => {
    await render(<Menu label="Actions" trigger={<button>Actions</button>} items={[{ id: "one", label: "First" }, { id: "two", label: "Second" }]} />);
    const trigger = container.querySelector("button")!;
    trigger.focus();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    await act(async () => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("exposes an accessible toast action", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onUndo = vi.fn();
    await render(<Toaster toasts={[{ id: 1, message: "Marked as read", action: { label: "Undo", onClick: onUndo } }]} onDismiss={onDismiss} />);
    const toast = document.querySelector('[role="status"]')!;
    expect(toast).toBeTruthy();
    const undo = [...document.querySelectorAll("button")].find((button) => button.textContent === "Undo")!;
    expect(undo).toBeTruthy();
    expect(undo.textContent).toBe("Undo");
    await act(async () => undo.click());
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("pauses toast timeout while focused and dismisses after six seconds of active time", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(<Toaster toasts={[{ id: 2, message: "Saved" }]} onDismiss={onDismiss} />);
    const toast = document.querySelector('[role="status"]') as HTMLElement;
    toast.focus();
    await act(async () => vi.advanceTimersByTime(7000));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => toast.blur());
    await act(async () => vi.advanceTimersByTime(6200));
    expect(onDismiss).toHaveBeenCalledWith(2);
  });

  it("keeps a direct dismiss control available on an error toast", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(<Toaster toasts={[{ id: 9, message: "Couldn't refresh", error: true, action: { label: "Retry", onClick: () => {} } }]} onDismiss={onDismiss} />);
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Retry")).toBe(true);
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click());
    await act(async () => vi.advanceTimersByTime(150));
    expect(onDismiss).toHaveBeenCalledWith(9);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ClearActivityButton from "../src/components/ClearActivityButton";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
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
  vi.restoreAllMocks();
});

async function render(scope: "Dashboard" | "History", onConfirm = vi.fn<() => Promise<void>>()) {
  await act(async () => {
    root.render(<ClearActivityButton scope={scope} onConfirm={onConfirm} />);
  });
  return onConfirm;
}

function triggerButton(): HTMLButtonElement {
  return container.querySelector("button") as HTMLButtonElement;
}

function dialogConfirm(): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  return [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Clear activity" || button.textContent === "Clear history") as HTMLButtonElement;
}

describe("ClearActivityButton", () => {
  it("does not clear Dashboard activity when confirmation is cancelled", async () => {
    const onConfirm = await render("Dashboard");
    expect(triggerButton().textContent).toBe("Clear activity");
    await act(async () => triggerButton().click());
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Course resources and History will remain unchanged");
    await act(async () => {
      [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Cancel")?.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("confirms and clears History while explaining that resources are retained", async () => {
    const onConfirm = await render("History");
    expect(triggerButton().textContent).toBe("Clear history");
    await act(async () => triggerButton().click());
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("does not delete Quanta files or resources");
    await act(async () => {
      dialogConfirm().click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("prevents duplicate clears and leaves a retryable error in the dialog", async () => {
    const onConfirm = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("storage unavailable"));
    await render("History", onConfirm);
    await act(async () => triggerButton().click());
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Clear history") as HTMLButtonElement;
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("storage unavailable");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});

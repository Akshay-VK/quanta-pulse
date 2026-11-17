import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SessionRefreshBanner from "../src/components/SessionRefreshBanner";
import type { SessionResetResult } from "../src/lib/types";

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
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render(
  onRestart: () => Promise<SessionResetResult>,
  sessionExpired = false,
  onCancel?: () => void,
) {
  await act(async () => {
    root.render(
      <SessionRefreshBanner
        sessionExpired={sessionExpired}
        onRestart={onRestart}
        onCancel={onCancel}
      />,
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return ([...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined) ?? null;
}

describe("SessionRefreshBanner", () => {
  it("distinguishes connected and expired sessions", async () => {
    const onRestart = vi.fn().mockResolvedValue({ status: "login_required", message: "Sign in again." });
    await render(onRestart);
    expect(container.querySelector("button")).toBeNull();

    await act(async () => root.render(<SessionRefreshBanner sessionExpired onRestart={onRestart} />));
    expect(container.textContent).toContain("Session expired. Sign in again to keep monitoring.");
    expect(button("Reconnect")).toBeTruthy();
  });

  it("starts a single reset and shows reconnecting with cancel", async () => {
    let resolve!: (value: SessionResetResult) => void;
    const onRestart = vi.fn(() => new Promise<SessionResetResult>((done) => { resolve = done; }));
    await render(onRestart, true);
    await act(async () => {
      button("Reconnect")?.click();
      button("Reconnect")?.click();
    });
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Waiting for sign-in…");
    expect(button("Cancel")).toBeTruthy();

    await act(async () => resolve({ status: "connected", message: "Quanta access was verified." }));
    expect(container.textContent).toContain("Reconnected. Monitoring resumed.");
  });

  it("auto-dismisses success after 4s", async () => {
    const onRestart = vi.fn().mockResolvedValue({ status: "connected", message: "ok" });
    await render(onRestart, true);
    await act(async () => { button("Reconnect")?.click(); });
    expect(container.textContent).toContain("Reconnected. Monitoring resumed.");
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(container.textContent ?? "").not.toContain("Reconnected. Monitoring resumed.");
  });

  it("cancel transitions to failed with retry and dismiss", async () => {
    const onCancel = vi.fn();
    let resolve!: (value: SessionResetResult) => void;
    const onRestart = vi.fn(() => new Promise<SessionResetResult>((done) => { resolve = done; }));
    await render(onRestart, true, onCancel);
    await act(async () => { button("Reconnect")?.click(); });
    await act(async () => { button("Cancel")?.click(); });
    expect(onCancel).toHaveBeenCalled();
    expect(container.textContent).toContain("Couldn't reconnect.");
    expect(button("Try again")).toBeTruthy();
    expect(button("Dismiss")).toBeTruthy();
    // late resolution does not revive success
    await act(async () => resolve({ status: "connected", message: "late" }));
    expect(container.textContent).toContain("Couldn't reconnect.");
  });

  it("shows a retryable connection failure", async () => {
    const onRestart = vi.fn().mockRejectedValue(new Error("cookie store unavailable"));
    await render(onRestart, true);
    await act(async () => button("Reconnect")?.click());
    expect(container.textContent).toContain("Couldn't reconnect.");
    expect(container.textContent).toContain("cookie store unavailable");
    expect(button("Try again")?.disabled).toBe(false);
  });

  it("dismiss hides failed banner", async () => {
    const onRestart = vi.fn().mockResolvedValue({ status: "failed", message: "nope" });
    await render(onRestart, true);
    await act(async () => button("Reconnect")?.click());
    expect(container.textContent).toContain("Couldn't reconnect.");
    await act(async () => button("Dismiss")?.click());
    expect(container.textContent ?? "").not.toContain("Couldn't reconnect.");
  });

  it("keeps no banner UI when session is not expired", async () => {
    const onRestart = vi.fn();
    await render(onRestart, false);
    expect(container.textContent ?? "").not.toContain("Session expired");
    expect(button("Reconnect")).toBeNull();
  });
});

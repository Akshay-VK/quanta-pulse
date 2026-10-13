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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  onRestart: () => Promise<SessionResetResult>,
  sessionExpired = false,
) {
  await act(async () => {
    root.render(<SessionRefreshBanner sessionExpired={sessionExpired} onRestart={onRestart} />);
  });
}

function restartButton(): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Restart Quanta Session") as HTMLButtonElement;
}

describe("SessionRefreshBanner", () => {
  it("distinguishes connected and expired sessions", async () => {
    const onRestart = vi.fn().mockResolvedValue({ status: "login_required", message: "Sign in again." });
    await render(onRestart);
    expect(container.textContent).toContain("Connected");
    expect(container.querySelector("button")).toBeNull();

    await act(async () => root.render(<SessionRefreshBanner sessionExpired onRestart={onRestart} />));
    expect(container.textContent).toContain("Session Expired");
    expect(restartButton()).toBeTruthy();
  });

  it("starts a single reset and keeps progress visible until it finishes", async () => {
    let resolve!: (value: SessionResetResult) => void;
    const onRestart = vi.fn(() => new Promise<SessionResetResult>((done) => { resolve = done; }));
    await render(onRestart, true);
    await act(async () => {
      restartButton().click();
      restartButton().click();
    });
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Resetting Session");
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => resolve({ status: "connected", message: "Quanta verified." }));
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("Quanta verified.");
  });

  it("leaves cancelled authentication in Login Required with a retry action", async () => {
    const onRestart = vi.fn().mockResolvedValue({ status: "login_required", message: "Sign-in was cancelled." });
    await render(onRestart, true);
    await act(async () => restartButton().click());
    expect(container.textContent).toContain("Login Required");
    expect(container.textContent).toContain("Sign-in was cancelled.");
    expect(restartButton()).toBeTruthy();
  });

  it("shows a retryable connection failure and recovers from rejected commands", async () => {
    const onRestart = vi.fn().mockRejectedValue(new Error("cookie store unavailable"));
    await render(onRestart, true);
    await act(async () => restartButton().click());
    expect(container.textContent).toContain("Connection Failed");
    expect(container.textContent).toContain("cookie store unavailable");
    expect(restartButton().disabled).toBe(false);
  });
});

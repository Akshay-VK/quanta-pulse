import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import LoginScreen from "../src/components/LoginScreen";
import type { AuthStatus } from "../src/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const login = vi.fn();
const startSsoLogin = vi.fn();
const focusSsoLogin = vi.fn();
const cancelSsoLogin = vi.fn();
const authStatus = vi.fn();

vi.mock("../src/lib/api", () => ({
  api: {
    login: (...args: unknown[]) => login(...args),
    startSsoLogin: (...args: unknown[]) => startSsoLogin(...args),
    focusSsoLogin: (...args: unknown[]) => focusSsoLogin(...args),
    cancelSsoLogin: (...args: unknown[]) => cancelSsoLogin(...args),
    authStatus: (...args: unknown[]) => authStatus(...args),
  },
}));

function okAuth(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    authenticated: true,
    attemptId: null,
    email: "f20230001@pilani.bits-pilani.ac.in",
    fullName: "Test User",
    method: "password",
    acquiredAt: "2026-10-14T10:00:00Z",
    sessionExpired: false,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  login.mockReset();
  startSsoLogin.mockReset();
  focusSsoLogin.mockReset();
  cancelSsoLogin.mockReset();
  authStatus.mockReset();
  authStatus.mockResolvedValue(okAuth({ authenticated: false }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

async function render(ui: React.ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

function text() {
  return container.textContent ?? "";
}

function button(needle: string | RegExp) {
  const el = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    typeof needle === "string" ? b.textContent?.includes(needle) : needle.test(b.textContent ?? ""),
  );
  if (!el) throw new Error(`missing button: ${needle}\n${text()}`);
  return el;
}

describe("Auth card states", () => {
  it("shows sign-in form state", async () => {
    await render(<LoginScreen onAuthenticated={vi.fn()} />);
    expect(text()).toContain("Sign in");
    expect(container.querySelector('input[autocomplete="username"], input[type="text"]')).toBeTruthy();
    expect(container.querySelector('input[type="password"]')).toBeTruthy();
    expect(text()).toMatch(/BITS SSO|Continue with BITS/i);
  });

  it("shows inline failure with danger banner and password danger border; try again and SSO alternative", async () => {
    login.mockRejectedValue(new Error("Quanta rejected the username or password."));
    await render(<LoginScreen onAuthenticated={vi.fn()} />);
    const user = container.querySelector<HTMLInputElement>('input[autocomplete="username"], input[type="text"]')!;
    const pass = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(user, "u");
      user.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(pass, "p");
      pass.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/sign in|couldn/i);
    expect(text()).toMatch(/Quanta rejected|username or password|rejected/i);
    // danger border on password field
    const passField = container.querySelector('input[type="password"]') as HTMLElement | null;
    expect(passField?.getAttribute("aria-invalid") === "true" || passField?.className.includes("danger") || passField?.className.includes("error") || passField?.style.borderColor).toBeTruthy();
    expect(text()).toMatch(/Try again|Sign in/i);
    expect(text()).toMatch(/BITS SSO instead|Use BITS SSO/i);
  });

  it("pending SSO shows reopen and cancel, preserves awaiting-completion promise and uses focus/cancel APIs", async () => {
    let resolveSso!: (v: AuthStatus) => void;
    startSsoLogin.mockReturnValue(new Promise<AuthStatus>((res) => { resolveSso = res; }));
    // attempt becomes available after start
    authStatus.mockResolvedValue(okAuth({ authenticated: false, attemptId: "att-1" }));
    const onAuthenticated = vi.fn();
    await render(<LoginScreen onAuthenticated={onAuthenticated} />);
    await act(async () => { button(/BITS SSO|Continue with BITS/i).click(); });
    // allow polling tick
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(text()).toMatch(/Waiting for your browser|Waiting for BITS SSO/i);
    const reopen = button(/Open browser again|Reopen/i);
    const cancel = button(/^Cancel$/i);
    await act(async () => { reopen.click(); });
    expect(focusSsoLogin).toHaveBeenCalledWith("att-1");
    await act(async () => { cancel.click(); });
    expect(cancelSsoLogin).toHaveBeenCalledWith("att-1");
    // promise still awaited: resolving it completes auth
    await act(async () => { resolveSso(okAuth({ method: "sso" })); });
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it("first scan running shows 4 steps and background continues scan (not fake completion)", async () => {
    const onBackground = vi.fn();
    await render(
      <LoginScreen
        onAuthenticated={vi.fn()}
        onboarding={{
          state: "scanning",
          progress: 0.58,
          coursesFound: 3,
          materialsRecorded: 214,
          materialsTotal: 360,
          onBackground,
        }}
      />,
    );
    expect(text()).toMatch(/Setting up your workspace|first scan|Recording/i);
    expect(text()).toMatch(/Signed in/i);
    expect(text()).toMatch(/Discovering courses/i);
    expect(text()).toMatch(/Recording existing material/i);
    expect(text()).toMatch(/Saving the baseline/i);
    expect(text()).toMatch(/3/);
    await act(async () => { button(/Keep running in background/i).click(); });
    expect(onBackground).toHaveBeenCalledTimes(1);
    // still scanning state shown nowhere as "complete"
    expect(text()).not.toMatch(/Baseline recorded/i);
  });

  it("baseline completion shows stats, exact explanation, new=0 and destinations", async () => {
    const onOpenLibrary = vi.fn();
    const onGoInbox = vi.fn();
    await render(
      <LoginScreen
        onAuthenticated={vi.fn()}
        onboarding={{
          state: "complete",
          courses: 3,
          materials: 361,
          newCount: 0,
          onOpenLibrary,
          onGoInbox,
        }}
      />,
    );
    expect(text()).toMatch(/Baseline recorded/i);
    expect(text()).toContain("Everything already on Quanta is saved as your starting point. From now on, only new changes reach your Inbox.");
    expect(text()).toMatch(/courses/i);
    expect(text()).toMatch(/materials/i);
    expect(text()).toContain("3");
    expect(text()).toContain("361");
    expect(text()).toContain("0");
    expect(text()).toMatch(/\bnew\b/i);
    await act(async () => { button(/Open Library/i).click(); });
    expect(onOpenLibrary).toHaveBeenCalled();
    await act(async () => { button(/Go to Inbox/i).click(); });
    expect(onGoInbox).toHaveBeenCalled();
  });
});

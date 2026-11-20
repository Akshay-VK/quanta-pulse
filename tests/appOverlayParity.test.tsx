import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appApi, button, click, deferred, emitAppEvent, renderApp, setupApp } from "./helpers/renderApp";
import type { ScanRun, SessionResetResult } from "../src/lib/types";

let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());

describe("overlay parity through the App", () => {
  it("shows the same auth card through the first baseline scan and opens Library after completion", async () => {
    const signedIn = await appApi.authStatus();
    if (!signedIn) throw new Error("Missing default auth fixture");
    const fresh = { path: "/local/pulse.db", logDir: null, sizeBytes: 0, courseCount: 0, resourceCount: 0, eventCount: 0 };
    appApi.authStatus.mockResolvedValue({ ...signedIn, authenticated: false, email: null });
    appApi.dbInfo.mockResolvedValue(fresh);
    appApi.startSsoLogin.mockImplementation(async () => {
      appApi.authStatus.mockResolvedValue(signedIn);
      return signedIn;
    });
    app = await renderApp();
    await click(button("Continue with BITS SSO"));
    expect(document.querySelector(".login-title")?.textContent).toBe("Setting up your workspace");

    const baseline: ScanRun = {
      id: 7, startedAt: "2026-11-14T09:00:00Z", completedAt: "2026-11-14T09:01:00Z",
      status: "ok", discoveredCount: 12, newCount: 0, updatedCount: 0, unavailableCount: 0,
      coursesScanned: 1, coursesFailed: 0, errorSummary: null, isBaseline: true,
    };
    appApi.listHistoryScans.mockResolvedValue([baseline]);
    appApi.dbInfo.mockResolvedValue({ ...fresh, courseCount: 1, resourceCount: 12 });
    await emitAppEvent("sync:done", { cancelled: false, authExpired: false, errors: [] });
    expect(document.querySelector(".login-title")?.textContent).toBe("Baseline recorded");
    expect(document.querySelector(".login-card")?.textContent).toContain("12materials");
    await click(button("Open Library"));
    expect(document.querySelector("main h1")?.textContent).toBe("Library");
  });

  it("keeps reconnection state when navigating away from Inbox", async () => {
    const connected = await appApi.authStatus();
    const idle = await appApi.syncStatus();
    if (!connected || !idle) throw new Error("Missing default auth fixture");
    appApi.authStatus.mockResolvedValue({ ...connected, sessionExpired: true });
    appApi.syncStatus.mockResolvedValue({ ...idle, authState: "expired" });
    const restart = deferred<SessionResetResult>();
    appApi.restartQuantaSession.mockReturnValue(restart.promise);
    app = await renderApp();
    await click(button("Reconnect"));
    expect(document.querySelector(".session-recovery-banner")?.textContent).toContain("Waiting for sign-in in your browser");
    await click(button("Calendar"));
    expect(document.querySelector(".session-recovery-banner")?.textContent).toContain("Waiting for sign-in in your browser");
    appApi.authStatus.mockResolvedValue(connected);
    appApi.syncStatus.mockResolvedValue(idle);
    await act(async () => restart.resolve({ status: "connected", message: "Logged in." }));
    expect(document.querySelector(".session-recovery-banner")?.textContent).toContain("Reconnected.");
  });
});

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { TextField } from "./ui/TextField";
import { PasswordField } from "./ui/PasswordField";
import type { AuthStatus } from "../lib/types";

export interface OnboardingScan {
  state: "scanning";
  progress?: number; // 0..1
  coursesFound?: number;
  materialsRecorded?: number;
  materialsTotal?: number;
  onBackground?: () => void;
}

export interface OnboardingComplete {
  state: "complete";
  courses: number;
  materials: number;
  newCount: number;
  onOpenLibrary?: () => void;
  onGoInbox?: () => void;
}

export type OnboardingState = OnboardingScan | OnboardingComplete;

interface Props {
  onAuthenticated: (status: AuthStatus) => void;
  onCancel?: () => void;
  /** First-run baseline scan states shown on the same auth card (spec §5.1). */
  onboarding?: OnboardingState | null;
}

type AuthPhase = "idle" | "loading" | "sso" | "success" | "error";

export default function LoginScreen({ onAuthenticated, onCancel, onboarding }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<AuthPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [ssoAttemptId, setSsoAttemptId] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const ssoPromiseRef = useRef<Promise<AuthStatus> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Discover SSO attempt id while the start_sso_login promise is in-flight so
  // reopen/cancel controls can target the live window without abandoning the
  // awaiting-completion promise.
  useEffect(() => {
    if (phase !== "sso") return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const status = await api.authStatus();
        if (!cancelled && mountedRef.current && status.attemptId) {
          setSsoAttemptId(status.attemptId);
        }
      } catch {
        // best effort; keep polling while pending
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 300);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase]);

  const busy = phase === "loading" || phase === "sso";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPhase("loading");
    setMessage(null);
    try {
      const status = await api.login(email, password);
      if (!mountedRef.current) return;
      setPassword("");
      setPhase("success");
      onAuthenticated(status);
    } catch (err) {
      if (!mountedRef.current) return;
      setPassword("");
      setPhase("error");
      setMessage(String(err));
    }
  }

  async function startSso() {
    setPhase("sso");
    setMessage(null);
    setSsoAttemptId(null);
    const promise = api.startSsoLogin();
    ssoPromiseRef.current = promise;
    try {
      const status = await promise;
      if (!mountedRef.current) return;
      ssoPromiseRef.current = null;
      setPhase("success");
      onAuthenticated(status);
    } catch (err) {
      if (!mountedRef.current) return;
      ssoPromiseRef.current = null;
      setSsoAttemptId(null);
      setPhase("error");
      setMessage(String(err));
    }
  }

  async function reopenSso() {
    if (!ssoAttemptId) return;
    try {
      await api.focusSsoLogin(ssoAttemptId);
    } catch {
      // window may be unavailable; user can cancel/retry
    }
  }

  async function cancelSso() {
    if (ssoAttemptId) {
      try {
        await api.cancelSsoLogin(ssoAttemptId);
      } catch {
        // start promise will settle with the backend outcome
      }
    }
    // Keep awaiting the original start_sso_login promise (preserved above).
  }

  // First-run onboarding states take over the same centered card after auth.
  if (onboarding?.state === "scanning") {
    return (
      <div className="login-wrap">
        <div className="login-card" aria-live="polite">
          <Brand />
          <h1 className="login-title">Setting up your workspace</h1>
          <p className="login-copy">
            Pulse is recording what already exists on Quanta so only future changes show up as new.
          </p>
          <ScanProgress onboarding={onboarding} />
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            <Button
              variant="ghost"
              size="lg"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => onboarding.onBackground?.()}
            >
              Keep running in background
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (onboarding?.state === "complete") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <Brand />
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "color-mix(in srgb, var(--ok) 14%, transparent)",
              display: "grid",
              placeItems: "center",
              marginBottom: 14,
              color: "var(--ok)",
              fontWeight: 700,
            }}
          >
            ✓
          </div>
          <h1 className="login-title">Baseline recorded</h1>
          <p className="login-copy">
            Everything already on Quanta is saved as your starting point. From now on, only new changes reach your Inbox.
          </p>
          <div style={{ display: "flex", gap: 10, margin: "18px 0" }}>
            <Stat label="courses" value={onboarding.courses} />
            <Stat label="materials" value={onboarding.materials} />
            <Stat label="new" value={onboarding.newCount} />
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <Button variant="primary" size="lg" style={{ width: "100%", justifyContent: "center" }} onClick={() => onboarding.onOpenLibrary?.()}>
              Open Library
            </Button>
            <Button variant="ghost" size="lg" style={{ width: "100%", justifyContent: "center" }} onClick={() => onboarding.onGoInbox?.()}>
              Go to Inbox
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const signInError = phase === "error" && !!message;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Brand />
        <h1 className="login-title">Sign in</h1>
        <p className="login-copy">Use your BITS account to start monitoring Quanta.</p>

        {phase === "sso" ? (
          <>
            <div style={{ textAlign: "center", marginTop: 10 }}>
              <div
                className="spinner"
                aria-hidden="true"
                style={{ width: 40, height: 40, margin: "0 auto 18px" }}
              />
              <h2 className="login-title" style={{ fontSize: 18 }}>Waiting for your browser</h2>
              <p className="login-copy">
                Finish signing in with BITS SSO in the window that just opened. Pulse continues automatically.
              </p>
            </div>
            <Button
              size="lg"
              variant="secondary"
              style={{ width: "100%", justifyContent: "center", marginTop: 20 }}
              onClick={() => void reopenSso()}
            >
              Open browser again
            </Button>
            <Button
              size="lg"
              variant="ghost"
              style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
              onClick={() => void cancelSso()}
            >
              Cancel
            </Button>
            <p className="login-copy" style={{ marginTop: "auto", paddingTop: 16 }}>
              Closed the tab by mistake? Cancel and start again.
            </p>
          </>
        ) : (
          <>
            {signInError && (
              <Banner kind="error">
                <strong>Couldn’t sign in.</strong>
                <div>{message}</div>
              </Banner>
            )}
            {phase === "success" && (
              <Banner kind="ok">Signed in. Discovering your courses…</Banner>
            )}

            {phase !== "error" && (
              <>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => void startSso()}
                  disabled={busy}
                  style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
                >
                  Continue with BITS SSO
                </Button>
                <div className="login-sep">or use your credentials</div>
              </>
            )}

            <form onSubmit={submit} className="login-fields">
              <TextField
                label="Username"
                lg
                inputRef={usernameRef}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                disabled={busy}
                required
              />
              <PasswordField
                label="Password"
                lg
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
                aria-invalid={signInError || undefined}
                style={signInError ? { borderColor: "var(--danger)" } : undefined}
              />
              <Button type="submit" variant="primary" size="lg" loading={phase === "loading"} disabled={busy} style={{ width: "100%" }}>
                {phase === "loading" ? "Signing in" : signInError ? "Try again" : "Sign in"}
              </Button>
              {signInError && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => void startSso()}
                  disabled={busy}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Use BITS SSO instead
                </Button>
              )}
            </form>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
              {onCancel && (
                <button type="button" className="settings-link" onClick={onCancel}>
                  Cancel
                </button>
              )}
            </div>

            <p className="login-copy" style={{ marginTop: "auto", paddingTop: 16 }}>
              Credentials stay on this device
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="login-brand" aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          background: "var(--accent)",
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          color: "#fff",
          fontWeight: 700,
        }}
      >
        P
      </span>
      <b style={{ fontWeight: 600 }}>Pulse</b>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
      <b style={{ fontSize: 18, fontWeight: 600 }}>{value}</b>
      <div className="m" style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function ScanProgress({ onboarding }: { onboarding: OnboardingScan }) {
  const pct = Math.max(0, Math.min(1, onboarding.progress ?? 0));
  const discovered = typeof onboarding.coursesFound === "number";
  const recording = typeof onboarding.materialsRecorded === "number";
  const totalKnown = typeof onboarding.materialsTotal === "number";
  // Derive 4 steps: signed in (done), discovering (done when courses known, active otherwise),
  // recording (active once discovered), saving (pending until completion state handed off).
  const discoverDone = discovered;
  const recordingActive = discoverDone;
  const discoverMeta = discovered ? `${onboarding.coursesFound} found` : "";
  const recordMeta = recording
    ? `${onboarding.materialsRecorded}${totalKnown ? ` / ~${onboarding.materialsTotal}` : ""}`
    : "";
  return (
    <div>
      <div style={{ height: 4, borderRadius: 2, background: "var(--line)", margin: "18px 0 12px" }} aria-hidden="true">
        <i style={{ display: "block", width: `${pct * 100}%`, height: 4, borderRadius: 2, background: "var(--accent)" }} />
      </div>
      <Step done label="Signed in" />
      <Step done={discoverDone} active={!discoverDone} label="Discovering courses" meta={discoverMeta} />
      <Step active={recordingActive} label="Recording existing material" meta={recordMeta} spinner={recordingActive} />
      <Step label="Saving the baseline" pending={!recordingActive} />
    </div>
  );
}

function Step({
  label,
  meta,
  done,
  active,
  pending,
  spinner,
}: {
  label: string;
  meta?: string;
  done?: boolean;
  active?: boolean;
  pending?: boolean;
  spinner?: boolean;
}) {
  const color = pending ? "var(--muted)" : "var(--ink)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 30 }}>
      {done ? (
        <span aria-hidden="true" style={{ width: 16, color: "var(--ok)", fontWeight: 700 }}>✓</span>
      ) : spinner || active ? (
        <span className="spinner" aria-hidden="true" style={{ width: 16, height: 16 }} />
      ) : (
        <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--line-strong)", display: "inline-block" }} />
      )}
      <span style={{ flex: 1, color }}>{label}</span>
      {meta ? <span className="m" style={{ fontSize: 11, color: "var(--muted)" }}>{meta}</span> : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import type { SessionResetResult } from "../lib/types";

interface Props {
  sessionExpired: boolean;
  onRestart: () => Promise<SessionResetResult>;
  onSignInAgain?: () => void;
  /** Abort an in-flight SSO window. Omitted in tests that only assert UI. */
  onCancel?: () => void | Promise<void>;
  /** Called when the user dismisses a terminal banner. */
  onDismiss?: () => void;
}

type State = "connected" | "expired" | "reconnecting" | "succeeded" | "failed";

const RECONNECTING_MESSAGE = "Waiting for sign-in…";
const SUCCEEDED_MESSAGE = "Reconnected. Monitoring resumed.";
const FAILED_MESSAGE = "Couldn't reconnect.";
const FAILED_DETAIL = "Sign-in was cancelled or failed.";

export default function SessionRefreshBanner({
  sessionExpired,
  onRestart,
  onSignInAgain,
  onCancel,
  onDismiss,
}: Props) {
  const [state, setState] = useState<State>(sessionExpired ? "expired" : "connected");
  const [detail, setDetail] = useState("");
  const request = useRef(false);
  const cancelled = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sessionExpired) {
      if (state === "connected") {
        setState("expired");
        setDetail("");
      }
    } else if (
      state === "expired" ||
      state === "reconnecting" ||
      state === "failed"
    ) {
      // Only settle back to connected when the backend agrees the session
      // is healthy again; a succeeded banner keeps its own 4s timer.
      setState("connected");
      setDetail("");
    }
  }, [sessionExpired]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function restart() {
    if (request.current) return;
    request.current = true;
    cancelled.current = false;
    setState("reconnecting");
    setDetail("");
    try {
      const result = await onRestart();
      if (cancelled.current) {
        setState("failed");
        setDetail(FAILED_DETAIL);
        return;
      }
      if (result.status === "connected") {
        setState("succeeded");
        setDetail(result.message || "");
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setState("connected");
          setDetail("");
        }, 4000);
      } else {
        setState("failed");
        setDetail(result.message || FAILED_DETAIL);
      }
    } catch (error) {
      if (cancelled.current) {
        setState("failed");
        setDetail(FAILED_DETAIL);
        return;
      }
      setState("failed");
      setDetail(String(error));
    } finally {
      request.current = false;
    }
  }

  async function cancel() {
    if (!request.current) return;
    cancelled.current = true;
    request.current = false;
    try {
      await onCancel?.();
    } catch {
      // Cancel is best-effort; the banner still reports failure.
    }
    setState("failed");
    setDetail(FAILED_DETAIL);
  }

  function dismiss() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setState("connected");
    setDetail("");
    onDismiss?.();
  }

  if (state === "connected") return null;

  if (state === "expired") {
    return (
      <Banner
        kind="error"
        action={{ label: "Reconnect", onClick: () => void restart() }}
      >
        <strong>Session expired.</strong> Sign in again to keep monitoring.
      </Banner>
    );
  }

  if (state === "reconnecting") {
    return (
      <Banner kind="info" action={{ label: "Cancel", onClick: () => void cancel() }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="spinner" aria-hidden="true" />
          <strong>{RECONNECTING_MESSAGE}</strong>
        </span>
        <div>Complete sign-in in the Quanta window. Close that window to cancel. Your saved files remain available.</div>
      </Banner>
    );
  }

  if (state === "succeeded") {
    return (
      <Banner kind="ok" action={{ label: "Dismiss", onClick: dismiss }}>
        <strong>Reconnected.</strong> Monitoring resumed.
        {detail && detail !== SUCCEEDED_MESSAGE && <div>{detail}</div>}
      </Banner>
    );
  }

  // failed
  return (
    <Banner
      kind="error"
      action={{ label: "Try again", onClick: () => void restart() }}
    >
      <strong>{FAILED_MESSAGE}</strong>
      {detail && <div>{detail}</div>}
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
      {onSignInAgain && (
        <div style={{ marginTop: 8 }}>
          <Button variant="ghost" size="sm" onClick={onSignInAgain}>
            Sign in again
          </Button>
        </div>
      )}
    </Banner>
  );
}

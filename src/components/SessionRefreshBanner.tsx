import { useEffect, useRef, useState } from "react";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import type { SessionResetResult } from "../lib/types";

interface Props {
  sessionExpired: boolean;
  onRestart: () => Promise<SessionResetResult>;
  onSignInAgain?: () => void;
}

type State = "connected" | "session_expired" | "resetting" | "login_required" | "failed" | "success";

const EXPIRED_MESSAGE = "Your Quanta session expired";
const SUCCESS_MESSAGE = "Quanta session verified";

export default function SessionRefreshBanner({ sessionExpired, onRestart, onSignInAgain }: Props) {
  const [state, setState] = useState<State>(sessionExpired ? "session_expired" : "connected");
  const [message, setMessage] = useState(sessionExpired ? EXPIRED_MESSAGE : "");
  const [reason, setReason] = useState<string>("");
  const request = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sessionExpired && state === "connected") {
      setState("session_expired");
      setMessage(EXPIRED_MESSAGE);
      setReason("");
    } else if (!sessionExpired && (state === "session_expired" || state === "login_required" || state === "failed")) {
      setState("connected");
      setMessage("");
      setReason("");
    }
  }, [sessionExpired, state]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function restart() {
    if (request.current) return;
    request.current = true;
    setState("resetting");
    setMessage("Restarting session");
    setReason("");
    try {
      const result = await onRestart();
      if (result.status === "connected") {
        setState("success");
        setMessage(SUCCESS_MESSAGE);
        setReason(result.message || "");
        timeoutRef.current = setTimeout(() => {
          setState("connected");
          setMessage("");
          setReason("");
        }, 4000);
      } else if (result.status === "login_required") {
        setState("login_required");
        setMessage("Login Required");
        setReason(result.message || "Sign-in was cancelled.");
      } else {
        setState("failed");
        setMessage("Connection Failed");
        setReason(result.message || "Could not restart the Quanta session");
      }
    } catch (error) {
      setState("failed");
      setMessage("Connection Failed");
      setReason(String(error));
    } finally {
      request.current = false;
    }
  }

  if (state === "connected") {
    return null;
  }

  if (state === "success") {
    return (
      <Banner kind="ok">
        <strong>{message}</strong>
        {reason && <div>{reason}</div>}
      </Banner>
    );
  }

  if (state === "session_expired" || state === "resetting") {
    const isResetting = state === "resetting";
    return (
      <Banner
        kind="info"
        action={isResetting ? undefined : { label: "Restart session", onClick: () => void restart() }}
      >
        {isResetting ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="spinner" aria-hidden="true" />
            <strong>Restarting session</strong>
          </span>
        ) : (
          <strong>{EXPIRED_MESSAGE}</strong>
        )}
      </Banner>
    );
  }

  if (state === "login_required") {
    return (
      <Banner
        kind="info"
        action={{ label: "Restart session", onClick: () => void restart() }}
      >
        <strong>{message}</strong>
        <div>{reason}</div>
      </Banner>
    );
  }

  return (
    <Banner
      kind="error"
      action={{ label: "Try again", onClick: () => void restart() }}
    >
      <strong>{message}</strong>
      <div>{reason}</div>
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

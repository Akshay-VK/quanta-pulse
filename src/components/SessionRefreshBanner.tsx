import { useEffect, useRef, useState } from "react";
import type { SessionResetResult } from "../lib/types";

interface Props {
  sessionExpired: boolean;
  onRestart: () => Promise<SessionResetResult>;
}

type State = "connected" | "session_expired" | "resetting" | "login_required" | "failed";

export default function SessionRefreshBanner({ sessionExpired, onRestart }: Props) {
  const connectedMessage = "Quanta access is verified and monitoring is active.";
  const expiredMessage = "The Quanta session expired. Restart it to sign in again.";
  const [state, setState] = useState<State>(sessionExpired ? "session_expired" : "connected");
  const [message, setMessage] = useState(sessionExpired ? expiredMessage : connectedMessage);
  const request = useRef(false);
  const verifiedReset = useRef(false);

  useEffect(() => {
    if (!sessionExpired) {
      verifiedReset.current = false;
    }
    if (sessionExpired && state === "connected" && !verifiedReset.current) {
      setState("session_expired");
      setMessage(expiredMessage);
    } else if (!sessionExpired && (state === "session_expired" || state === "login_required" || state === "failed")) {
      setState("connected");
      setMessage(connectedMessage);
    }
  }, [sessionExpired, state]);

  async function restart() {
    if (request.current) return;
    request.current = true;
    setState("resetting");
    setMessage("Closing the stale Quanta session and opening a fresh sign-in window…");
    try {
      const result = await onRestart();
      verifiedReset.current = result.status === "connected";
      setState(result.status);
      setMessage(result.message);
    } catch (error) {
      setState("failed");
      setMessage(`Could not restart the Quanta session: ${String(error)}`);
    } finally {
      request.current = false;
    }
  }

  return (
    <section className={`session-banner session-${state}`} role="status" aria-live="polite">
      <div className="session-copy">
        <strong>
          {state === "connected" ? "Connected" :
            state === "session_expired" ? "Session Expired" :
              state === "resetting" ? "Resetting Session" :
                state === "login_required" ? "Login Required" : "Connection Failed"}
        </strong>
        <span>{message}</span>
      </div>
      <div className="session-actions">
        {state !== "connected" && (
          <button className="btn btn-primary" type="button" onClick={() => void restart()} disabled={state === "resetting"}>
            {state === "resetting" ? "Resetting session…" : "Restart Quanta Session"}
          </button>
        )}
      </div>
    </section>
  );
}

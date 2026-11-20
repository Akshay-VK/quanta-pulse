import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import type { SessionResetResult } from "../lib/types";

interface Props {
  sessionExpired: boolean;
  onRestart: () => Promise<SessionResetResult>;
  onSignInAgain?: () => void;
  onCancel?: () => void | Promise<void>;
  onDismiss?: () => void;
}

type State = "idle" | "reconnecting" | "succeeded" | "failed" | "dismissed";

export function useSessionRefreshBanner({
  sessionExpired,
  onRestart,
  onSignInAgain,
  onCancel,
  onDismiss,
}: Props) {
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState("");
  const [canSignInAgain, setCanSignInAgain] = useState(false);
  const request = useRef<Promise<SessionResetResult> | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    setState((current) => (
      (sessionExpired && current === "succeeded") ||
      (!sessionExpired && (current === "dismissed" || current === "failed"))
    ) ? "idle" : current);
  }, [sessionExpired]);

  useEffect(() => {
    if (state !== "succeeded") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  async function restart() {
    if (request.current) return;
    cancelled.current = false;
    setState("reconnecting");
    setCanSignInAgain(false);
    const work = Promise.resolve().then(onRestart);
    request.current = work;
    try {
      const result = await work;
      if (cancelled.current) return;
      if (result.status === "connected") {
        setState("succeeded");
      } else {
        setState("failed");
        setDetail(result.message || "Sign-in was cancelled or failed.");
        setCanSignInAgain(result.status === "login_required");
      }
    } catch (error) {
      if (!cancelled.current) {
        setState("failed");
        setDetail(error instanceof Error ? error.message : String(error));
      }
    } finally {
      request.current = null;
    }
  }

  async function cancel() {
    if (!request.current || cancelled.current) return;
    cancelled.current = true;
    try {
      await onCancel?.();
    } catch {
      // A window can disappear before cancellation reaches it.
    }
    setDetail("Sign-in was cancelled or failed.");
    setState("failed");
  }

  function dismiss() {
    setState(sessionExpired ? "dismissed" : "idle");
    onDismiss?.();
  }

  const className = "session-recovery-banner";
  const warning = <CircleAlert aria-hidden="true" />;

  if (state === "reconnecting") {
    return (
      <Banner className={`${className} session-reconnecting`} icon={<span className="spinner" aria-hidden="true" />}>
        <span>Waiting for sign-in in your browser…</span>
        <Button variant="ghost" size="sm" onClick={() => void cancel()}>Cancel</Button>
      </Banner>
    );
  }
  if (state === "succeeded") {
    return (
      <Banner className={className} kind="ok" icon={<CircleCheck aria-hidden="true" />}>
        <span><strong>Reconnected.</strong> Monitoring resumed.</span>
        <Button variant="ghost" size="sm" onClick={dismiss}>Dismiss</Button>
      </Banner>
    );
  }
  if (state === "failed") {
    return (
      <Banner className={className} kind="error" icon={warning}>
        <span><strong>Couldn't reconnect.</strong> {detail}</span>
        <Button variant="secondary" size="sm" onClick={() => void restart()}>Try again</Button>
        {canSignInAgain && onSignInAgain && <Button variant="ghost" size="sm" onClick={onSignInAgain}>Sign in again</Button>}
        <Button variant="ghost" size="sm" onClick={dismiss}>Dismiss</Button>
      </Banner>
    );
  }
  if (state === "dismissed" || !sessionExpired) return null;
  return (
    <Banner className={className} kind="error" icon={warning}>
      <span><strong>Session expired.</strong> Sign in again to keep monitoring.</span>
      <Button variant="secondary" size="sm" onClick={() => void restart()}>Reconnect</Button>
    </Banner>
  );
}

export default function SessionRefreshBanner(props: Props) {
  return useSessionRefreshBanner(props);
}

import { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { TextField } from "./ui/TextField";
import { PasswordField } from "./ui/PasswordField";
import type { AuthStatus } from "../lib/types";

interface Props {
  onAuthenticated: (status: AuthStatus) => void;
  onCancel?: () => void;
}

type Phase = "idle" | "loading" | "sso" | "success" | "error";

export default function LoginScreen({ onAuthenticated, onCancel }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const busy = phase === "loading" || phase === "sso";
  const ssoPending = phase === "sso";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPhase("loading");
    setMessage(null);
    try {
      const status = await api.login(email, password);
      setPassword("");
      setPhase("success");
      onAuthenticated(status);
    } catch (err) {
      setPassword("");
      setPhase("error");
      setMessage(String(err));
    }
  }

  async function sso() {
    setPhase("sso");
    setMessage(null);
    try {
      const status = await api.startSsoLogin();
      setPhase("success");
      onAuthenticated(status);
    } catch (err) {
      setPhase("error");
      setMessage(String(err));
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="9" opacity="0.2" />
            <path d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 2a7 7 0 110 14 7 7 0 010-14zm-1 3v6l5-3-5-3z" />
          </svg>
        </div>
        <h1 className="login-title">Sign in to Quanta</h1>
        <p className="login-copy">Sign in to track new material on BITS Quanta.</p>

        {phase === "error" && message && (
          <Banner kind="error">
            <strong>Sign in failed</strong>
            <div>{message}</div>
          </Banner>
        )}
        {phase === "success" && (
          <Banner kind="ok">Signed in. Discovering your courses…</Banner>
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
          />
          <Button type="submit" variant="primary" size="lg" loading={phase === "loading"} disabled={busy} style={{ width: "100%" }}>
            {phase === "loading" ? "Signing in" : "Sign in"}
          </Button>
        </form>

        <div className="login-sep">or</div>

        {ssoPending ? (
          <Button size="lg" variant="secondary" loading disabled style={{ width: "100%" }}>
            Waiting for BITS SSO
          </Button>
        ) : (
          <Button size="lg" variant="secondary" onClick={sso} disabled={busy} style={{ width: "100%" }}>
            Continue with BITS SSO
          </Button>
        )}

        <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
          {onCancel && (
            <button type="button" className="settings-link" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>

        <p className="login-copy" style={{ marginTop: 16 }}>
          Quanta Pulse signs in directly with Quanta over HTTPS. Your password is never stored. It is cleared from memory as soon as sign-in completes.
        </p>
      </div>
    </div>
  );
}

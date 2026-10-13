import { useState } from "react";
import { api } from "../lib/api";
import type { AuthStatus } from "../lib/types";

interface Props {
  onAuthenticated: (status: AuthStatus) => void;
  onCancel?: () => void;
}

type Phase = "idle" | "loading" | "sso" | "success" | "error";

const QUANTA_LOGIN_URL = "https://quanta.bits-pilani.ac.in/login/index.php?loginredirect=1";

export default function LoginScreen({ onAuthenticated, onCancel }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const busy = phase === "loading" || phase === "sso";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPhase("loading");
    setMessage(null);
    try {
      const status = await api.login(email, password);
      // Clear the password from component state immediately after the attempt.
      setPassword("");
      setPhase("success");
      setMessage("Signed in. Discovering your courses…");
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
      setMessage("Signed in. Discovering your courses…");
      onAuthenticated(status);
    } catch (err) {
      setPhase("error");
      setMessage(String(err));
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Quanta Pulse</h1>
        <p className="sub">Sign in to track new material on BITS Quanta.</p>
        {onCancel && <button className="btn-link" type="button" onClick={onCancel}>Back to Quanta Pulse</button>}

        {message && (
          <div
            className={
              phase === "error" ? "alert error" : phase === "success" ? "alert ok" : "alert info"
            }
          >
            {message}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">BITS email</label>
            <div className="control">
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="f20230000@goa.bits-pilani.ac.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="control">
              <input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="reveal"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="login-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {phase === "loading" ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

        <div className="divider-or">or</div>

        <button className="btn" style={{ width: "100%" }} onClick={sso} disabled={busy}>
          {phase === "sso" ? "Waiting for sign-in…" : "Sign in with BITS Google"}
        </button>

        <p className="hint">
          Quanta Pulse signs in directly with Quanta over HTTPS. Your password is never stored.
          It is cleared from memory as soon as sign-in completes. If your account requires BITS
          Google, use the button above and complete MFA in the window that opens.{" "}
          <a
            href={QUANTA_LOGIN_URL}
            onClick={(e) => {
              e.preventDefault();
              void api.openExternal(QUANTA_LOGIN_URL);
            }}
          >
            Open Quanta
          </a>
          .
        </p>
      </div>
    </div>
  );
}

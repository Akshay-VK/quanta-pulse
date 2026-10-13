import type { SyncStatus, ThemeMode } from "../lib/types";
import { formatCompact, relativeLabel, todayLabel } from "../lib/format";
import ThemeSwitcher from "./ThemeSwitcher";

interface Props {
  sync: SyncStatus | null;
  onSync: () => void;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
}

function statusOf(sync: SyncStatus | null): { tone: string; label: string; title: string } {
  if (!sync) return { tone: "", label: "starting", title: "Waiting for the backend" };
  if (sync.running) {
    return { tone: "syncing", label: "syncing", title: sync.phase || "Syncing with Quanta" };
  }
  if (sync.authState === "authenticated" || !sync.authState) {
    return { tone: "ok", label: "active", title: "Monitoring Quanta" };
  }
  return {
    tone: "error",
    label: "sign-in required",
    title: sync.lastError ?? "Quanta session needs attention",
  };
}

export default function Header({ sync, onSync, themeMode, onThemeMode }: Props) {
  const running = sync?.running ?? false;
  const status = statusOf(sync);
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="dot" />
          Quanta Pulse
        </div>
        <div className="header-meta">
          <span>{todayLabel()}</span>
          <span>
            last sync{" "}
            {sync?.lastSuccessAt
              ? `${formatCompact(sync.lastSuccessAt)} (${relativeLabel(sync.lastSuccessAt)})`
              : "never"}
          </span>
          <span>
            next {sync?.nextScheduledAt ? formatCompact(sync.nextScheduledAt) : "—"}
          </span>
        </div>
        <div className="header-spacer" />
        <div className="status-pill" title={status.title}>
          {status.tone ? <span className={`status-dot ${status.tone}`} /> : null}
          <span>{status.label}</span>
        </div>
        <ThemeSwitcher mode={themeMode} onChange={onThemeMode} />
        <button className="btn btn-primary" onClick={onSync} disabled={running || sync?.authState === "expired"}>
          {running ? "Syncing…" : sync?.authState === "expired" ? "Session expired" : "Sync now"}
        </button>
      </header>
      {running && (
        <div className="progress-track" title={sync?.phase}>
          <div
            className="progress"
            style={{ width: `${Math.max(4, Math.round((sync?.progress ?? 0) * 100))}%` }}
          />
        </div>
      )}
    </>
  );
}

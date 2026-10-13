import { useEffect, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { api } from "../lib/api";
import { formatBytes, formatCompact } from "../lib/format";
import type { AuthStatus, DbInfo, Settings } from "../lib/types";
import PageHeader from "../components/PageHeader";
import ThemeSwitcher from "../components/ThemeSwitcher";

interface Props {
  settings: Settings;
  auth: AuthStatus | null;
  dbInfo: DbInfo | null;
  onSave: (settings: Settings) => Promise<void>;
  onLogout: () => void;
  onRefresh: () => void;
  themeMode: "system" | "light" | "dark";
  onThemeMode: (mode: "system" | "light" | "dark") => void;
}

export default function SettingsView({
  settings,
  auth,
  dbInfo,
  onSave,
  onLogout,
  onRefresh,
  themeMode,
  onThemeMode,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<string>("unknown");

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    void (async () => {
      try {
        const granted = await isPermissionGranted();
        setPermission(granted ? "granted" : "not granted");
      } catch {
        setPermission("unavailable");
      }
    })();
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  async function save() {
    await onSave(draft);
    setSaved(true);
  }

  async function askPermission() {
    try {
      const result = await requestPermission();
      setPermission(result === "granted" ? "granted" : result);
    } catch {
      setPermission("unavailable");
    }
  }

  return (
    <div className="panel">
      <PageHeader title="Settings" subtitle="Appearance, account, notifications and monitoring" />

      <h2>Appearance</h2>
      <div className="setting">
        <div>
          Color theme
          <div className="desc">Choose a theme or follow your Mac appearance.</div>
        </div>
        <ThemeSwitcher mode={themeMode} onChange={onThemeMode} />
      </div>

      <h2>Account</h2>
      <div className="kv">
        <span className="k">Status</span>
        <span className={auth?.authenticated ? "text-ok" : "text-danger"}>
          {auth?.authenticated ? "Signed in" : "Signed out"}
          {auth?.sessionExpired ? " (session expired)" : ""}
        </span>
      </div>
      <div className="kv">
        <span className="k">Account</span>
        <span>{auth?.fullName || auth?.email || "—"}</span>
      </div>
      <div className="kv">
        <span className="k">Sign-in method</span>
        <span>{auth?.method === "sso" ? "BITS Google (SSO)" : auth?.method ?? "—"}</span>
      </div>
      <div className="kv">
        <span className="k">Session acquired</span>
        <span>{auth?.acquiredAt ? formatCompact(auth.acquiredAt) : "—"}</span>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button className="btn" onClick={onLogout}>
          Sign out
        </button>
        <button className="btn" onClick={askPermission}>
          Notification permission: {permission}
        </button>
        <button
          className="btn"
          onClick={() => {
            void api.testNotification();
          }}
        >
          Send test notification
        </button>
      </div>

      <h2>Notifications</h2>
      <Toggle
        label="Enable notifications"
        desc="Requires the app to be running and permission from macOS."
        checked={draft.notificationsEnabled}
        onChange={(v) => set("notificationsEnabled", v)}
      />
      <Toggle label="New uploads" checked={draft.notifyNew} onChange={(v) => set("notifyNew", v)} />
      <Toggle
        label="Announcements"
        checked={draft.notifyAnnouncements}
        onChange={(v) => set("notifyAnnouncements", v)}
      />
      <Toggle
        label="Updated resources"
        checked={draft.notifyUpdated}
        onChange={(v) => set("notifyUpdated", v)}
      />
      <Toggle
        label="Deadlines"
        checked={draft.notifyDeadlines}
        onChange={(v) => set("notifyDeadlines", v)}
      />
      <Toggle
        label="Availability issues"
        checked={draft.notifyAvailability}
        onChange={(v) => set("notifyAvailability", v)}
      />
      <Toggle
        label="Authentication reminders"
        checked={draft.notifyAuth}
        onChange={(v) => set("notifyAuth", v)}
      />

      <div className="setting">
        <div>
          Deadline reminder window
          <div className="desc">Notify about deadlines within this many hours.</div>
        </div>
        <input
          type="number"
          min={1}
          max={720}
          value={draft.deadlineReminderHours}
          onChange={(e) => set("deadlineReminderHours", Number(e.target.value))}
        />
      </div>
      <div className="setting">
        <div>
          Quiet hours
          <div className="desc">Notifications pause between these local times.</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="time"
            value={draft.quietHoursStart ?? ""}
            onChange={(e) => set("quietHoursStart", e.target.value || null)}
          />
          <span className="faint">to</span>
          <input
            type="time"
            value={draft.quietHoursEnd ?? ""}
            onChange={(e) => set("quietHoursEnd", e.target.value || null)}
          />
        </div>
      </div>

      <h2>Monitoring</h2>
      <div className="setting">
        <div>
          Sync interval (minutes)
          <div className="desc">How often Quanta is checked while the app is running.</div>
        </div>
        <input
          type="number"
          min={15}
          max={1440}
          value={draft.syncIntervalMinutes}
          onChange={(e) => set("syncIntervalMinutes", Number(e.target.value))}
        />
      </div>
      <Toggle
        label="Keep running when the window is closed"
        desc="Monitoring continues in the menu bar."
        checked={draft.runInBackground}
        onChange={(v) => set("runInBackground", v)}
      />
      <Toggle
        label="Launch at login"
        checked={draft.launchAtLogin}
        onChange={(v) => set("launchAtLogin", v)}
      />
      <div className="setting">
        <div>
          Timezone display
          <div className="desc">Times are shown in your Mac's local timezone.</div>
        </div>
        <span className="muted small">
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
      </div>

      <h2>Data</h2>
      <div className="kv">
        <span className="k">Database</span>
        <span className="mono">{dbInfo?.path ?? "—"}</span>
      </div>
      <div className="kv">
        <span className="k">Size</span>
        <span>{dbInfo ? formatBytes(dbInfo.sizeBytes) || "0 B" : "—"}</span>
      </div>
      <div className="kv">
        <span className="k">Stored</span>
        <span>
          {dbInfo?.courseCount ?? 0} courses · {dbInfo?.resourceCount ?? 0} resources ·{" "}
          {dbInfo?.eventCount ?? 0} events
        </span>
      </div>
      <div className="kv">
        <span className="k">Logs</span>
        <span className="mono">{dbInfo?.logDir ?? "—"}</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          className="btn"
          onClick={() => {
            const ok = window.confirm(
              "Re-baseline all courses? History is kept, but current content becomes the new baseline.",
            );
            if (ok) {
              void api.rebuildBaseline().then(onRefresh);
            }
          }}
        >
          Re-baseline all courses
        </button>
      </div>

      <div style={{ marginTop: 22, display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save}>
          Save settings
        </button>
        {saved && <span className="caught-up">Saved.</span>}
      </div>

      <p className="hint">
        Session cookies stay in memory and are not saved. Sign in again after restarting the app. Times are
        converted to your Mac's local timezone for display; original timestamps are preserved.
      </p>
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting">
      <div>
        {label}
        {desc && <div className="desc">{desc}</div>}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

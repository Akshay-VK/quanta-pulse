import { useEffect, useMemo, useState } from "react";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { formatBytes, formatCompact } from "../lib/format";
import type { DetailProperty } from "../lib/details";
import type { AuthStatus, CacheStats, DbInfo, Settings, ThemeMode } from "../lib/types";
import PageHeader from "../components/PageHeader";
import SettingRow from "../components/SettingRow";
import { ToggleGroup } from "../components/ui/ToggleGroup";
import { Switch } from "../components/ui/Switch";
import { Select } from "../components/ui/Select";
import { TimeField } from "../components/ui/TimeField";
import { Button } from "../components/ui/Button";
import { Banner } from "../components/ui/Banner";
import ConfirmDialog from "../components/ConfirmDialog";
import PropertyList from "../components/PropertyList";
import { hasValidationErrors, isSettingsDirty, validateSettingsDraft } from "../lib/settingsDraft";

interface Props {
  settings: Settings;
  auth: AuthStatus | null;
  dbInfo: DbInfo | null;
  onSave: (settings: Settings) => Promise<void>;
  onLogout: () => Promise<void> | void;
  onRefresh: () => void | Promise<void>;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SYNC_INTERVALS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "60 min" },
  { value: "120", label: "2 h" },
  { value: "240", label: "4 h" },
  { value: "360", label: "6 h" },
  { value: "720", label: "12 h" },
  { value: "1440", label: "24 h" },
];

const DEADLINE_OPTIONS = [
  { value: "1", label: "1 hour" },
  { value: "3", label: "3 hours" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours" },
  { value: "72", label: "72 hours" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

const NAV_ITEMS = [
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
  { id: "notifications", label: "Notifications" },
  { id: "monitoring", label: "Monitoring" },
  { id: "data", label: "Data" },
];

const GIB = 1024 * 1024 * 1024;

/** Cache ceilings the UI offers, in bytes. */
const CACHE_LIMITS = [1, 2, 5, 10, 20].map((gb) => ({ value: String(gb * GIB), label: `${gb} GB` }));

/** 7.6: the permission row reads Allowed, Blocked or Not asked. */
function permissionLabel(permission: string): string {
  if (permission === "granted") return "Allowed";
  if (permission === "denied") return "Blocked";
  if (permission === "unavailable") return "Unavailable";
  return "Not asked";
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
  onDirtyChange,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [permission, setPermission] = useState<string>("unknown");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [showRebaseline, setShowRebaseline] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [active, setActive] = useState<string>("appearance");

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    // Cache occupancy is page-local and changes on scan, so it is fetched here
    // rather than threaded through the app's load pass.
    api
      .cacheStats()
      .then(setCacheStats)
      .catch(() => setCacheStats(null));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setPermission((await isPermissionGranted()) ? "granted" : "default");
      } catch {
        setPermission("unavailable");
      }
    })();
  }, []);

  useEffect(() => {
    // The page scrolls inside .app-main; scroll does not bubble, so listen in
    // the capture phase to track which section is in view.
    function onScroll() {
      let best = NAV_ITEMS[0].id;
      let topBest = Infinity;
      for (const item of NAV_ITEMS) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top < 120 && Math.abs(top) < topBest) {
          topBest = Math.abs(top);
          best = item.id;
        }
      }
      setActive(best);
    }
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  const errors = useMemo(() => validateSettingsDraft(draft), [draft]);
  const dirty = useMemo(() => isSettingsDirty(draft, settings), [draft, settings]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dirty, saving, errors]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  async function save() {
    if (saving || !dirty || hasValidationErrors(errors)) return;
    setSaving(true);
    try {
      await onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function askPermission() {
    try {
      const result = await requestPermission();
      setPermission(result === "granted" ? "granted" : result);
    } catch {
      setPermission("unavailable");
    }
  }

  const notificationsDisabled = !draft.notificationsEnabled;

  const dbProps: DetailProperty[] = [
    { label: "Database path", value: dbInfo?.path ?? "—", copy: dbInfo?.path },
    { label: "Size", value: dbInfo ? formatBytes(dbInfo.sizeBytes) || "0 B" : "—" },
    { label: "Counts", value: `${dbInfo?.courseCount ?? 0} courses · ${dbInfo?.resourceCount ?? 0} resources · ${dbInfo?.eventCount ?? 0} events` },
    { label: "Logs folder", value: dbInfo?.logDir ?? "—", copy: dbInfo?.logDir },
    {
      label: "File cache",
      value: cacheStats
        ? `${formatBytes(cacheStats.totalBytes) || "0 B"} in ${cacheStats.fileCount} ${cacheStats.fileCount === 1 ? "file" : "files"}`
        : "—",
    },
  ];

  async function clearCache() {
    setClearingCache(true);
    try {
      setCacheStats(await api.clearFileCache());
    } finally {
      setClearingCache(false);
    }
  }

  return (
    <div className="settings-page">
      <PageHeader title="Settings" summary="Appearance, account, notifications, monitoring and data." />
      <div className="settings-layout">
      <aside className="settings-sticky">
        <nav aria-label="Settings sections">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="settings-link"
              aria-current={active === item.id ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="settings-content">
        <section id="appearance" className="settings-section">
          <h2 className="settings-group-title">Appearance</h2>
          <SettingRow title="Theme" description="Choose a theme or follow your system appearance.">
            <ToggleGroup
              value={themeMode}
              onValueChange={(v) => {
                if (v === "system" || v === "light" || v === "dark") onThemeMode(v);
              }}
              options={THEME_OPTIONS as Array<{ value: string; label: string }>}
              ariaLabel="Color theme"
            />
          </SettingRow>
        </section>

        <div className="settings-group-divider" />

        <section id="account" className="settings-section">
          <h2 className="settings-group-title">Account</h2>
          <SettingRow title="Status">
            <span className="settings-inline">
              <span
                aria-hidden="true"
                className={cx(
                  "settings-dot",
                  auth?.authenticated && !auth.sessionExpired && "ok",
                )}
              />
              {auth?.sessionExpired ? "Session expired" : auth?.authenticated ? "Signed in" : "Signed out"}
            </span>
          </SettingRow>
          <SettingRow title="Sign-in method">
            <span>{auth?.method === "sso" ? "BITS SSO" : auth?.method === "password" ? "Password" : "—"}</span>
          </SettingRow>
          <SettingRow title="Session acquired">
            <span className="mono">{auth?.acquiredAt ? formatCompact(auth.acquiredAt) : "—"}</span>
          </SettingRow>
          <SettingRow title="Notification permission">
            <div className="settings-inline">
              <span>{permissionLabel(permission)}</span>
              {permission !== "granted" && permission !== "denied" && permission !== "unavailable" && (
                <Button variant="secondary" size="sm" onClick={askPermission}>Allow notifications</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void api.testNotification()}>Send test notification</Button>
            </div>
          </SettingRow>
          {auth?.sessionExpired && (
            <SettingRow title="Session expired" description="Sign in again to resume scanning.">
              <Button variant="secondary" size="sm" onClick={onRefresh}>Restart session</Button>
            </SettingRow>
          )}
          <SettingRow title="Sign out">
            <Button variant="danger" size="sm" onClick={() => setShowSignOut(true)}>Sign out</Button>
          </SettingRow>
        </section>

        <div className="settings-group-divider" />

        <section id="notifications" className="settings-section">
          <h2 className="settings-group-title">Notifications</h2>
          <SettingRow title="Enable notifications" description="Requires permission from your system.">
            <Switch checked={draft.notificationsEnabled} onCheckedChange={(v) => set("notificationsEnabled", v)} ariaLabel="Enable notifications" />
          </SettingRow>
          <SettingRow
            title="New files"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={
              notificationsDisabled
                ? "Turn on notifications to change these"
                : "Notify when new resources appear."
            }
          >
            <Switch
              checked={draft.notifyNew}
              onCheckedChange={(v) => set("notifyNew", v)}
              disabled={notificationsDisabled}
              ariaLabel="New files"
            />
          </SettingRow>
          <SettingRow
            title="Updated files"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled ? undefined : "Notify when resources change."}
          >
            <Switch
              checked={draft.notifyUpdated}
              onCheckedChange={(v) => set("notifyUpdated", v)}
              disabled={notificationsDisabled}
              ariaLabel="Updated files"
            />
          </SettingRow>
          <SettingRow
            title="Announcements"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled ? undefined : "Notify about announcements."}
          >
            <Switch
              checked={draft.notifyAnnouncements}
              onCheckedChange={(v) => set("notifyAnnouncements", v)}
              disabled={notificationsDisabled}
              ariaLabel="Announcements"
            />
          </SettingRow>
          <SettingRow
            title="Deadlines"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled ? undefined : "Notify about upcoming deadlines."}
          >
            <Switch
              checked={draft.notifyDeadlines}
              onCheckedChange={(v) => set("notifyDeadlines", v)}
              disabled={notificationsDisabled}
              ariaLabel="Deadlines"
            />
          </SettingRow>
          <SettingRow
            title="Unavailable files"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled ? undefined : "Notify when courses become unavailable."}
          >
            <Switch
              checked={draft.notifyAvailability}
              onCheckedChange={(v) => set("notifyAvailability", v)}
              disabled={notificationsDisabled}
              ariaLabel="Unavailable files"
            />
          </SettingRow>
          <SettingRow
            title="Authentication reminders"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled ? undefined : "Remind when session may need refresh."}
          >
            <Switch
              checked={draft.notifyAuth}
              onCheckedChange={(v) => set("notifyAuth", v)}
              disabled={notificationsDisabled}
              ariaLabel="Authentication reminders"
            />
          </SettingRow>
          <SettingRow title="Deadline reminder window" description="Notify about deadlines within this many hours.">
            <Select
              value={String(draft.deadlineReminderHours)}
              onValueChange={(v) => set("deadlineReminderHours", Number(v))}
              options={DEADLINE_OPTIONS as Array<{ value: string; label: string }>}
              ariaLabel="Deadline reminder window"
            />
          </SettingRow>
          {errors.deadlineReminderHours && <Banner kind="error">{errors.deadlineReminderHours}</Banner>}
          <SettingRow title="Quiet hours" description="Notifications pause between these local times.">
            <div className="settings-inline">
              <TimeField value={draft.quietHoursStart ?? ""} onChange={(e) => set("quietHoursStart", e.target.value || null)} aria-label="Quiet hours start" />
              <span className="muted">to</span>
              <TimeField value={draft.quietHoursEnd ?? ""} onChange={(e) => set("quietHoursEnd", e.target.value || null)} aria-label="Quiet hours end" />
            </div>
          </SettingRow>
          {errors.quietHours && <Banner kind="error">{errors.quietHours}</Banner>}
          {errors.quietHoursStart && <Banner kind="error">{errors.quietHoursStart}</Banner>}
          {errors.quietHoursEnd && <Banner kind="error">{errors.quietHoursEnd}</Banner>}
        </section>

        <div className="settings-group-divider" />

        <section id="monitoring" className="settings-section">
          <h2 className="settings-group-title">Monitoring</h2>
          <SettingRow title="Sync interval" description="How often Quanta is checked while the app is running (15–1440 min).">
            <Select
              value={String(draft.syncIntervalMinutes)}
              onValueChange={(v) => set("syncIntervalMinutes", Number(v))}
              options={SYNC_INTERVALS as Array<{ value: string; label: string }>}
              ariaLabel="Sync interval"
            />
          </SettingRow>
          {errors.syncIntervalMinutes && <Banner kind="error">{errors.syncIntervalMinutes}</Banner>}
          <SettingRow title="Run in background" description="Monitoring continues when the window is closed.">
            <Switch checked={draft.runInBackground} onCheckedChange={(v) => set("runInBackground", v)} ariaLabel="Run in background" />
          </SettingRow>
          <SettingRow title="Launch at login">
            <Switch checked={draft.launchAtLogin} onCheckedChange={(v) => set("launchAtLogin", v)} ariaLabel="Launch at login" />
          </SettingRow>
          <SettingRow title="Timezone" description="Dates are grouped by your local calendar days.">
            <span className="muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
          </SettingRow>
        </section>

        <div className="settings-group-divider" />

        <section id="data" className="settings-section">
          <h2 className="settings-group-title">Data</h2>
          <PropertyList properties={dbProps} />
          <SettingRow
            title="Cached files"
            description="Downloaded files are kept so previews and search are fast. Oldest are removed first when the limit is reached."
          >
            <div className="settings-inline">
              <Select
                value={String(draft.cacheLimitBytes)}
                onValueChange={(v) => set("cacheLimitBytes", Number(v))}
                options={CACHE_LIMITS}
                ariaLabel="Cache size limit"
              />
              <Button
                variant="secondary"
                size="sm"
                loading={clearingCache}
                onClick={() => void clearCache()}
              >
                Clear cached files
              </Button>
            </div>
          </SettingRow>
          <SettingRow title="Re-baseline" description="Record everything as known. Nothing is reported as new until the next scan.">
            <Button variant="secondary" size="sm" onClick={() => setShowRebaseline(true)}>Re-baseline all courses</Button>
          </SettingRow>
          <p className="settings-note">
            Session cookies stay in memory and are not saved. Times are shown in your local timezone.
          </p>
        </section>

        {dirty && (
          <div className="save-bar" role="status" aria-live="polite">
            <div className="save-copy">You have unsaved changes</div>
            <div className="settings-inline">
              <Button variant="ghost" size="sm" onClick={() => setShowDiscard(true)}>Discard</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={() => void save()} disabled={hasValidationErrors(errors) || saving}>
                Save settings
              </Button>
            </div>
          </div>
        )}
        {saved && !dirty && (
          <div className="save-bar" role="status" aria-live="polite">
            <div className="save-copy">Settings saved</div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showDiscard}
        onOpenChange={setShowDiscard}
        title="Discard changes?"
        body="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setDraft(settings);
          setSaved(false);
        }}
      />
      <ConfirmDialog
        open={showSignOut}
        onOpenChange={setShowSignOut}
        title="Sign out?"
        body="Sign out of Quanta. You can sign in again later."
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void onLogout()}
      />
      <ConfirmDialog
        open={showRebaseline}
        onOpenChange={setShowRebaseline}
        title="Re-baseline all courses"
        body="Re-baseline all courses? History is kept, but current content becomes the new baseline."
        confirmLabel="Re-baseline"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          await api.rebuildBaseline();
          await onRefresh();
        }}
      />
      </div>
    </div>
  );
}

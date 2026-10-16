import { useEffect, useMemo, useState } from "react";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { formatBytes, formatCompact } from "../lib/format";
import type { DetailProperty } from "../lib/details";
import type { AuthStatus, CacheStats, DbInfo, Settings, ThemeMode, MirrorStats, TelegramStatus } from "../lib/types";
import PageHeader from "../components/PageHeader";
import SettingRow from "../components/SettingRow";
import { ToggleGroup } from "../components/ui/ToggleGroup";
import { Switch } from "../components/ui/Switch";
import { Select } from "../components/ui/Select";
import { TextField } from "../components/ui/TextField";
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
  { id: "telegram", label: "Telegram" },
  { id: "monitoring", label: "Monitoring" },
  { id: "files", label: "Files" },
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

/** The Telegram row: what the live `getMe` said, or what is still missing. */
function telegramLabel(status: TelegramStatus | null, enabled: boolean): string {
  if (!status) return "Not checked";
  if (status.error) return status.error;
  if (!enabled) return "Off";
  if (!status.configured) return "Add a bot token and a chat id";
  return status.botUsername ? `Connected as ${status.botUsername}` : "Connected";
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
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [active, setActive] = useState<string>("appearance");
  const [mirrorStats, setMirrorStats] = useState<MirrorStats | null>(null);
  const [changingMirrorRoot, setChangingMirrorRoot] = useState(false);
  const [movingFiles, setMovingFiles] = useState(false);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTest, setTelegramTest] = useState<string | null>(null);

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
    api.mirrorStats().then(setMirrorStats).catch(() => setMirrorStats(null));
  }, []);

  useEffect(() => {
    // Only a live `getMe` proves the token works, so this is fetched once when
    // the page opens, not from the settings row.
    api.telegramStatus().then(setTelegram).catch(() => setTelegram(null));
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

  async function pickMirrorRoot() {
    setChangingMirrorRoot(true);
    try {
      await api.pickMirrorRoot();
      await api.mirrorStats().then(setMirrorStats);
    } catch {
      // Error handled by toast in app shell.
    }
  }

  async function openMirrorFolder() {
    try {
      await api.openAppFolder("mirror", false);
    } catch {
      // Error handled by toast in app shell.
    }
  }

  async function moveFilesToNewRoot() {
    setMovingFiles(true);
    try {
      await api.mirrorMoveFiles();
      setChangingMirrorRoot(false);
      await api.mirrorStats().then(setMirrorStats);
    } catch {
      // Error handled by toast in app shell.
    } finally {
      setMovingFiles(false);
    }
  }

  async function startBackfill() {
    try {
      await api.mirrorStartBackfill();
      await api.mirrorStats().then(setMirrorStats);
    } catch {
      // Error handled by toast in app shell.
    }
  }

  async function pauseMirror() {
    try {
      await api.mirrorPause();
      await api.mirrorStats().then(setMirrorStats);
    } catch {
      // Error handled by toast in app shell.
    }
  }

  async function resumeMirror() {
    try {
      await api.mirrorResume();
      await api.mirrorStats().then(setMirrorStats);
    } catch {
      // Error handled by toast in app shell.
    }
  }

  async function retryFailed() {
    try {
      await api.mirrorRetryFailed();
      await api.mirrorStats().then(setMirrorStats);
    } catch {
      // Error handled by toast in app shell.
    }
  }

  async function verifyFiles() {
    try {
      await api.mirrorVerifyFiles();
      await api.mirrorStats().then(setMirrorStats);
    } catch {
      // Error handled by toast in app shell.
    }
  }

  /** Send one message so a wrong token or chat id is caught here, not at the
   *  next scan. The token only works after a save, hence the hint on the row. */
  async function testTelegram() {
    setTestingTelegram(true);
    setTelegramTest(null);
    try {
      await api.telegramTest();
      setTelegramTest("Sent. Check your Telegram chat.");
    } catch (error) {
      setTelegramTest(String(error));
    } finally {
      setTestingTelegram(false);
      await api.telegramStatus().then(setTelegram).catch(() => setTelegram(null));
    }
  }

  return (
    <div className="settings-page">
      <PageHeader title="Settings" summary="Appearance, account, notifications, Telegram, monitoring, files and data." />
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
                // Instant under reduced motion, smooth otherwise.
                const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
                document
                  .getElementById(item.id)
                  ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
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
              <span className="muted">{permissionLabel(permission)}</span>
              {permission === "denied" ? (
                <Button variant="secondary" size="sm" onClick={() => void api.openNotificationSettings()}>
                  Open system settings
                </Button>
              ) : (
                <>
                  {permission === "default" && (
                    <Button variant="secondary" size="sm" onClick={askPermission}>
                      Allow notifications
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => void api.testNotification()}>
                    Send test notification
                  </Button>
                </>
              )}
            </div>
          </SettingRow>
          {auth?.sessionExpired && (
            <SettingRow title="Session expired" description="Sign in again to resume scanning.">
              <Button variant="secondary" size="sm" onClick={onRefresh}>Restart session</Button>
            </SettingRow>
          )}
          <SettingRow title="Sign out" description="Ends your Quanta session on this computer.">
            <Button variant="danger-ghost" size="sm" onClick={() => setShowSignOut(true)}>
              Sign out…
            </Button>
          </SettingRow>
        </section>

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

        <section id="telegram" className="settings-section">
          <h2 className="settings-group-title">Telegram</h2>
          <SettingRow
            title="Forward to Telegram"
            description="Send new material to your own bot chat. The categories below Notifications decide which events go out."
          >
            <Switch
              checked={draft.telegramEnabled}
              onCheckedChange={(v) => set("telegramEnabled", v)}
              ariaLabel="Forward to Telegram"
            />
          </SettingRow>
          <SettingRow
            title="Bot token"
            description="From @BotFather. Stored on this computer and sent to no host but Telegram."
          >
            <TextField
              type="password"
              value={draft.telegramBotToken ?? ""}
              onChange={(e) => set("telegramBotToken", e.target.value || null)}
              placeholder="123456789:AA…"
              aria-label="Bot token"
              autoComplete="off"
            />
          </SettingRow>
          {errors.telegramBotToken && <Banner kind="error">{errors.telegramBotToken}</Banner>}
          <SettingRow title="Chat id" description="Your numeric chat id, or an @channel the bot can post to.">
            <TextField
              value={draft.telegramChatId ?? ""}
              onChange={(e) => set("telegramChatId", e.target.value || null)}
              placeholder="123456789 or @my_channel"
              aria-label="Chat id"
              autoComplete="off"
            />
          </SettingRow>
          {errors.telegramChatId && <Banner kind="error">{errors.telegramChatId}</Banner>}
          <SettingRow title="Connection" description="Save your changes first, then send a test message.">
            <div className="settings-inline">
              <span className="muted">{telegramLabel(telegram, draft.telegramEnabled)}</span>
              <Button
                variant="secondary"
                size="sm"
                loading={testingTelegram}
                disabled={!telegram?.configured}
                onClick={testTelegram}
              >
                Send test message
              </Button>
            </div>
          </SettingRow>
          {telegramTest && (
            <Banner kind={telegramTest.startsWith("Sent") ? "info" : "error"}>{telegramTest}</Banner>
          )}
        </section>

        <section id="monitoring" className="settings-section">
          <h2 className="settings-group-title">Monitoring</h2>          <SettingRow title="Sync interval" description="How often Quanta is checked while the app is running (15–1440 min).">
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

        <section id="files" className="settings-section">
          <h2 className="settings-group-title">Files</h2>
          <SettingRow
            title="Mirror folder"
            description="Where the permanent local copies are stored. Changing this does not move existing files unless you choose to move them."
          >
            <div className="settings-inline">
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {draft.mirrorRoot || "Default (Documents/Quanta Pulse/Files)"}
              </span>
              <Button variant="secondary" size="sm" onClick={pickMirrorRoot}>
                Change…
              </Button>
              <Button variant="secondary" size="sm" onClick={openMirrorFolder}>
                Open folder
              </Button>
            </div>
          </SettingRow>

          {changingMirrorRoot && mirrorStats && (
            <div className="settings-move-banner" role="alert">
              <p>
                <strong>Move existing files?</strong> The new folder is empty. Do you want to copy
                everything from the current mirror and verify it, or start fresh?
              </p>
              <div className="settings-inline">
                <Button
                  variant="primary"
                  size="sm"
                  loading={movingFiles}
                  onClick={moveFilesToNewRoot}
                >
                  Move existing files
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setChangingMirrorRoot(false)}>
                  Start fresh here
                </Button>
              </div>
            </div>
          )}

          <SettingRow
            title="Download new files automatically"
            description="When a scan finds new or updated resources, queue them for download."
          >
            <Switch
              checked={draft.mirrorEnabled}
              onCheckedChange={(v) => set("mirrorEnabled", v)}
              ariaLabel="Download new files automatically"
            />
          </SettingRow>

          {mirrorStats && (
            <SettingRow
              title="Download existing files"
              description={
                mirrorStats.state === "running"
                  ? "Downloading in the background…"
                  : mirrorStats.state === "paused"
                  ? "Paused. Click Resume to continue."
                  : `Saved ${mirrorStats.done.toLocaleString()} of ${mirrorStats.totalResources.toLocaleString()} files · ${formatBytes(mirrorStats.bytesDone)}`
              }
            >
              <div className="settings-inline">
                <Button
                  variant={mirrorStats.state === "paused" ? "primary" : "secondary"}
                  size="sm"
                  onClick={mirrorStats.state === "paused" ? resumeMirror : pauseMirror}
                  disabled={mirrorStats.state !== "running" && mirrorStats.state !== "paused"}
                >
                  {mirrorStats.state === "paused" ? "Resume" : "Pause"}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={startBackfill}
                  disabled={mirrorStats.state === "running"}
                >
                  Download all
                </Button>
              </div>
            </SettingRow>
          )}

          <SettingRow
            title="Skip files larger than"
            description="Files above this size are skipped and marked as 'too large'. You can still download them individually."
          >
            <Select
              value={String(draft.mirrorMaxBytes)}
              onValueChange={(v) => set("mirrorMaxBytes", Number(v))}
              options={[
                { value: "0", label: "No limit" },
                { value: String(100 * 1024 * 1024), label: "100 MB" },
                { value: String(250 * 1024 * 1024), label: "250 MB" },
                { value: String(500 * 1024 * 1024), label: "500 MB" },
                { value: String(1024 * 1024 * 1024), label: "1 GB" },
              ]}
              ariaLabel="Maximum file size to download automatically"
            />
          </SettingRow>

          <SettingRow
            title="Keep free space"
            description="Pause the queue rather than fill the disk below this floor."
          >
            <Select
              value={String(draft.mirrorMinFreeBytes)}
              onValueChange={(v) => set("mirrorMinFreeBytes", Number(v))}
              options={[
                { value: String(2 * 1024 * 1024 * 1024), label: "2 GB" },
                { value: String(5 * 1024 * 1024 * 1024), label: "5 GB" },
                { value: String(10 * 1024 * 1024 * 1024), label: "10 GB" },
              ]}
              ariaLabel="Minimum free disk space"
            />
          </SettingRow>

          <SettingRow
            title="Previous versions to keep"
            description="Older versions of changed files are moved to .history. Only the newest N are kept per resource."
          >
            <Select
              value={String(draft.mirrorKeepVersions)}
              onValueChange={(v) => set("mirrorKeepVersions", Number(v))}
              options={[
                { value: "0", label: "None" },
                { value: "1", label: "1" },
                { value: "3", label: "3" },
                { value: "5", label: "5" },
              ]}
              ariaLabel="Number of previous versions to keep"
            />
          </SettingRow>

          {mirrorStats && mirrorStats.failed > 0 && (
            <SettingRow
              title="Failures"
              description={`${mirrorStats.failed} file${mirrorStats.failed === 1 ? "" : "s"} could not be downloaded.`}
            >
              <Button variant="secondary" size="sm" onClick={retryFailed}>
                Retry all
              </Button>
            </SettingRow>
          )}

          <SettingRow
            title="Verify files"
            description="Re-hash every local copy and re-download any that are missing or corrupt."
          >
            <Button variant="secondary" size="sm" onClick={verifyFiles}>
              Verify now
            </Button>
          </SettingRow>
        </section>

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
          <div className="settings-danger-group">
            <SettingRow
              title="Delete all local copies"
              description="Permanently remove every file from the mirror folder. This cannot be undone."
            >
              <Button variant="danger" size="sm" onClick={() => setShowDeleteAll(true)}>
                Delete all local copies
              </Button>
            </SettingRow>
          </div>
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
      <ConfirmDialog
        open={showDeleteAll}
        onOpenChange={setShowDeleteAll}
        title="Delete all local copies?"
        body="This permanently removes every file from the mirror folder. The preview cache is not affected. This cannot be undone."
        confirmLabel="Delete all"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          await api.mirrorDeleteAll();
          await api.mirrorStats().then(setMirrorStats);
        }}
      />
      </div>
    </div>
  );
}

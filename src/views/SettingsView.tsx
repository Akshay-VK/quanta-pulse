import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Bell, Database, HardDrive, Info, Link2, Palette, User } from "lucide-react";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { formatBytes, formatCompact } from "../lib/format";
import type { DetailProperty } from "../lib/details";
import type { AuthStatus, CacheStats, DbInfo, Settings, MirrorStats, MirrorDeleteScope, MirrorDeleteResult, MirrorDownloadProgress, Resource, TelegramStatus } from "../lib/types";
import { useMirror } from "../hooks/useMirror";
import SettingRow from "../components/SettingRow";
import { Switch } from "../components/ui/Switch";
import { Select } from "../components/ui/Select";
import { TextField } from "../components/ui/TextField";
import { TimeField } from "../components/ui/TimeField";
import { PasswordField } from "../components/ui/PasswordField";
import { Button } from "../components/ui/Button";
import { Banner } from "../components/ui/Banner";
import ConfirmDialog from "../components/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import PropertyList from "../components/PropertyList";
import { hasValidationErrors, isSettingsDirty, validateSettingsDraft } from "../lib/settingsDraft";
import { installAvailableUpdate, UpdateRelaunchError } from "../lib/updateLifecycle";

interface Props {
  settings: Settings;
  auth: AuthStatus | null;
  dbInfo: DbInfo | null;
  onSave: (settings: Settings) => Promise<void>;
  onLogout: () => Promise<void> | void;
  onRefresh: () => void | Promise<void>;
  appearance: ReactNode;
  headerActions?: ReactNode;
  resources?: Resource[];
  onController?: (controller: SettingsNavigationController | null) => void;
}

export interface SettingsNavigationController {
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  error: string | null;
  save: () => Promise<{ saved: boolean; error: string | null }>;
  discard: () => void;
}

const SECTION_ICONS = {
  appearance: Palette,
  account: User,
  notifications: Bell,
  files: HardDrive,
  integrations: Link2,
  data: Database,
  about: Info,
} as const;

const SYNC_INTERVALS = [
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "60 min" },
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
  { id: "account", label: "Account & connection" },
  { id: "notifications", label: "Notifications" },
  { id: "files", label: "Files & storage" },
  { id: "integrations", label: "Integrations" },
  { id: "data", label: "Data & recovery" },
  { id: "about", label: "About" },
] as const;

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

/** The account handle: display name when the session carries one, else the email. */
function accountName(auth: AuthStatus | null): string {
  return auth?.fullName?.trim() || auth?.email || "—";
}

export default function SettingsView({
  settings,
  auth,
  dbInfo,
  onSave,
  onLogout,
  onRefresh,
  appearance,
  headerActions,
  resources = [],
  onController,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [permission, setPermission] = useState<string>("unknown");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [showRebaseline, setShowRebaseline] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [active, setActive] = useState<string>("appearance");
  const layoutRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [mirrorStats, setMirrorStats] = useState<MirrorStats | null>(null);
  const [changingMirrorRoot, setChangingMirrorRoot] = useState(false);
  const [movingFiles, setMovingFiles] = useState(false);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTest, setTelegramTest] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<{ label: string; phase: "pending" | "success" | "error"; detail?: string } | null>(null);
  const mirror = useMirror();
  const [deleteScope, setDeleteScope] = useState<MirrorDeleteScope | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<MirrorDeleteResult | null>(null);
  const [deletingFiles, setDeletingFiles] = useState(false);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  // About / updates
  const [aboutVersion, setAboutVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "upToDate" | "available" | "downloading" | "installing" | "failed" | "restartRequired" | "checkError">("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ downloaded: number; total: number | null } | null>(null);
  const [savingAutoUpdate, setSavingAutoUpdate] = useState(false);
  const [lastUpdateCheck, setLastUpdateCheck] = useState<string | null>(() => {
    try { return localStorage.getItem("quanta-pulse-update-last-checked"); } catch { return null; }
  });
  const updateCheckRef = useRef(false);
  const updateInstallRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setDraft(settings);
  }, [settings]);

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
        setAboutVersion(await api.appVersion());
      } catch {
        setAboutVersion("unknown");
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const granted = await isPermissionGranted();
        setPermission(granted ? "granted" : "default");
      } catch {
        setPermission("unavailable");
      }
    })();
  }, []);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    function onScroll(event: Event) {
      const scroller = event.target;
      if (!(scroller instanceof HTMLElement) || (scroller !== layout && scroller !== contentScrollRef.current)) return;
      const stickyHeight = scroller === layout ? navRef.current?.offsetHeight ?? 0 : 0;
      const threshold = (layout?.getBoundingClientRect().top ?? 0) + stickyHeight + 56;
      let best: string = NAV_ITEMS[0].id;
      for (const item of NAV_ITEMS) {
        const section = document.getElementById(item.id);
        if (section && section.getBoundingClientRect().top <= threshold) best = item.id;
      }
      // Short final sections cannot always reach the scroll threshold.
      if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) best = "about";
      setActive(best);
    }
    layout.addEventListener("scroll", onScroll, true);
    return () => layout.removeEventListener("scroll", onScroll, true);
  }, []);

  const errors = useMemo(() => validateSettingsDraft(draft), [draft]);
  const dirty = useMemo(() => isSettingsDirty(draft, settings), [draft, settings]);

  /** Approved intervals plus any persisted legacy value, so nothing is clamped. */
  const syncOptions = useMemo(() => {
    const values = new Set<string>(SYNC_INTERVALS.map((option) => option.value));
    values.add(String(draft.syncIntervalMinutes));
    return [...values].map((value) => ({ value, label: `${Number(value)} min` }));
  }, [draft.syncIntervalMinutes]);

  dirtyRef.current = dirty;

  async function runOperation(label: string, operation: () => Promise<void>) {
    setOperationFeedback({ label, phase: "pending" });
    try {
      await operation();
      setOperationFeedback({ label, phase: "success" });
      return true;
    } catch (error) {
      setOperationFeedback({ label, phase: "error", detail: String(error) });
      return false;
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mac = navigator.platform.toLowerCase().includes("mac");
      const mod = mac ? e.metaKey : e.ctrlKey;
      const extraMod = mac ? e.ctrlKey : e.metaKey;
      if (e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229 ||
          e.altKey || e.shiftKey || extraMod || !mod ||
          document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sidebar.overlay')) return;
      if (e.key.toLowerCase() === "s") {
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
    setSaveError(null);
  }

  async function checkForUpdate() {
    if (updateCheckRef.current) return;
    updateCheckRef.current = true;
    setUpdateStatus("checking");
    setUpdateError(null);
    try {
      const u = await api.checkUpdate();
      const now = new Date().toISOString();
      setLastUpdateCheck(now);
      try { localStorage.setItem("quanta-pulse-update-last-checked", now); } catch {}
      try {
        if (u && u.version && u.version !== aboutVersion) {
          setUpdateVersion(u.version);
          setUpdateStatus("available");
        } else {
          setUpdateStatus("upToDate");
        }
      } finally {
        if (u) await u.close?.().catch(() => {});
      }
    } catch (err) {
      setUpdateStatus("checkError");
      setUpdateError(String(err));
    } finally {
      updateCheckRef.current = false;
    }
  }

  async function installUpdate() {
    if (updateInstallRef.current) return;
    updateInstallRef.current = true;
    setUpdateStatus("downloading");
    setUpdateProgress({ downloaded: 0, total: null });
    setUpdateError(null);
    try {
      const installed = await installAvailableUpdate((event) => {
        if (event.event === "Started") {
          setUpdateStatus("downloading");
          setUpdateProgress({ downloaded: 0, total: event.data.contentLength ?? null });
        } else if (event.event === "Progress") {
          setUpdateProgress((previous) => ({
            downloaded: (previous?.downloaded ?? 0) + event.data.chunkLength,
            total: previous?.total ?? null,
          }));
        } else if (event.event === "Finished") {
          setUpdateStatus("installing");
        }
      });
      if (installed) {
        setUpdateStatus("restartRequired");
      } else {
        setUpdateStatus("upToDate");
      }
    } catch (err) {
      if (err instanceof UpdateRelaunchError) {
        setUpdateStatus("restartRequired");
        setUpdateError(err.message);
      } else {
        setUpdateStatus("failed");
        setUpdateError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      updateInstallRef.current = false;
    }
  }

  async function restartNow() {
    try {
      await api.relaunchApp();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (savingRef.current || !dirty || hasValidationErrors(errors)) return { saved: false, error: saveError };
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      return { saved: true, error: null };
    } catch (error) {
      setSaved(false);
      const message = `Could not save settings: ${String(error)}`;
      setSaveError(message);
      return { saved: false, error: message };
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function changeAutoUpdate(value: boolean) {
    const previous = draft.updateAutoCheck ?? settings.updateAutoCheck ?? true;
    setDraft((current) => ({ ...current, updateAutoCheck: value }));
    setSavingAutoUpdate(true);
    const succeeded = await runOperation("Automatic update preference", () => onSave({ ...settings, updateAutoCheck: value }));
    if (!succeeded) setDraft((current) => ({ ...current, updateAutoCheck: previous }));
    setSavingAutoUpdate(false);
  }

  const discard = () => {
    setDraft(settings);
    setSaved(false);
    setSaveError(null);
  };

  useEffect(() => {
    onController?.({ dirty, valid: !hasValidationErrors(errors), saving, error: saveError, save, discard });
  });

  useEffect(() => () => onController?.(null), [onController]);

  async function askPermission() {
    try {
      const result = await requestPermission();
      setPermission(result === "granted" ? "granted" : result);
    } catch {
      setPermission("unavailable");
    }
  }

  const notificationsDisabled = !draft.notificationsEnabled;
  const activeDownloads: MirrorDownloadProgress[] = mirror
    ? [...mirror.downloads.values()].filter((item) => item.state === "queued" || item.state === "downloading")
    : [];
  const failedDownloads: MirrorDownloadProgress[] = mirror
    ? [...mirror.downloads.values()].filter((item) => item.state === "failed")
    : [];

  const dbProps: DetailProperty[] = [
    { label: "Database path", value: dbInfo?.path ?? "—", copy: dbInfo?.path },
    { label: "Size", value: dbInfo ? formatBytes(dbInfo.sizeBytes) || "0 B" : "—" },
    { label: "Counts", value: `${dbInfo?.courseCount ?? 0} courses · ${dbInfo?.resourceCount ?? 0} resources · ${dbInfo?.eventCount ?? 0} events` },
    { label: "Logs folder", value: dbInfo?.logDir ?? "—", copy: dbInfo?.logDir },
  ];

  async function clearCache() {
    setClearingCache(true);
    try {
      await runOperation("Clear cached files", async () => { setCacheStats(await api.clearFileCache()); });
    } finally {
      setClearingCache(false);
    }
  }

  async function pickMirrorRoot() {
    setChangingMirrorRoot(true);
    const succeeded = await runOperation("Change saved files folder", async () => {
      const stats = await api.pickMirrorRoot();
      setMirrorStats(stats);
      if (stats?.root) set("mirrorRoot", stats.root);
    });
    if (!succeeded) setChangingMirrorRoot(false);
  }

  async function openMirrorFolder() {
    await runOperation("Open saved files folder", () => api.openAppFolder("mirror", false));
  }

  async function moveFilesToNewRoot() {
    setMovingFiles(true);
    try {
      await runOperation("Move saved course files", async () => {
        await api.mirrorMoveFiles();
        setChangingMirrorRoot(false);
        await api.mirrorStats().then(setMirrorStats);
      });
    } finally {
      setMovingFiles(false);
    }
  }

  async function startBackfill() {
    await runOperation("Download all files", async () => { await api.mirrorStartBackfill(); await api.mirrorStats().then(setMirrorStats); });
  }

  async function pauseMirror() {
    await runOperation("Pause downloads", async () => { await api.mirrorPause(); await api.mirrorStats().then(setMirrorStats); });
  }

  async function resumeMirror() {
    await runOperation("Resume downloads", async () => { await api.mirrorResume(); await api.mirrorStats().then(setMirrorStats); });
  }

  async function retryFailed() {
    await runOperation("Retry failed downloads", async () => { await api.mirrorRetryFailed(); await api.mirrorStats().then(setMirrorStats); });
  }

  async function retryDownloadItem(resourceId: number) {
    if (!mirror) return;
    try {
      await mirror.retryDownload(resourceId);
      try { setMirrorStats(await api.mirrorStats()); } catch {}
    } catch (error) {
      setOperationFeedback({ label: "Retry download", phase: "error", detail: String(error) });
    }
  }

  async function verifyFiles() {
    await runOperation("Verify mirrored files", async () => { await api.mirrorVerifyFiles(); await api.mirrorStats().then(setMirrorStats); });
  }

  async function openDeleteAll() {
    setShowDeleteAll(true);
    setDeleteScope(null);
    setDeleteError(null);
    setDeleteText("");
    setDeleteResult(null);
    setDeleteLoading(true);
    try {
      setDeleteScope(await api.snapshotMirrorDeleteScope());
    } catch (error) {
      setDeleteError(String(error));
    } finally {
      setDeleteLoading(false);
    }
  }

  async function confirmDeleteAll() {
    if (deleteText !== "DELETE" || !deleteScope || deletingFiles) return;
    setDeletingFiles(true);
    setDeleteError(null);
    try {
      const result = (await api.mirrorDeleteAll(deleteScope.scopeId)) as MirrorDeleteResult | undefined;
      const normalized: MirrorDeleteResult = result ?? { removed: 0, failed: [] };
      setDeleteResult(normalized);
      try { setMirrorStats(await api.mirrorStats()); } catch {}
      if (normalized.failed.length === 0) {
        setShowDeleteAll(false);
        setDeleteScope(null);
        setDeleteText("");
        setDeleteResult(null);
      } else {
        setDeleteError(`${normalized.removed} removed, ${normalized.failed.length} failed. Retry by typing DELETE again.`);
      }
    } catch (error) {
      setDeleteError(String(error));
    } finally {
      setDeletingFiles(false);
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
      <header className="workspace-view-header">
        <strong>Settings</strong>
        {headerActions && <div className="workspace-view-header-actions">{headerActions}</div>}
      </header>
      <div className="settings-layout" ref={layoutRef}>
      <aside className="settings-sticky" ref={navRef}>
        <select
          className="settings-section-select select-trigger"
          aria-label="Settings section"
          value={active}
          onChange={(event) => {
            const id = event.currentTarget.value;
            setActive(id);
            const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
            document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
          }}
        >
          {NAV_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <nav aria-label="Settings sections">
          {NAV_ITEMS.map((item) => {
            const Icon = SECTION_ICONS[item.id];
            return (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="settings-link"
              aria-current={active === item.id ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setActive(item.id);
                // Instant under reduced motion, smooth otherwise.
                const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
                document
                  .getElementById(item.id)
                  ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
              }}
            >
              <Icon aria-hidden="true" />
              {item.label}
            </a>
            );
          })}
        </nav>
      </aside>
      <div className="settings-scroll" ref={contentScrollRef}>
      <div className="settings-content">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-section-description">Make Pulse feel like your workspace.</p>
        <section id="appearance" className="settings-section">
          <h2 className="settings-group-title">Appearance</h2>
          <p className="settings-section-description">How Pulse looks and feels.</p>
          {appearance}
        </section>

        <section id="account" className="settings-section">
          <h2 className="settings-group-title">Account &amp; connection</h2>
          <p className="settings-section-description">Your Quanta session and how Pulse monitors it.</p>
          <SettingRow title="Account" description={
            auth?.sessionExpired
              ? "Your saved files remain available. Use Reconnect in the session notice."
              : auth?.authenticated
                ? `${accountName(auth)} · ${auth.method === "sso" ? "BITS SSO" : "Password"}`
                : "Sign in to monitor Quanta."
          }>
            <span className={cx("tag", auth?.authenticated && !auth.sessionExpired ? "tag-restored" : "tag-deadline")}>
              {auth?.sessionExpired ? "Session expired" : auth?.authenticated ? "Connected" : "Signed out"}
            </span>
          </SettingRow>
          <SettingRow title="Session" description="Ends your Quanta session on this computer.">
            <Button variant="danger-ghost" size="sm" onClick={() => setShowSignOut(true)}>
              Sign out
            </Button>
          </SettingRow>
          <SettingRow title="Monitoring interval" description="How often Pulse checks Quanta.">
            <Select
              value={String(draft.syncIntervalMinutes)}
              onValueChange={(v) => set("syncIntervalMinutes", Number(v))}
              options={syncOptions}
              ariaLabel="Sync interval"
            />
          </SettingRow>
          {errors.syncIntervalMinutes && <Banner kind="error">{errors.syncIntervalMinutes}</Banner>}
          <SettingRow title="Keep running in the tray" description="Continue monitoring when the window is closed.">
            <Switch checked={draft.runInBackground} onCheckedChange={(v) => set("runInBackground", v)} ariaLabel="Run in background" />
          </SettingRow>
          <SettingRow title="Start at login" description="Open Pulse when you sign in to your computer.">
            <Switch checked={draft.launchAtLogin} onCheckedChange={(v) => set("launchAtLogin", v)} ariaLabel="Launch at login" />
          </SettingRow>
          <SettingRow title="Timezone" description="Dates are grouped by your local calendar days.">
            <span className="muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
          </SettingRow>

        </section>

        <section id="notifications" className="settings-section">
          <h2 className="settings-group-title">Notifications</h2>
          <p className="settings-section-description">Quiet by default. Choose what is worth interrupting you for.</p>
          <SettingRow
            title="New material"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={
              notificationsDisabled
                ? "Turn on notifications to change these"
                : "New files posted on Quanta."
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
            title="Updated material"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled ? undefined : "Files that changed after you saw them."}
          >
            <Switch
              checked={draft.notifyUpdated}
              onCheckedChange={(v) => set("notifyUpdated", v)}
              disabled={notificationsDisabled}
              ariaLabel="Updated files"
            />
          </SettingRow>
          <SettingRow
            title="Deadline reminders"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled ? undefined : "Desktop notifications for upcoming deadlines."}
          >
            <Switch
              checked={draft.notifyDeadlines}
              onCheckedChange={(v) => set("notifyDeadlines", v)}
              disabled={notificationsDisabled}
              ariaLabel="Deadlines"
            />
          </SettingRow>
          <SettingRow
            title="Scan failures and incomplete scans"
            controlClassName={notificationsDisabled ? "dimmed" : undefined}
            description={notificationsDisabled
              ? "Turn on notifications to change this"
              : "Show a generic system alert when a scan finishes with incomplete results."}
          >
            <Switch
              checked={draft.notifyScanFailures}
              onCheckedChange={(v) => set("notifyScanFailures", v)}
              disabled={notificationsDisabled}
              ariaLabel="Scan failures and incomplete scans"
            />
          </SettingRow>
          <SettingRow title="Notification permission">
            <div className="settings-inline">
              <span className={cx("tag", permission === "granted" ? "tag-restored" : "tag-note")}>{permissionLabel(permission)}</span>
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
          <SettingRow title="Reminder window" description="Notify about deadlines within this many hours.">
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
          <SettingRow title="Enable notifications" description="Requires permission from your system.">
            <Switch checked={draft.notificationsEnabled} onCheckedChange={(v) => set("notificationsEnabled", v)} ariaLabel="Enable notifications" />
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
        </section>

        <section id="files" className="settings-section">
          <h2 className="settings-group-title">Files &amp; storage</h2>
          <p className="settings-section-description">Manage the copies Pulse saves on this device.</p>
          <SettingRow
            title="Saved files folder"
            description="Where your saved course files are stored. Changing this does not move existing files unless you choose to move them."
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
                everything from the current Saved files folder and verify it, or start fresh?
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
            description="Keep this many older copies of each changed file in .history. The current saved copy is kept separately. Saved files are not removed by age."
          >
            <Select
              value={String(draft.mirrorKeepVersions)}
              onValueChange={(v) => set("mirrorKeepVersions", Number(v))}
              options={[...new Set([0, 1, 3, 5, settings.mirrorKeepVersions])]
                .filter((count) => Number.isInteger(count) && count >= 0 && count <= 10)
                .sort((a, b) => a - b)
                .map((count) => ({ value: String(count), label: count === 0 ? "None" : String(count) }))}
              ariaLabel="Number of previous versions to keep"
            />
          </SettingRow>
          {errors.mirrorKeepVersions && <Banner kind="error">{errors.mirrorKeepVersions}</Banner>}

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

          {(activeDownloads.length > 0 || failedDownloads.length > 0) && (
            <div className="settings-download-list">
              <h3 className="settings-subgroup-title">Downloads</h3>
              {[...activeDownloads, ...failedDownloads].map((item) => {
                const file = resources.find(resource => resource.id === item.resourceId);
                const percent = item.bytesTotal ? Math.min(100, Math.floor(item.bytesDone / item.bytesTotal * 100)) : null;
                return (
                  <div key={item.resourceId} className="settings-download-row">
                    <span className="settings-download-name" title={file?.title}>{file?.title ?? `Resource ${item.resourceId}`}</span>
                    {item.state === "failed" ? (
                      <>
                        <span className="tag tag-removed" title={item.error ?? undefined}>Failed</span>
                        <Button variant="secondary" size="sm" onClick={() => void retryDownloadItem(item.resourceId)}>Retry</Button>
                      </>
                    ) : (
                      <>
                        <progress aria-label={file?.title ?? "Download progress"} value={percent ?? undefined} max={100} />
                        <span className="mono muted">{percent != null ? `${percent}%` : formatBytes(item.bytesDone) || "Queued"}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <SettingRow
            title="Verify files"
            description="Re-hash saved course files and re-download any that are missing or corrupt."
          >
            <Button variant="secondary" size="sm" onClick={verifyFiles}>
              Verify now
            </Button>
          </SettingRow>
        </section>

        <section id="integrations" className="settings-section">
          <h2 className="settings-group-title">Integrations</h2>
          <p className="settings-section-description">Send Pulse updates to other places.</p>
          <SettingRow
            title="Forward to Telegram"
            description="Send new material to your own bot chat as the file itself, not a link. The six categories under Notifications decide which events go out."
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
            <PasswordField
              value={draft.telegramBotToken ?? ""}
              onChange={(e) => set("telegramBotToken", e.target.value || null)}
              placeholder="123456789:AA…"
              aria-label="Bot token"
              autoComplete="off"
              error={errors.telegramBotToken}
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
              error={errors.telegramChatId}
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

        <section id="data" className="settings-section">
          <h2 className="settings-group-title">Data &amp; recovery</h2>
          <p className="settings-section-description">Manage what Pulse keeps on this device.</p>
          <SettingRow
            title="Preview cache"
            description={cacheStats ? `${formatBytes(cacheStats.totalBytes) || "0 B"} of generated previews.` : "Temporary copies used for in-app previews."}
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
                Clear cache
              </Button>
            </div>
          </SettingRow>
          <SettingRow title="Reset all baselines" description="The next scan records existing material silently. History is kept.">
            <Button variant="secondary" size="sm" onClick={() => setShowRebaseline(true)}>Reset baselines…</Button>
          </SettingRow>
          <div className="settings-danger-group">
            <SettingRow
              title="Delete saved files"
              description="Remove local copies from this device. Files on Quanta stay available."
            >
              <Button variant="danger" size="sm" onClick={() => void openDeleteAll()}>
                Delete saved files…
              </Button>
            </SettingRow>
          </div>
          <PropertyList properties={dbProps} />
          <p className="settings-note">
            Session cookies stay in memory and are not saved. Times are shown in your local timezone.
          </p>
        </section>

        <section id="about" className="settings-section">
          <h2 className="settings-group-title">About</h2>
          <p className="settings-section-description">Quanta Pulse</p>
          {updateStatus === "available" && updateVersion && (
            <div className="settings-banner is-info" role="status">
              <Info aria-hidden="true" />
              <span>Version {updateVersion} is available.</span>
              <div className="settings-inline">
                <Button variant="primary" size="sm" onClick={() => void installUpdate()} disabled={updateInstallRef.current}>
                  Download
                </Button>
              </div>
            </div>
          )}
          {updateStatus === "downloading" && (
            <div className="settings-banner" role="status">
              <span>Downloading {updateVersion ?? ""}…</span>
              <progress aria-label="Update download progress" value={updateProgress?.total ? updateProgress.downloaded : undefined} max={updateProgress?.total ?? 1} />
              <span className="mono muted">
                {updateProgress?.total
                  ? `${Math.min(100, Math.floor(updateProgress.downloaded / updateProgress.total * 100))}%`
                  : formatBytes(updateProgress?.downloaded ?? 0)}
              </span>
            </div>
          )}
          {updateStatus === "installing" && (
            <div className="settings-banner" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>Installing…</span>
            </div>
          )}
          {updateStatus === "failed" && (
            <div className="settings-banner is-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <strong>Update failed.</strong>
              {aboutVersion && <span>Pulse kept version {aboutVersion}.</span>}
              {updateError && <span>{updateError}</span>}
              <div className="settings-inline">
                <Button variant="primary" size="sm" onClick={() => void installUpdate()}>
                  Retry
                </Button>
              </div>
            </div>
          )}
          {updateStatus === "restartRequired" && (
            <div className="settings-banner is-success" role="status">
              <strong>Update ready.</strong>
              <span>Restart Pulse to finish installing {updateVersion ?? ""}.</span>
              {updateError && <span>{updateError}</span>}
              <Button variant="primary" size="sm" onClick={() => void restartNow()}>
                Restart now
              </Button>
            </div>
          )}
          {(updateStatus === "upToDate" || updateStatus === "checkError") && (
            <div className={cx("settings-banner", updateStatus === "checkError" && "is-error")} role={updateStatus === "checkError" ? "alert" : "status"}>
              <span>{updateStatus === "upToDate" ? "Up to date" : `Check failed${updateError ? `: ${updateError}` : ""}`}</span>
            </div>
          )}
          <SettingRow title="Version">
            <span className="mono">{aboutVersion || "—"}</span>
          </SettingRow>
          <SettingRow
            title="Automatic update checks"
            description="Check for new versions in the background."
          >
            <Switch
              checked={draft.updateAutoCheck ?? settings.updateAutoCheck ?? true}
              onCheckedChange={(v) => void changeAutoUpdate(v)}
              disabled={savingAutoUpdate}
              ariaLabel="Check for updates automatically"
            />
          </SettingRow>
          <SettingRow
            title="Check for updates"
            description={lastUpdateCheck ? `Last checked ${formatCompact(lastUpdateCheck)}` : "Never checked."}
          >
            <Button
              variant="secondary"
              size="sm"
              loading={updateStatus === "checking"}
              disabled={updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing"}
              onClick={() => void checkForUpdate()}
            >
              {updateStatus === "checking" ? "Checking…" : "Check for updates"}
            </Button>
          </SettingRow>
          <SettingRow title="Open backups folder">
            <Button variant="ghost" size="sm" onClick={() => void api.openAppFolder("backups")}>
              Open folder
            </Button>
          </SettingRow>
        </section>

        {operationFeedback && (
          <p className="settings-note" role={operationFeedback.phase === "error" ? "alert" : "status"} aria-live={operationFeedback.phase === "error" ? "assertive" : "polite"}>
            {operationFeedback.phase === "pending" ? `${operationFeedback.label}…` : operationFeedback.phase === "success" ? `${operationFeedback.label} completed.` : `${operationFeedback.label} failed: ${operationFeedback.detail}`}
          </p>
        )}
      </div>
      </div>
      </div>
      {(dirty || saved) && (
        <div className={cx("save-bar", saveError && "is-error")}>
          <div className="save-copy" role={saveError ? "alert" : "status"} title={saveError ?? undefined}>
            {saveError ? (
              <>
                <AlertCircle aria-hidden="true" />
                <span><strong>Couldn’t save.</strong> Your changes are kept.</span>
                <span className="sr-only">{saveError}</span>
              </>
            ) : (
              <>
                <span className={cx("settings-dot", saved && !dirty && "ok")} aria-hidden="true" />
                <strong>{dirty ? "Unsaved changes" : "Settings saved"}</strong>
              </>
            )}
          </div>
          {dirty && (
            <div className="settings-inline">
              <Button variant="secondary" size="sm" onClick={() => setShowDiscard(true)} disabled={saving}>Discard</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={() => void save()} disabled={hasValidationErrors(errors)}>
                {saving ? "Saving…" : saveError ? "Retry" : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showDiscard}
        onOpenChange={setShowDiscard}
        title="Discard changes?"
        body="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          discard();
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
      <Dialog
        open={showDeleteAll}
        onOpenChange={(next) => {
          if (!next && !deletingFiles) {
            setShowDeleteAll(false);
            setDeleteScope(null);
            setDeleteError(null);
            setDeleteText("");
            setDeleteResult(null);
          }
        }}
        role="alertdialog"
        label="Delete all saved files?"
        className="dialog-confirm dialog-confirm-scope"
        initialFocusRef={cancelDeleteRef}
      >
        <h2 className="dialog-title">Delete all saved files?</h2>
        <div className="dialog-body">
          <p>Files on Quanta, History and your baseline stay available. Deletion is permanent.</p>
          {deleteLoading && <p>Loading deletion scope…</p>}
          {deleteScope && (
            <p>
              This removes {deleteScope.count} local {deleteScope.count === 1 ? "copy" : "copies"}{mirrorStats?.root && <> from <span className="mono">{mirrorStats.root}</span></>}.
            </p>
          )}
          {deleteResult && deleteResult.failed.length > 0 && (
            <ul>
              {deleteResult.failed.map((failure) => (
                <li key={`${failure.resourceId}-${failure.path}`}>
                  {failure.path}: {failure.error}
                </li>
              ))}
            </ul>
          )}
          {deleteError && <p role="alert">{deleteError}</p>}
          <label className="settings-inline" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span>Type DELETE to confirm</span>
            <input
              className="text-field"
              aria-label="DELETE"
              placeholder="DELETE"
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
              disabled={deletingFiles}
            />
          </label>
        </div>
        <div className="dialog-footer">
          <button
            ref={cancelDeleteRef}
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (deletingFiles) return;
              setShowDeleteAll(false);
              setDeleteScope(null);
              setDeleteError(null);
              setDeleteText("");
              setDeleteResult(null);
            }}
            disabled={deletingFiles}
          >
            <span className="btn-label">Cancel</span>
          </button>
          <Button
            variant="danger"
            className="dialog-primary"
            loading={deletingFiles}
            disabled={deletingFiles || deleteLoading || deleteText !== "DELETE" || !deleteScope}
            onClick={() => void confirmDeleteAll()}
          >
            Delete saved files
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

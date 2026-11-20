# 2026-11-14: Settings recovery and updater lifecycle

## Scope and ownership

The Settings/recovery slice preserves the integrated appearance slot and its immediate persistence, while the operational settings remain one validated draft behind the existing app dirty-navigation guard. Appearance edits do not mark that draft dirty. The section navigation now follows the approved seven groups: Appearance; Account & connection; Notifications; Files & storage; Integrations; Data & recovery; About. Monitoring controls live under Account & connection, and Telegram remains under Integrations.

Files & storage uses “Saved files folder” and “saved course files” for durable copies. The preview cache is described and cleared separately; the destructive confirmation names the saved-files effect and confirms it leaves preview cache and course history intact. Data & recovery retains database facts, baseline rebuild, and deletion controls.

Session recovery has one Reconnect action in the session banner. Settings keeps an account status row that points users to that action and states that saved files stay accessible. Pending login explains how closing the Quanta sign-in window cancels the attempt; a cancelled login can retry; only the backend `connected` result displays verified success. The existing auth algorithm, scheduler pause, and expiry notification behavior remain owned by the auth/sync modules.

Update installation is shared by Settings and the shell notification through `src/lib/updateLifecycle.ts`: it rechecks, asks the backend to quiesce work, downloads/installs, releases the update resource, then requests relaunch only after installation resolves. Prepare/install errors surface as “Update failed” and Settings allows a fresh manual check. No-update results do not prepare or relaunch. Tauri's Windows installer exits automatically; other desktop platforms request an explicit relaunch, and a relaunch failure says that the update installed and the app should be closed and reopened. Manual checks use a 30-second request timeout in the API wrapper; the Rust automatic scheduler has its own 30-second timeout and continues its six-hour loop after a check error.

## Installed 0.2.0 updater diagnosis

The provided Windows log records a failure while sending the request to the configured GitHub `latest.json` endpoint. This is a check/network-request failure. It does not show that `prepare_for_update`, download, signature verification, or installation ran, so the updater lifecycle fix is not the cause of that particular request error.

The configured feed and signing key are present in `src-tauri/tauri.conf.json`; release configuration validation requires both, and updater artifact creation is enabled. The published 0.3.0 manifest has version `0.3.0` and signed `windows-x86_64` and `windows-x86_64-nsis` entries, including the configured NSIS target. This is newer than the installed `0.2.0` version. A read-only request from this WSL environment returned HTTP 200 for both the configured `releases/latest/download/latest.json` URL and the pinned `releases/download/v0.3.0/latest.json` URL on 2026-11-14. The GitHub Releases API also returned 200. The redirect response and its credentials were not retained in the report.

The current endpoint therefore is not globally unavailable at the time of this check. The supplied installed-app error remains consistent with a transient or Windows-environment-specific network, proxy, DNS, TLS, or transport problem; the message does not distinguish among them. The pinned feed URL works as a diagnostic but is not a suitable permanent replacement for a moving `latest` feed, so configuration was not changed. [Tauri 2 updater documentation](https://v2.tauri.app/plugin/updater/) describes static JSON feeds, per-check request timeouts, and the Windows installer exit behavior. No signature validation was disabled and no updater artifact was installed.

The earlier 0.2.0 executable cannot receive the 0.3.0 lifecycle fix retroactively. That build still has the pre-fix behavior which sets scheduler shutdown during update preparation; that defect matters only if preparation is reached and a later install step fails. The recorded request failure occurs before that path. If the old executable continues to receive a request error, it cannot use its in-app updater until its network request succeeds; a signed manual update is then needed to move it onto code containing the fix.

## Verification and evidence

- Frontend tests cover the seven Settings groups, section selection, existing draft/navigation protection, single-message reconnect feedback, cancelled-login retry, updater check bounds, prepare/install failures, retries, update-resource cleanup, and relaunch ordering.
- Windows Rust tests cover the cooperative update cancellation request leaving scheduler shutdown unset and the automatic check timeout remaining finite.
- Screenshots use an external local fixture adapter on port 1443 and illustrative student/course records. They are not production data or live LMS/auth/updater results: `/tmp/quanta-ui-settings-updater-20261114/settings-sections.png`, `settings-files-storage.png`, `settings-recovery.png`, and `settings-recovery-result.png`.
- The shared preview browser could not start because `libnspr4.so`, `libnss3.so`, and `libnssutil3.so` were missing. The Playwright fallback used the existing extracted browser libraries from `/tmp/bzzz-ui64-browser/libs/usr/lib/x86_64-linux-gnu`; screenshots report zero page errors.
- Feature discovery ideas remain deferred and were not implemented: (1) a local personal study queue, (2) scoped “prepare for offline” bulk saves, and (3) local notes/tags. They remain follow-up ideas subject to their original privacy, data-truth, and scope notes.

## Limits

No packaged app was launched, no installed executable was overwritten, no release was published, and no live update was downloaded or installed. WSL endpoint reachability does not prove that the installed Windows network can reach the endpoint. The existing updater's check and install were validated through unit/UI seams, not against a live Tauri runtime. The wider specification's Inbox, agenda, shared material-action, and native acceptance slices remain outside this worktree's Settings/updater ownership.

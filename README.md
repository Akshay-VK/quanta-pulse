# Quanta Pulse

A minimal, local-first desktop app that watches **BITS Pilani Quanta** (Moodle) for
you. It signs in to Quanta, discovers every course and resource you can access,
checks once an hour, and surfaces new uploads, announcements, updated material,
and deadlines — with **accurate upload timestamps** and native notifications.

Quanta Pulse is a native desktop app: Tauri 2 + Rust on the backend, React +
TypeScript on the frontend and SQLite for local state. Session material stays
in memory for the current run. There is no server, no analytics, and no telemetry.

---

## Installation and build (quick start)

Choose the instructions for your operating system. These steps build the app from source; a prebuilt installer is not currently provided here.

### Windows 10/11

**Prerequisites**

- [Node.js 18 or newer](https://nodejs.org/)
- [Rust (stable)](https://www.rust-lang.org/tools/install)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** selected
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already present on Windows 10/11)
- Git for Windows, if Git is not already installed

**Build**

Open PowerShell or Windows Terminal and run:

```powershell
# Install npm if it is not already installed (with Node.js, via the official installer)
winget install OpenJS.NodeJS.LTS

# Clone the repository and enter it
git clone https://github.com/advayvguy/quanta-pulse.git
cd quanta-pulse

# Install frontend dependencies
npm install

# Build a Windows installer (NSIS)
npx tauri build --bundles nsis
```

The installer should be in `src-tauri/target/release/bundle/nsis/`. If the build reports a missing Windows build tool, install the prerequisites above and reopen the terminal. `npm run app:build` is the macOS script; it calls a Bash/DMG packaging script and is not the Windows build command.

To run the app locally during development, use `npm run app:dev` from the repository directory.

### macOS

**Prerequisites:** Node.js 18 or newer, Rust (stable), and Xcode Command Line Tools.

```bash
# Install npm if needed (Node.js includes npm)
brew install node

# Clone the repository and enter it
git clone https://github.com/advayvguy/quanta-pulse.git
cd quanta-pulse

# Install frontend dependencies
npm install

# Build the .app and .dmg
npm run app:build
```

The app bundle and disk image are written under `src-tauri/target/release/bundle/`.

### Create a shortcut (optional)

You can create a shortcut so you do not need to repeat the terminal commands:

- **Windows:** after building, open `src-tauri\target\release\bundle\nsis\` and run the installer. Once installed, find **Quanta Pulse** in the Start menu, right-click it, and choose **Pin to Start**, **Pin to taskbar**, or **Open file location** to create a desktop shortcut. You can also right-click the installed app shortcut and choose **Send to → Desktop (create shortcut)** where available.
- **macOS:** open `src-tauri/target/release/bundle/macos/`, then drag `Quanta Pulse.app` to Applications. To make a Dock shortcut, open the app and right-click its Dock icon → **Options → Keep in Dock**.

For development, you can also save the commands in a `.ps1` PowerShell script (Windows) or `.command` shell script (macOS) and run that file when needed. Building still requires the relevant development tools to be installed.

---

## Highlights

- **Accurate timestamps.** Upload/publication dates are taken from Quanta. If
  Quanta does not expose one, the row says **"Upload date unavailable"** — the
  time Quanta Pulse happened to notice a file is never shown as its upload time.
  Date-only values are never given a fabricated time of day.
- **Local-first and private.** Session cookies stay in memory and are not persisted.
  Passwords are never written to the database, logs, or the repository, and are
  zeroed from memory immediately after a sign-in attempt.
- **Reliable hourly monitoring.** A backend scheduler (not a browser timer) runs
  scans, survives sleep/wake, recovers after restart, backs off on failure, and
  never runs two scans at once.
- **Honest reporting.** A partial scan is reported as partial. A single failed
  request never looks like a deletion — a resource must miss repeatedly before
  it is marked unavailable, and history is never erased.
- **Quiet, dense UI.** A white dashboard with one accent colour, compact rows,
  filters, search, and a daily digest. On macOS, a monochrome menu-bar icon keeps monitoring visible while the window is closed.

---

## Requirements

- **macOS:** macOS 10.15+ (Apple Silicon first; Intel works too), Node.js 18+, Rust (stable), and Xcode Command Line Tools.
- **Windows:** Windows 10/11, Node.js 18+, Rust (stable), Microsoft C++ Build Tools with **Desktop development with C++**, and the WebView2 Runtime.
- For development on either platform, install dependencies with `npm install` and launch with `npm run app:dev`.

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run app:dev` | Run the desktop app in development |
| `npm run app:build` | Produce a production `.app` (and `.dmg`) |
| `npm run build` | Type-check + bundle the frontend only |
| `npm run test` | Frontend unit tests (Vitest) |
| `npm run lint` | ESLint |
| (in `src-tauri`) `cargo test` | Backend unit tests |
| (in `src-tauri`) `cargo check` | Type-check the Rust backend |

## Building a distributable app

### macOS

```bash
npm run app:build
```

Outputs land in `src-tauri/target/release/bundle/`:

- `macos/Quanta Pulse.app` — the application bundle
- `dmg/Quanta Pulse_<version>_<arch>.dmg` — a compressed disk image

`app:build` first compiles the app bundle, then creates the DMG with
`scripts/make-dmg.sh` (a small `hdiutil` wrapper). To re-create only the DMG
after a build, run `npm run app:build:dmg`.

### Windows

Run this from PowerShell or Windows Terminal in the repository root:

```powershell
npm install
npx tauri build --bundles nsis
```

The NSIS installer is expected under `src-tauri/target/release/bundle/nsis/`.
The macOS-specific `npm run app:build` script should not be used on Windows
because it invokes `scripts/make-dmg.sh`.

The macOS build is unsigned unless you provide signing credentials (see
[Packaging & distribution](#packaging--distribution)). Windows installer signing
is not configured by this repository's current instructions.

---

## Signing in

Quanta is a Moodle site whose web services (REST/token API) are **disabled**, so
Quanta Pulse uses your authenticated web session and parses the rendered pages.
There is no API key involved. Two legitimate sign-in paths are supported and you
should use whichever your account requires:

1. **Direct sign-in** — enter your BITS email and password. The credentials are
   POSTed, over HTTPS, only to
   `https://quanta.bits-pilani.ac.in/login/index.php` (with the page's CSRF
   token). This works for accounts that have a Moodle password.

2. **Sign in with BITS Google (SSO)** — if your account uses BITS Google
   (SAML2), this opens Google's **official** sign-in page in a dedicated window.
   Complete sign-in (including any MFA) there. Quanta Pulse never automates,
   proxies, or bypasses MFA; it only reads the `MoodleSession` cookie once you
   are back on the Quanta origin.

After a successful sign-in the app immediately runs a **baseline scan**: it
records everything that currently exists *without* notifying you about any of
it, so a fresh install never floods you with alerts for old material. Changes
found on later scans are what get reported.

### What is stored

- A `MoodleSession` cookie stays in memory for the current app session and is
  never saved. Sign in again after restarting Quanta Pulse; this avoids macOS
  Keychain access and its password prompt.
- Course/resource metadata and change history, in a local SQLite database at
  `~/Library/Application Support/com.quantapulse.desktop/quanta-pulse.sqlite`.

### Signing out

**Settings → Sign out** drops the in-memory session and clears the scheduled
scan. Your discovered history is left intact.

---

## How monitoring works

- A scheduler inside the app process checks every 30 seconds whether the next
  scan is due (default interval: **60 minutes**, configurable in Settings).
- Manual **Sync now** runs the same scan immediately. Scans never overlap; a
  manual request while a scan is running is ignored.
- If the Mac sleeps through a scheduled time, the wall-clock comparison means
  the scan runs promptly after wake (monotonic timers would not fire).
- Network failures use exponential backoff (30s → capped at 30 min) and never
  hammer Quanta. An expired session **stops** crawling until you sign in again.
- Missing resources are only marked **Unavailable** after two consecutive
  complete scans that no longer list them; if any course failed to scan, nothing
  is marked missing.

### Statuses you will see

| Status | Meaning |
| --- | --- |
| **Available** | Seen normally on the most recent complete scan |
| **Temporarily inaccessible** | A transient fetch problem; retained and retried |
| **Authentication required** | Session expired — sign in again |
| **Unavailable** | Absent from repeated complete scans |
| **Not recently verified** | Not seen on the last scan, but not yet confirmed missing |

---

## The dashboard

The main window shows an activity feed, newest first, grouped by day. Each row
reads `Resource title | Course · type · uploaded <time>` with a `NEW`,
`UPDATED`, `DEADLINE`, or `UNAVAILABLE` label. Click any row to open the
original resource in your browser.

- **Filters**: All / New / Updated / Deadlines / Unavailable, plus a course
  filter and free-text search.
- **Summary counts** across the top.
- When nothing has changed you will see **"You're all caught up."**
- Secondary views: **Courses** (a per-course resource hub), **Resources** (full,
  sortable inventory), **History** (change log + scan log), **Daily** (a per-day
  digest), and **Settings**.

### Timestamp honesty

- Times are displayed in your **Mac's local timezone** (e.g.
  `11 Oct 2026, 14:35`), with a relative hint like `2 hours ago`.
- The original stored value is preserved; only the display is localised.
- A **detection** time is never labelled as an **upload** time. When no
  upload/publication time exists, the row explicitly says
  *"Upload date unavailable."*

---

## Menu bar and background operation

Quanta Pulse puts a monochrome **template icon** in the menu bar with:

- Open Quanta Pulse
- Sync now
- Last synced / New items / Monitoring status (read-only)
- Settings…
- Quit Quanta Pulse

**Closing the window** does not quit the app when *"Keep running when the window
is closed"* is enabled (default on) — monitoring continues in the menu bar.
**Quit** actually exits. **Launch at login** is available in Settings and only
takes effect with your consent (it registers a Login Item).

### Notifications

- Native macOS notifications, with a permission prompt and a **Send test
  notification** button in Settings.
- Per-category toggles: new uploads, announcements, updated material, deadlines,
  availability issues, and authentication reminders.
- Duplicate suppression: each distinct change is notified at most once.
- Configurable **quiet hours** and a **deadline reminder window** (in hours).
- Clicking a notification opens the window; the unread count is shown in the
  sidebar and can be cleared with **Mark all as read**.

> **Delivery is best-effort and depends on two things:** the app must be running
> (monitoring stops if you fully quit), and macOS notification permission must be
> granted. If either is missing, a change is still recorded in the app — only the
> banner is skipped.

---

## Settings reference

| Setting | Default | Notes |
| --- | --- | --- |
| Sync interval | 60 min | 15 min – 24 h |
| Keep running when closed | on | Continue in the menu bar |
| Launch at login | off | Registers a Login Item |
| Notifications + categories | on | Requires permission |
| Deadline reminder window | 48 h | 1 h – 30 days |
| Quiet hours | off | Pauses delivery between local times |
| Crawl limits | conservative | Bounds courses, resources, detail fetches, concurrency, timeouts |

---

## Privacy & security

- **No analytics, telemetry, or cloud services.** Nothing leaves your Mac except
  authenticated requests to `quanta.bits-pilani.ac.in` (and, for SSO, Google's
  official IdP page that Quanta redirects you to).
- Credentials go **only** to the official Quanta HTTPS endpoint. They are never
  stored or logged, and are cleared from memory after the attempt.
- Session material lives only in process memory; the SQLite database holds metadata
  only.
- Logs are written to `~/Library/Application Support/com.quantapulse.desktop/logs/`
  and pass through a redactor that strips anything resembling a cookie, token,
  or password before writing. The rolling file name uses the **UTC** date, so for
  a few hours after local midnight it can name the file with the previous local
  day; this is cosmetic and does not affect log contents. A single
  `ui ready: mounted=… rootChildren=… chars=… brand=…` line is written once per
  launch as a lightweight startup diagnostic — it reports only DOM structure
  (counts/booleans), never user content.
- The local command surface does not expose an unauthenticated API for arbitrary
  commands. The one URL-accepting command opens **http/https only** (no
  `file:`/`javascript:`/other schemes), protecting against SSRF-style abuse.
- The repository `.gitignore` excludes databases, logs, cookies, profiles,
  secrets, and build output.

---

## Packaging & distribution

A successful `npm run app:build` produces an unsigned app and DMG. To distribute
outside your own Mac, sign and notarize it. **These steps require credentials
(an Apple Developer account) and are not performed by the plain build.** Replace
the identity and profile with your own:

```bash
# 1. Sign the app (Developer ID Application certificate)
codesign --deep --force --options runtime \
  --sign "Developer ID Application: Your Name (TEAMID)" \
  "src-tauri/target/release/bundle/macos/Quanta Pulse.app"

# 2. Create a DMG (the build already produces one; to re-create manually)
hdiutil create -volname "Quanta Pulse" -srcfolder \
  "src-tauri/target/release/bundle/macos/Quanta Pulse.app" \
  -ov -format UDZO "Quanta Pulse.dmg"

codesign --sign "Developer ID Application: Your Name (TEAMID)" "Quanta Pulse.dmg"

# 3. Notarize and staple
xcrun notarytool submit "Quanta Pulse.dmg" \
  --keychain-profile "AC_PASSWORD" --wait
xcrun stapler staple "Quanta Pulse.app"
xcrun stapler staple "Quanta Pulse.dmg"
```

Tauri can also do signing/notarization during the build when `APPLE_CERTIFICATE`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are
set in the environment; the plain build does not require them.

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Direct sign-in fails, mentions Google | Use **Sign in with BITS Google**; SAML2 accounts have no Moodle password. |
| Session expired banner | Session idle timeouts are short; sign in again. Monitoring pauses until you do. |
| No notifications | Settings → grant permission, keep the app running, check per-category toggles and quiet hours. |
| A resource shows "Upload date unavailable" | Quanta does not expose an upload/publish time for it; Pulse will not invent one. |
| Something looks missing | Confirm on a later sync; it takes two clean scans to mark a resource Unavailable. |
| Where is my data? | Settings → Data shows the DB and log paths. |

---

## Project layout

```
src/                     React + TypeScript UI
  lib/                   pure, unit-tested display/filter logic
  components/ views/     UI building blocks and screens
src-tauri/               Rust backend
  src/quanta/            authenticated client, HTML parsers, crawler
  src/sync/              change detection, scan engine, hourly scheduler
  src/auth.rs            credential/SSO sign-in
  src/db.rs              SQLite schema and access
  migrations/            SQL schema
scripts/                 icon generator and DMG packaging helper
tests/                   frontend unit tests
```

Tests use mocked fixtures only — **no real BITS credentials** are ever needed or
included.

---

## Credits

Quanta Pulse started as a fork of [advayvguy/quanta-pulse](https://github.com/advayvguy/quanta-pulse)
by **Advay Singh**, whose original tracker this project builds on. Thank you to the
upstream author for the initial implementation.

> **Licensing note:** this repository currently ships **no licence file**, so
> redistribution rights are unclear. Add an explicit licence before publishing
> binaries or accepting contributions.

## Limitations

- Quanta exposes no upload timestamp for some items; those honestly read
  *"Upload date unavailable."*
- Because there is no public API, discovery depends on Quanta's current page
  markup. Parsers are tolerant and a markup change degrades gracefully (a course
  is reported as failed rather than silently emptied).
- Notification banners require the app to be running and permission granted.
- A fully signed/notarized build requires your own Apple Developer credentials.

Quanta Pulse is an independent tool and is not affiliated with BITS Pilani.

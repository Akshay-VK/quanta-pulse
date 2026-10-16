# Quanta Pulse — Project, UI, UX & Style Guide

Detailed companion to `AGENTS.md`. Covers what the app is, how the code is
laid out, how the UI behaves, and the design system behind it.

## 1. What it is

A native desktop tracker for the BITS Pilani **Quanta** (Moodle) LMS. It signs
in as the user, discovers their courses and resources, then checks for new
uploads / updates and surfaces them. Everything is local: SQLite on disk, no
server, no account, no analytics, no telemetry. Session cookies live in
process memory only.

Product principles that show up repeatedly in code and copy:

- **Never invent data.** If Quanta does not expose an upload date, the UI says
  "Upload date unavailable" rather than substituting a detection time
  (`lib/format.ts:describeUpload`).
- **The first scan is a baseline.** It records everything as known and reports
  nothing, so a fresh install never floods the user with "new" items.
- **One canonical source per fact.** Dashboard counts, History rows, and the
  Calendar all read the same `change_events` rows through `lib/events.ts`, so
  numbers and colours cannot drift.
- **Colour is never the only signal.** Every semantic colour is paired with a
  text label or icon.

## 2. Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust 2021, `rust-version = 1.77`) |
| UI | React 18 + TypeScript 5.7, built by Vite 6 |
| Storage | `rusqlite` (bundled SQLite), migrations via `include_str!` |
| Scraping | `reqwest` + `scraper` (HTML → models) |
| Tests | Vitest + jsdom (`tests/**/*.test.ts(x)`) |
| Logging | `tracing` with a redacting file writer |
| Toolchain | Node 18+ (CI uses 22) |

Window: 1040×720 default, min 820×540, resizable, per
`src-tauri/tauri.conf.json`. Dev URL `http://localhost:1420`; bundled app
loads `../dist`.

## 3. Directory layout

```
quanta-pulse/
├─ index.html                 Vite entry
├─ src/
│  ├─ main.tsx                React mount; sets first-paint theme
│  ├─ App.tsx                 shell: auth gate, nav, data load, event bridge
│  ├─ styles.css              the entire design system (single file)
│  ├─ lib/                    pure, unit-tested logic
│  │  ├─ api.ts               ONLY place the frontend calls invoke()
│  │  ├─ types.ts             TS mirror of Rust models (camelCase)
│  │  ├─ format.ts            timestamps, bytes, relative labels
│  │  ├─ filter.ts            feed filtering, sorting, day grouping
│  │  ├─ events.ts            change-event meta, calendar day math
│  │  ├─ open.ts              canonical "open this resource" URL rules
│  │  ├─ filetype.ts          resource type → colour tone
│  │  ├─ sectionPath.ts       section path → display string
│  │  ├─ courseTree.ts        build navigable folder tree from paths
│  │  ├─ courseLibrary.ts     per-course grouping/sorting/filtering
│  │  └─ preview.ts           client mirror of the in-app preview decision
│  ├─ components/             presentational pieces
│  └─ views/                  one file per top-level screen
├─ src-tauri/
│  ├─ src/                    Rust modules (see §8)
│  ├─ migrations/0001_init.sql
│  ├─ capabilities/default.json
│  └─ tauri.conf.json
├─ tests/                     Vitest suites (see §9)
├─ scripts/                   generate-icon.mjs, make-dmg.sh
└─ .github/workflows/         build-macos.yml, build-windows.yml
```

## 4. Frontend architecture

### App shell (`src/App.tsx`)

`App` owns every piece of shared state and hands it down to views as props
(no global store). Responsibilities:

1. **Theme** — reads/writes `quanta-pulse-theme` in localStorage, applies
   `document.documentElement.dataset.theme`, and follows
   `prefers-color-scheme` when set to `system`.
2. **Auth gate** — renders `LoginScreen` until `auth.authenticated`, unless a
   session is merely expired (then the main UI shows with a banner).
3. **Data loading** — `refresh()` fans out nine `api.*` calls in parallel
   (courses, resources, dashboard resources, events, dashboard events, history
   events, history scans, unread count, db info); `refreshStatus()` loads sync
   status, auth status, and settings.
4. **Event bridge** — subscribes to backend events over
   `@tauri-apps/api/event`:
   - `sync:status`, `sync:progress`, `sync:done`
   - `auth:changed`
   - `ui:navigate` (fired by the tray to jump to a view)
5. **Action handlers** — `handleSync`, `restartQuantaSession`,
   `clearDashboardActivity`, `clearHistoryActivity`, `markHistoryRead`,
   `handleLogout`, `saveSettings`, all wrapped in `useCallback`.
6. **Toast** — a single shared error/toast string, auto-dismissed after 6s.

Navigation is a fixed `NAV` array: Calendar, History, Dashboard, Resources,
Courses, Settings. History shows an unread badge.

### Data flow

```
React view ──► src/lib/api.ts ──► invoke("command") ──► src-tauri/src/commands.rs
     ▲                                                        │
     └───────────── Tauri events (sync:*, auth:*) ◄───────────┘
```

The frontend is a **pull + event** model: it loads data on mount and after any
sync/auth event, and listens for status/progress pushes. No polling from JS.

### API layer (`src/lib/api.ts`)

A single `api` object wrapping every command with typed signatures. It is the
only module allowed to import `invoke`. Adding a command means three edits:
`lib.rs` `invoke_handler`, `commands.rs`, and an `api.ts` wrapper (+ `types.ts`
if a new model crosses the boundary).

## 5. Views

| View | File | Purpose |
|---|---|---|
| Calendar | `views/CalendarView.tsx` | Month grid of activity dots + selected-day digest |
| History | `views/HistoryView.tsx` | Change log table + scan history table |
| Dashboard | `views/Dashboard.tsx` | Recent activity feed with filters and summary |
| Resources | `views/ResourcesView.tsx` | Flat, filterable table of all resources |
| Courses | `views/CoursesView.tsx` | Course hub → expandable in-app resource library |
| Settings | `views/SettingsView.tsx` | Appearance, account, notifications, monitoring, data |

### Calendar

Two panes (`calendar-layout`, 2-column, stacks under 880px):

- **Month calendar** — 6-week Monday-first grid built by
  `events.buildMonthGrid`. Each day shows up to three coloured dots
  (`dotKinds`, priority: unavailable → deadline → updated → announcement →
  new → restored). Controls: prev/next month, Today.
- **Day panel** — a `daily_digest` summary (new, updated, announcements,
  deadlines, unavailable, courses failed, last successful sync) followed by an
  event table with `OpenActions`.

Keyboard model is a proper grid: arrows move by day/week, PageUp/PageDown shift
month, Home jumps to today. Roving `tabIndex` with focus following selection.

The month is fetched via `events_range(from, to)` for the visible month; the day
uses `daily_digest(date)`. Both group by **local** calendar days, never UTC
strings.

### Dashboard

`PageHeader` + `ClearActivityButton` + `Summary` + `Filters` + `ResourceList`.

- `Summary` shows new / updated / upcoming deadlines / unavailable / courses
  monitored, tinted by tone classes, with a "You're all caught up" state.
- `Filters` is chip row (All, New, Updated, Deadlines, Unavailable) + course
  `<select>` + search box.
- Rows are grouped by day (`groupByDate`) with sticky `.group-label`s. Each row
  shows an unread dot, title, course · section · type · size, upload time, a
  status tag, and an explicit **Open File** button. The whole row is a
  `role="button"` that opens the primary URL.

Empty-state copy is context-sensitive: no resources ever vs. no current
activity vs. filters matched nothing.

### History

Change log table (Detected, Change, Resource, Course, actions) plus a scan
history table (Started, Status, Found, New, Updated, Unavailable, Courses,
Errors). Baseline scans are tagged. "Mark all as read" is optimistic: the UI
flips `read` flags and decrements the unread count immediately, then reconciles
with the backend.

### Resources

Flat table across all courses: Title (with size), Course, Section, Type,
Upload/publication, Availability, Links. Filter bar: course select, type select
(populated from actual types), search. Rows use `OpenActions` (Open / Open File).

### Courses

Each course is a `course-card`:

- Header toggle (`aria-expanded`) opens an **in-app resource library**; the
  course name also carries a `Re-baseline` and `Pause/Resume` control and an
  "Open Quanta Course ↗" link to the real homepage.
- Expanding loads `list_resources({ courseId, limit: 2000 })` and renders
  `CourseLibrary`.

`CourseLibrary` builds a folder tree from crawled `sectionPath` values
(`courseTree.buildCourseTree`) and offers search-across-all-sections, sort
(Newest/Oldest/Name/File type), type filter, and category filter. When
searching, results flatten with their section path shown. Folders have a
disclosure triangle, a navigate-to-folder action, a descendant count, and an
"Open Quanta page ↗" link. Files that the webview can render get a **Preview**
action (`lib/preview.ts`).

### Settings

Sections: **Appearance** (theme switcher), **Account** (status, sign-in method,
session acquired, sign out, notification permission, test notification),
**Notifications** (master toggle + per-category toggles + deadline window +
quiet hours), **Monitoring** (sync interval, run in background, launch at
login, timezone display), **Data** (DB path/size/counts, logs dir, re-baseline
all). Edits go to a local `draft`, committed by "Save settings".

## 6. Components

| Component | Role |
|---|---|
| `Header` | Brand, today, last-sync/next-sync meta, status pill, theme switch, Sync now (with progress bar while running) |
| `LoginScreen` | Password + SSO login, password reveal, immediate password clearing |
| `PageHeader` | Consistent page title/subtitle + optional actions |
| `Summary` | Dashboard stat row |
| `Filters` | Chip kind filter + course select + search |
| `ResourceList` | Day-grouped resource rows |
| `OpenActions` | Canonical Open / Open File pair |
| `SessionRefreshBanner` | Session-expired → "Restart Quanta Session" flow with states |
| `ThemeSwitcher` | System / Light / Dark segmented control |
| `ClearActivityButton` | "Clear All" with a confirmation dialog |
| `CourseLibrary` | Per-course tree, filters, preview trigger |
| `ResourcePreviewPanel` | On-demand in-app preview modal |

## 7. UI design system (`src/styles.css`)

Single file, tokens first, then base, then components. No component hardcodes a
colour. Themes stay in sync because every value is a CSS custom property, and
the dark theme (`:root[data-theme="dark"]`) only redefines the variables.

### Tokens

- **Surfaces/neutrals** — `--bg`, `--surface`, `--surface-2`, `--hover`,
  `--text`, `--muted`, `--faint`, `--line`, `--line-strong`.
- **Semantic palette** — `--cyan` (accent/primary), `--green` (ok),
  `--amber` (warn/deadline), `--red` (danger), `--violet` (announcements),
  each with `-soft` and `-border` variants for tinted chips/labels/alerts.
- **Back-compat aliases** — `--accent`, `--ok`, `--warn`, `--danger` map onto
  the semantic set.
- **Spacing** — 4px scale: `--sp-1`(4) … `--sp-8`(32); `--page-pad` 24px
  (16px under 760px); `--row-h` 46px.
- **Shape** — `--radius` 6px, `--radius-sm` 4px, `--radius-pill` 999px.
- **Type** — `--font-sans` (Inter/Geist/SF) and `--font-mono` (JetBrains
  Mono/IBM Plex/SF Mono). Sizes: `--fs-meta` 13, `--fs-ui` 14, `--fs-label` 13,
  `--fs-title` 22. Mono is used for anything numeric (`.mono`, `.num`,
  `.row-time`, `.row-meta`) with `tabular-nums` so columns align.

### Visual language

A **minimal, terminal-inspired** aesthetic: flat surfaces, 1px hairline
borders, muted colours, monospace numerals, and restrained motion
(0.12–0.2s transitions, disabled under `prefers-reduced-motion`). The palette
stays low-contrast and readable in both themes.

### Recurring patterns

- `.btn` / `.btn-primary` / `.btn-link` — button scales.
- `.chip` / `.chips` — segmented toggles (filters, theme).
- `.label` + type classes (`.new`, `.announcement`, `.updated`, `.deadline`,
  `.unavailable`, `.restored`) — tinted event/status tags.
- `.status-dot.ok|syncing|error` — health indicators.
- `.alert.error|info|ok` — inline messages.
- `.kv` / `.setting` — settings/data key–value and control rows.
- `table.grid` — the standard table (hairline rows, hover highlight).
- `.empty` — centred empty states.
- `.confirm-backdrop` / `.preview-backdrop` — modal overlays.

### File-type colour mapping

`lib/filetype.ts` maps resource types to `--red` (PDF/docs), `--green`
(sheets), `--amber` (slides), `--violet` (links), `--cyan` (text/notes), muted
(other). Rendered as a coloured dot + the type name.

### Responsive

Breakpoints at 880px (calendar → single column), 760px (tighter page padding,
header wraps, tables scroll horizontally, tree rows drop the trailing column),
and 620px (rows wrap, title/time full width). Reduced-motion is honoured.

## 8. Backend architecture (`src-tauri/src`)

| Module | Responsibility |
|---|---|
| `lib.rs` | `run()`: builds the app, plugins, the authoritative `invoke_handler` command list, setup, window-close → background behavior, exit cleanup |
| `commands.rs` | Every Tauri command; a thin adapter that delegates to `core/` or a focused module |
| `core/` | Transport-agnostic domain logic — plain functions over a `Connection`, the file store and the client. Tauri commands (and a future HTTP or MCP server) are adapters over this, so logic never lives in a handler |
| `core/files.rs` | `FileStore`: the on-demand byte cache under `files/<resource_id>/<sha256>`, with LRU eviction and the `file_cache` index. Evictable by design |
| `core/mirror.rs` | The permanent mirror: `local_files` / `local_file_versions` / `download_queue`, the download pipeline, `.history` versioning, `ensure_local`. Never evicts, never deletes. Text pages become Markdown snapshots |
| `mirror_worker.rs` | The mirror's loop: drains the queue a few items at a time, then waits; forwards `mirror:progress` / `mirror:file` to the webview |
| `state.rs` | `AppState`: shared SQLite connection, file store, mirror, settings, HTTP client, sync status, preview lease — all behind locks |
| `auth.rs` | Password login and SSO (SAML2), session restore/refresh/restart, logout |
| `settings.rs` | Settings model, validation (`sanitize`, `is_valid_hhmm`), quiet hours |
| `models.rs` | Serde models with `rename_all = "camelCase"` |
| `db.rs` | Schema + queries; `migrate()` runs `migrations/0001_init.sql` via `include_str!`; `now_rfc3339()` |
| `sync/engine.rs` | `run_scan` — the core scan |
| `sync/scheduler.rs` | Background ticker dispatching scans |
| `sync/diff.rs` | Classifies new / updated / unavailable |
| `quanta/client.rs` | HTTP + session |
| `quanta/discover.rs` | Authenticated crawl |
| `quanta/parse.rs` | HTML → models |
| `quanta/urlnorm.rs` | URL normalization, stable IDs, type mapping |
| `quanta/preview.rs` | In-app preview decision |
| `notify.rs` | Native notifications, per-category gates + quiet hours |
| `tray.rs` | Menu-bar icon + menu (status, sync now, settings, quit) |
| `logging.rs` | Daily rolling logs with secret redaction |

Auth material never persists: cookies stay in memory, and `logging.rs`
redacts anything matching session/token/password markers before writing.

**File cache.** Pulse fetches a resource's bytes on demand and keeps them in
`files/<resource_id>/<sha256 of the bytes>` beside the database, indexed by the
`file_cache` table. The hash is over the bytes — deliberately *not* the metadata
fingerprint in `resources.content_fingerprint`, which answers "did Moodle say
this changed?" from metadata alone. Caching never writes a `change_events` row,
so the baseline rule is untouched. `Settings.cacheLimitBytes` (default 2 GB,
clamped 64 MB–64 GB) caps the cache; `core::files::FileStore::evict_to` drops
least-recently-used entries first, and a row whose file has vanished reads as a
miss so the cache self-heals. Previews are the first producer; the content
indexer fills it too.

**Adding a feature.** Put the logic in `core/`, then write a thin
`commands.rs` adapter and wrap it in `src/lib/api.ts`. The `Connection` guard is
a non-reentrant mutex: read under the lock, drop it for any `.await`, then
re-acquire to write back.

Scan behavior: `sync/scheduler.rs` ticks (~30s) and dispatches
`sync/engine.rs::run_scan`. A resource missing `MISS_THRESHOLD = 2` consecutive
scans is marked unavailable, which avoids flapping on transient errors. The
first scan of a course is a **baseline** and reports no changes.

## 9. Tests

Vitest + jsdom suites under `tests/**/*.test.ts(x)`, covering pure logic and
component behavior:

`calendar`, `clearActivity`, `courseLibrary`, `courseLibraryView`,
`courseTree`, `courses`, `dashboard-consistency`, `events`, `filter`, `format`,
`historyActions`, `open`, `preview`, `resourcePreview`, `sessionRefresh`.

`dashboard-consistency` and `courses` guard the "one canonical source"
invariant across views. `logging.rs` also carries inline `#[cfg(test)]` tests
for redaction.

## 10. Build & packaging

- `npm run dev` / `npm run build` — frontend only (TypeScript first).
- `npm run app:dev` — full desktop app with live reload.
- macOS: `npm run app:build` builds `.app` then `scripts/make-dmg.sh`
  (hdiutil-based, because Tauri's Finder-driven DMG bundler needs a GUI
  session).
- Windows: `npx tauri build --bundles nsis`.
- CI: `.github/workflows/build-macos.yml` and `build-windows.yml` build on
  `main` pushes / manual dispatch and upload artifacts.
- `scripts/generate-icon.mjs` regenerates `app-icon.png` using only Node's
  built-in zlib.

Bundle config: `bundle.targets = ["app"]`, category Education, macOS minimum
10.15. Capabilities (`capabilities/default.json`) grant the main window core
window/event/app, notification, opener, and autostart permissions.

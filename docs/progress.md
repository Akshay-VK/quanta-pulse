# Calm redesign — implementation progress

Tracking the implementation of `docs/quanta_pulse_design_handoff_spec.md`
(Calm redesign, v1.0). Updated as each phase lands.

## Status overview

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Deps, branch, tooling, progress log | Done |
| 1 | CSS layers + tokens + fonts + theme + shell | Done |
| 2 | Primitives + Today + shared shell components | Done |
| 3 | Calendar + History | Done |
| 4 | Library (course list, course page, all files) | Done |
| 5 | Settings + ConfirmDialog + Toast + Banner + Login | Done |
| 6 | Command palette + shortcuts + states + a11y + axe | Done |

## Decisions and flags

- **Branch.** `feat/calm-redesign` off `main` (never commit to `main`).
- **Existing suites.** The spec requires keeping `dashboard-consistency` and
  `courses`. Because `CoursesView`/`ResourcesView` merge into `LibraryView` and
  `Dashboard` becomes `TodayView`, those component tests are retargeted to the
  new component files while preserving their assertions/invariant. Flagged per
  spec §1 ("where silent, follow the nearest pattern").
- **Pinned versions.** All packages installed with `--save-exact`.
- **`vitest-axe`** added for the §10 accessibility checks. There is no shared
  setup file (`setupFiles: []`); tests call `axe()` from `vitest-axe` directly
  and assert `results.violations.length === 0`.
- **Timezone.** `events.test.ts` and `format.test.ts` assume IST. Run the suite
  with `TZ=Asia/Kolkata` (the WSL default is UTC, which fails 3 assertions).
- **Radix/no-refs note.** `Button`/`IconButton` don't forward refs, so
  `ConfirmDialog` uses a native `<button>` for the Cancel element.

## Phase 0 — tooling

- [x] Branch `feat/calm-redesign`, committed AGENTS.md + spec + PROJECT.md.
- [x] Installed Radix, cmdk, lucide-react, @tanstack/react-virtual, tinykeys,
      fontsource Geist / Geist Mono / Newsreader (exact versions).
- [x] Added `vitest-axe` + `axe-core` (dev).

## Phase 1 — shell and tokens

- [x] `styles/` split into `tokens`, `base`, `layout` + `components/{ui,shell,
      content,overlays,screens}.css`; legacy 1971-line `styles.css` deleted.
- [x] `main.tsx` rewritten (fontsource imports, first-paint theme, platform tag).
- [x] Webview-safe CSS only (no nesting / `color-mix` / container queries).

## Phase 2 — primitives, Today, shell

- [x] 25 `components/ui/` wrappers (Radix + primitives), all thin, one export
      each, styled by section-6 classes + `data-state`.
- [x] Shared components: `PageHeader`, `Breadcrumb`, `GroupHeader`,
      `SyncProgress`, `SyncStatus`, `SyncButton`, `Sidebar`, `ConfirmDialog`,
      `ResourceRow`, `PropertyList`, `PeekPanel`, `CommandPalette`.
- [x] Pure helpers `lib/{cx,platform,summary,nav,details}.ts`; hooks
      `useTheme`, `useMediaQuery`, `useHotkey`.
- [x] `TodayView` (groups, filters, search, peek, read/mark-all, clear).
- [x] `App.tsx` rewired to the new shell (Sidebar + top bar + `PeekPanel` +
      `CommandPalette` + `Toaster` + hotkeys + auth gate). New `LibraryView`
      (Courses/All-files toggle) and legacy views kept temporarily for
      Calendar/Library/History/Settings. Completed as part of later phases: Calendar/History/Library/Settings rewritten; legacy views removed; TopBar/PreviewDialog/Login/ClearActivity/SessionRefreshBanner wired.


## Phase 3 — Calendar + History

- [x] `CalendarView` rewritten (eventsRange/dailyDigest, dots+legend, digest panel, failed-courses banner, keyboard grid).
- [x] `HistoryView` rewritten (Changes/Scans tabs, filters, day groups, DataTable for scans, PeekPanel, clear dialog).
- [x] `tests/calendarKeyboard.test.tsx` added.

## Phase 4 — Library

- [x] `views/library/` (CourseList, CoursePage, AllFiles, TreeRow) with virtual tree, search/filters, keyboard ARIA tree, peek.
- [x] `LibraryView` wired. Legacy `CoursesView`/`ResourcesView` removed.

## Phase 5 — Settings, auth, toasts, banners, dialogs

- [x] `SettingsView` rewritten; `settingsDraft` + `tests/settingsDraft.test.ts`.
- [x] `LoginScreen`, `ClearActivityButton` (re-entrancy guard + catch), `SessionRefreshBanner`, `ThemeSwitcher`.
- [x] `TopBar`, `StatBlock`, `SettingRow`, `DataTable`, `PreviewDialog`; legacy summary/filters/resource list/previews removed.
- [x] App wired to TopBar + PreviewDialog; removed dead `events` state; Calendar/History props updated.

## Phase 6 — Command palette, shortcuts, states, a11y, axe

- [x] Existing `CommandPalette` retained and wired; shortcuts via `useHotkey`; global states preserved.
- [x] Added `tests/peekPanel.test.tsx`, `tests/axeViews.test.tsx` (both themes, color-contrast disabled in jsdom), `tests/treeKeyboard.test.tsx`; vitest-axe integrated.
- [x] Accessibility fixes: Calendar grid → proper row group, Switches have accessible names; IconButton/Button forward refs.
- [x] Full suite green: 21 files / 150 tests passed (TZ=Asia/Kolkata).


## Phase 7 — Local file store (spec Part 1)

- [x] `file_cache` table added to `migrations/0001_init.sql` (additive, idempotent).
- [x] New transport-agnostic `core/` module; `core/files.rs::FileStore` owns the
      cache at `files/<resource_id>/<sha256>`, LRU eviction, stats and clear.
- [x] `Settings.cacheLimitBytes` (default 2 GB, clamped 64 MB–64 GB) with a serde
      default so an existing settings row is not discarded on upgrade.
- [x] Commands `cache_stats` / `clear_file_cache`; `preview_resource` now stores
      what it downloads, so the cache has a live producer.
- [x] Settings > Data: cache usage row, size-limit Select, 'Clear cached files'.
- [x] Tests: 5 `core::files` unit tests + settings default/clamp and
      missing-field-compatibility tests. 88 Rust tests, 187 frontend tests pass.

## Phase 8 — Visual fixes (spec Part A)

- [x] A1 ResourceRow is a CSS grid (`main | pill+tag | time | actions`) so a long
      title can no longer overlap the course pill, status tag or time; the pill
      is capped at 16ch and ellipsised, the tag never shrinks, and every text
      track has `min-width: 0`. New `density` prop; `compact` is a two-line
      layout used by the Calendar day panel explicitly and by any row measured
      under 560px through a ResizeObserver (no container queries on our minimum
      webview). Calendar day panel width is 360px, clamped 320–420.
- [x] A2 Settings: centred `160px minmax(0, 720px)` grid with a 48px gap;
      section list is plain 32px rows with no underline; sentence-case
      `--type-dialog` section titles; group dividers removed so hairlines come
      from SettingRows alone (last in a section has none); Account shows the
      notification permission as muted text beside its action, and Sign out is a
      new `danger-ghost` Button opening the ConfirmDialog.
- [x] New command `open_notification_settings` (Settings > Account, the Blocked
      case). `vitest.config.ts` gained `css: true` so tests can read the real
      stylesheets as text; jsdom does not lay out CSS, so the grid/min-width
      contract is asserted against the source.

## Phase 9 — Local mirror core (spec B0–B8)

Permanent local copies of everything Quanta serves, kept separate from the
preview cache so nothing can evict or delete them.

- [x] Schema: `local_files`, `local_file_versions`, `download_queue` appended
      to `migrations/0001_init.sql` (idempotent; the only schema in the repo).
- [x] `core/mirror.rs`: the queue, the download, versioning, stats and
      `ensure_local`; `core/mirror/paths.rs` the segment rules and the traversal
      guard; `core/mirror/markdown.rs` HTML→Markdown snapshots.
- [x] `quanta/client.rs`: `download` (headers first, so the name comes from
      `Content-Disposition`) and `stream_to` (per-chunk stall detection, login
      page sniffing, a size ceiling). A second `Client` with no overall timeout
      shares the cookie jar — a lecture recording outlives the API timeout.
- [x] Resumable downloads: `.part` + SHA-256 while streaming, `Range` +
      `If-Range` so a changed file restarts, atomic rename with retries,
      superseded copies to `.history` (kept: 3, configurable).
- [x] `Settings`: `mirrorEnabled`, `mirrorRoot`, `mirrorMaxBytes`,
      `mirrorMinFreeBytes`, `mirrorKeepVersions`, all with serde defaults so an
      existing settings row is not discarded on upgrade.
- [x] Commands: `mirror_status`, `mirror_local_files`, `mirror_local_file`,
      `mirror_start_backfill`, `mirror_pause`, `mirror_resume`,
      `mirror_retry_failed`, `mirror_verify_files`, `mirror_delete_all`,
      `mirror_move_files`, `pick_mirror_root`, `ensure_local`, `open_local_file`,
      `reveal_local_file`, `open_app_folder` (database / logs / mirror, 'Open'
      and 'Show in folder'; the folder comes from `kind`, never from the
      caller). `mirror_worker.rs` runs the loop and forwards `mirror:progress`
      / `mirror:file`.
- [x] Triggers: every completed scan enqueues backfill + re-checks; sign-in
      clears `waiting_for_sign_in`; a resource Quanta keeps hiding becomes
      `kept` and is never deleted.
- [x] B6 UI: `lib/mirrorState.ts` (labels, tips, tones), `MirrorStatusIcon`,
      `hooks/useMirror.tsx` (one listener, one fetch, shared through context),
      the row marker and 'Open local copy' / 'Download and open' labels, the
      PeekPanel 'Local copy' group, the sidebar download line and the
      downloads popover.
- [x] B7 Settings > Files: mirror folder with 'Change…' / 'Open folder' and
      the move-or-start-fresh banner, download switches, the queue row with
      Pause/Resume and 'Download all', the size, free-space and version
      selects, 'Retry all' and 'Verify now'; 'Delete all local copies' sits in
      the Data danger group.
- [x] Spec §6.5 (row marker and actions), §6.6 (download line and popover,
      PeekPanel local group), §6.7 (the two stores) and §7.6 (Files) updated.
- [x] Tests: 26 `core::mirror` tests (path rules, backoff, content-disposition,
      hashing sink, snapshot naming, Markdown) and `tests/mirrorUi.test.tsx`
      for every icon state, the row's open labels and the PeekPanel group.
      122 Rust tests, 217 frontend tests, tsc, eslint and `vite build` pass. No
      new runtime deps beyond `fs2`, `percent-encoding`,
      `unicode-normalization` (already in the lockfile tree); no npm packages.
- [ ] B9 resource actions (single-file 'Download now', 'Open local copy',
      'Show in folder' on the row menu) — not started.

## Phase 10 — Text from local copies (spec Part 2)

Text extraction reads the local copy instead of the network, so a mirrored page
or file previews offline and never pauses a scan.

- [x] `core/text.rs`: `local_text(conn, mirror, resource_id)` returns readable
      text read through `Mirror::local_file` (the mirror first, then the preview
      cache). Markdown and plain text pass through; HTML is converted with the
      same `extract_readable_text` the network path uses. `max_bytes` guard
      (`MAX_TEXT_BYTES`, 8 MB) so a binary is never pulled into memory; a
      non-text copy is `None`.
- [x] `core/mirror.rs`: `Mirror::local_bytes(conn, resource_id, max_bytes)` — the
      reading half of `local_file`, for callers that need the content.
- [x] `preview_resource` tries the local copy before anything else: text via
      `core::text`, a binary via `local_bytes` under `PREVIEW_MAX_BINARY_BYTES`
      (a larger copy still reports `tooLarge`). Only on a miss does it take the
      preview lease and fetch. The command doc comment was corrected: content is
      no longer never-persisted.
- [x] Tests: 8 `core::text` tests (Markdown passthrough, HTML conversion, binary
      `None`, over-limit `None`, missing file, vanished file, MIME-over-extension,
      extension fallback) plus `local_bytes` limits. 131 Rust tests pass;
      `cargo clippy` adds no warning to the new code.

## Phase 11 — Telegram (spec Part 3)

The user's own bot forwards change events and serves files from the local
mirror. Nothing contacts a host other than `api.telegram.org`.

- [x] `Settings`: `telegramEnabled` (off by default), `telegramBotToken`,
      `telegramChatId`, all with serde defaults. `sanitize` drops a blank or
      malformed token/chat id rather than storing junk; the token is validated
      as `123456789:AA…`.
- [x] `core/search.rs`: one search over title and course name, newest first,
      with the resource id and a `local` flag per hit. Shared by the app, the
      bot and a later MCP server.
- [x] `core/telegram.rs`: `TelegramClient` (long poll, `sendMessage`,
      `sendDocument`, `getMe`), `/command` parsing with the `@botname` suffix
      stripped, the help/search/status replies, and the event message. Every
      `reqwest` error goes through `without_url()`, because the URL embeds the
      token.
- [x] Six-category forwarding reuses the Settings switches through
      `notify::category_enabled` — one set of filters, no hidden second set.
      `notify::dispatch` forwards alongside the native banner and still marks
      the event notified once; `notify_auth_expired` forwards the auth reminder.
- [x] `telegram_worker.rs`: long poll with backoff, backlog dropped at start-up
      so a restart never replays old commands, answers only the configured
      chat, and `/get` waits on `Mirror::ensure_local` (60 s) before uploading —
      files never come from the network.
- [x] Commands `telegram_status` (live `getMe`, never the token) and
      `telegram_test`; `src/lib/api.ts` + `types.ts` wrappers.
- [x] `logging.rs` redacts any line naming `api.telegram.org` or
      `telegram_bot_token`.
- [x] Tests: 10 `core::telegram`, 4 `core::search`, 4 `Settings` (defaults,
      malformed token/chat, missing-field tolerance) and 1 redaction. 150 Rust
      tests pass; `reqwest` gained the `multipart` feature (no new crate).
- [x] UI (Part 4): a `Telegram` section between Notifications and Monitoring —
      forwarding switch, the token as a password field, the chat id, the live
      `getMe` status ('Connected as @…', 'Off', or the API's error) and
      'Send test message'. `settingsDraft` validates the token and chat id
      shape before a save, so a bad paste is caught in the form. The six
      category switches stay in Notifications; Telegram adds no second set.
      221 frontend tests pass, tsc, eslint and `vite build` clean.

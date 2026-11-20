# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Before 1.0.0 the policy is: **minor** for features, redesigns and migrations,
**patch** for fixes. A version is never reused or lowered, and tags are `vX.Y.Z`.

## [0.4.0] - 2026-11-20

### Added

- An Inbox with unread and due-soon views, filters, grouped changes, and bulk
  read and dismiss actions.
- A deadline Agenda, a month view for course activity, and per-course scan
  diagnostics in History.
- Course Materials with a folder rail and file table, an All files view, and
  local course renaming and monitoring controls.
- Quick Look PDF thumbnails and text search, plus dedicated image, text, audio,
  and video preview controls.
- Per-file download progress, cancellation, and retry, and a five-minute
  monitoring interval option.

### Changed

- Revamped the workspace, file inspector, and Settings with responsive
  navigation, updated light and dark layouts, and more appearance controls.
- Expanded command search with course, type, read, saved, and due-date filters,
  and added keyboard navigation and a shortcut reference.
- Added first-run progress and clearer session reconnect and update states.

### Fixed

- Failed updater installs leave background monitoring running, and successful
  installs follow the platform's restart flow.
- Improved focus restoration and layout at narrow widths and 200% zoom.
- Inbox count failures show unknown totals while preserving available rows.

## [0.3.0] - 2026-11-13

### Changed

- Redesigned the desktop workspace with a compact sidebar, bundled Geist
  typography, and refreshed light and dark theme tokens.
- Unified resource details across Today, Library, Calendar and History, with
  consistent selection, preview and panel cleanup when changing views.
- Refined Library course navigation, Calendar event selection and History
  actions, with clearer loading, empty, error and retry states.
- Improved keyboard navigation and command-palette hints, including keyboard
  access to file details and shortcuts that respect editable fields.
- Made Settings saves and navigation clearer: unsaved changes are guarded,
  failed saves can be retried, and operation feedback stays visible.

### Fixed

- Compact resource rows and detail layouts at narrow window widths.
- Stale detail selection and mirror status after switching views or refreshing.
- Inactive filter-count contrast and Today baseline, empty and error feedback.

## [0.2.0] - 2026-10-16

### Added

- Local mirror of everything Quanta serves, with a permanent on-disk copy,
  a download queue and per-resource version history.
- In-app previews that read the local copy first, so opening a file needs no
  network and no session.
- Full-text search across titles, course names and mirrored file contents.
- Telegram forwarding of change events, sending the file itself rather than a
  link when a local copy exists.
- Settings sections for Files and Telegram, plus a data cache ceiling.
- Signed auto-updater: the app checks GitHub Releases, verifies each bundle
  with an embedded public key and installs per-user on Windows.
- Pre-migration database backups (VACUUM INTO), keeping the newest three.
- Release tooling: `npm run version:check`, `npm run release`, and CI
  workflows for tests and signed releases.

### Changed

- Settings rebuilt as a single centred column with a sticky section nav.
- Resource rows reflow to a compact layout on narrow windows.
- The app version is read from `package.json`; Cargo and the Tauri config
  derive from it.

### Fixed

- Preview frames and HMR were blocked by the content security policy.
- Two copies of React could mount at once, breaking hooks.
- The sidebar download line now follows the real queue instead of scan state.

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Before 1.0.0 the policy is: **minor** for features, redesigns and migrations,
**patch** for fixes. A version is never reused or lowered, and tags are `vX.Y.Z`.

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

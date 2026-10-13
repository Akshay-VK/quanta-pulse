# AGENTS.md

Quanta Pulse — native desktop tracker for the BITS Pilani Quanta (Moodle) LMS.
Tauri 2 (Rust) shell + React 18 / TypeScript (Vite) UI. All state is local in
SQLite; there is no server, account, analytics, or telemetry. First run is a
baseline scan that reports nothing (no false "new" floods).

## Stack
- Frontend: React 18, TypeScript 5.7, Vite 6. Logic lives in `src/lib/`
  (pure, tested); views in `src/views/`; components in `src/components/`.
- Backend: Rust 2021 (`rust-version = 1.77`), Tauri 2, `rusqlite` (bundled
  SQLite), `reqwest`, `scraper`, `tracing`.
- Tests: Vitest + jsdom, files at `tests/**/*.test.ts(x)`.
- Toolchain: Node 18+ (CI uses 22). Windows dev is PowerShell.

## Commands
- `npm run dev` — Vite only on port 1420 (strictPort). Use to iterate on UI.
- `npm run build` — `tsc -b && vite build` into `dist/`. Type-checks first.
- `npm test` — `vitest run`. `npm run test:watch` for watch mode.
- `npm run lint` — `eslint . --max-warnings 0`. Zero warnings allowed.
- `npm run app:dev` — `tauri dev` (full desktop app, live reload).
- `npm run app:build` — macOS only: builds `.app` then `scripts/make-dmg.sh`.
- Windows installer: `npx tauri build --bundles nsis`.

Always run `npm run lint` and `npm test` after frontend changes; `cargo check`
in `src-tauri/` after Rust changes. Do not run the packaged app during dev.

## Architecture
- `src-tauri/src/lib.rs` `run()` builds the app and is the authoritative list of
  Tauri commands. Register a new command there **and** wrap it in
  `src/lib/api.ts` — that file is the only place the frontend calls `invoke`.
- Command handlers live in `src-tauri/src/commands.rs`; they delegate to
  focused modules (`auth`, `sync/`, `quanta/`, `db`, `notify`, `tray`).
- Sync runs in-process: `sync/scheduler.rs` ticks (~30s) and dispatches
  `sync/engine.rs::run_scan`. `sync/diff.rs` decides new/updated/unavailable.
  A resource missing `MISS_THRESHOLD = 2` scans before being marked unavailable
  (avoids flapping on transient errors).
- Scraping: `quanta/client.rs` (HTTP/session), `discover.rs` (crawl),
  `parse.rs` (HTML → models), `urlnorm.rs` (URL identity/dedup),
  `preview.rs` (in-app render decisions). Origin is the `QUANTA_ORIGIN`
  constant (https://quanta.bits-pilani.ac.in).
- DB: `db.rs` + `migrations/0001_init.sql` (applied via `include_str!`). All
  timestamps are RFC 3339 UTC strings. `state.rs` owns the shared connection,
  settings, and client behind locks.
- Auth supports password login and SSO (SAML2); credentials/session material
  never leave the machine. `logging.rs` redacts secrets before logging.

## Conventions
- Wire format is camelCase: Rust models use `serde(rename_all = "camelCase")`;
  matching TS types live in `src/lib/types.ts`. Keep both sides in sync.
- Rust modules carry `//!` / `///` doc comments; match that style.
- Frontend: put pure logic in `src/lib/`, keep components presentational.
- Styling is one design-token system in `src/styles.css` (CSS custom properties,
  4px spacing scale, light/dark themes). Reuse tokens; do not hardcode colors.
- New behavior needs a test at `tests/`. Write it before wiring UI.
- Git: branch per feature, conventional commits (`feat:`, `fix:`, `chore:`),
  never commit directly to `main`.

## Gotchas
- Do not construct `invoke` calls outside `src/lib/api.ts`.
- `state.conn()` locks a non-reentrant `Mutex<Connection>`; never hold it across
  a call that itself locks the same connection (see the comment in `tray.rs`).
- Vite ignores `src-tauri/**`; Rust changes require a `tauri dev` restart.
- macOS packaging needs a GUI session; `scripts/make-dmg.sh` exists because
  Tauri's Finder-driven DMG bundler fails headless.

# 2026-11-14: Themes and student workflow specification

The user requested that the UI overhaul proposal become a detailed stored specification and that pending work be merged into main before implementation begins. The user confirmed the primary testing seam: real application user flows, backed by existing pure-logic tests and backend command tests for state changes.

## Specification and tracker

- [Stored specification](../specs/2026-11-14-ui-themes-and-workflows.md)
- [Published parent issue #12](https://github.com/Akshay-VK/quanta-pulse/issues/12), labeled `ready-for-agent`.
- [Earlier workspace spec #1](https://github.com/Akshay-VK/quanta-pulse/issues/1) remains closed; its completed implementation is the foundation for this follow-up.

The new specification covers six paired palettes, independent mode/accent/density preferences, preference migration, Inbox attention semantics, complete due-date querying, an agenda distinct from activity dates, explicit read/unread state, consistent material actions, contextual navigation, focused Settings sections, and dismissal separated from permanent history deletion. Its 62 user stories and acceptance criteria define future implementation, not completed UI work.

## Precedence and baseline

The earlier source audit inspected checkout `967333bb585bff478810f453be1c6ba2c2c96c59`. Main has since advanced to `fb3fc9d885126fa0825af6bc8e410d6efbc7c9b7`, containing the accepted workspace redesign and version 0.3.0 preparation. The stored audit is annotated as historical so its already-resolved findings are not treated as new implementation tasks.

This specification supersedes the previous fixed near-black/violet appearance decision and its exclusion of named themes, an agenda, and backend state operations only to the extent explicitly described in the new spec. Existing shared details, keyboard safeguards, stable course navigation, Settings draft safety, and baseline behavior remain regression requirements. The earlier dated decisions and acceptance records are preserved.

Pending authentication changes were captured as `b3fd2b7` (`fix: pause monitoring after Quanta session expiry`) and merged with the current main baseline on the feature branch. That fix propagates typed authentication expiry, prevents reconciliation of an expired partial inventory, parks automatic scans until verified authentication, and limits expiry notifications to one per episode. It is baseline maintenance separate from the future UI feature.

Publication does not authorize an automatic implementation run or model delegation. No implementation sub-issues were created as part of this synthesis. Integration and verification results are recorded separately when completed.

## Baseline integration verification

The assembled application tree at `8170285` contains the current main workspace plus the pending session-expiry fix; the spec and deliverables are committed there. Verification passed before advancing main:

- `npm run lint`: passed, zero warnings.
- `npm test`: 39 files and 332 tests passed.
- `npm run build`: passed, including TypeScript checking. The existing 500.22 kB main-chunk warning remains.
- Windows native `cargo check --all-targets`: passed.
- Windows native `cargo test --lib`: 169 tests passed, including the six new discovery expiry cases and three sync-control regressions.
- A focused Linux harness importing the actual discovery modules passed 41 tests. This supports the native results; it is not a substitute for the full application check.
- `git diff --check`: passed.
- Stored spec template, all 62 sequential user stories, published issue body, and `ready-for-agent` label were read back and verified.

The Linux full-application Cargo attempt could not complete because host DBus/GTK development libraries are absent; the installed Windows Rust toolchain supplied the successful native-target checks above. Windows emitted an incremental-cache access note but both native commands exited successfully. Frontend dependencies were restored from the existing lockfile to make the Linux test/build environment usable; no dependency version change is included.

The existing pitch source, final PDF, source archive, and screenshot assets are included in the baseline. Compiler intermediates and review renders remain locally available under their ignored build directory. No installer, packaged app, signed-in Quanta flow, visual preview, or new UI implementation was run as part of this specification/integration task.

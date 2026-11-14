# 2026-11-14: Appearance vertical slice implemented

## Authorization and scope

The current user request explicitly authorizes implementation of the approved themes and workflows specification and directs the appearance worker to complete AC1 and appearance-related AC2 without questions or child agents. This supersedes the earlier spec-publication-only authorization recorded in [the specification entry](2026-11-14-themes-and-workflows-spec.md). It does not claim completion of the remaining workflow slices.

Baseline: `870f818`. Appearance implementation: `0219857d345cc8d73cbe592f4e4e09592be6ab66` (`feat: add independent workspace appearance preferences`). No merge, push, release, packaged application, or Rust change is included.

## Decisions and interfaces

- `src/lib/appearance.ts` owns schema version 1, legacy fallback, independent field validation, future-version preservation, storage failure results, six authored paired palette families and six accent choices. `readAppearance`, `resolveAppearance`, and `applyAppearance` form the shared startup/runtime interface. No GLOSSARY.md or docs/adr directory exists; this feature does not introduce unrelated records.
- `src/hooks/useTheme.ts` is the sole appearance owner and OS appearance subscriber. It persists immediately, supports in-memory operation with feedback, and exposes reset and explicit light/dark toggle while preserving other choices. Future-version records remain untouched even after an attempted selection.
- `src/components/Appearance.tsx` supplies the same accessible controls in the topbar popover and Settings. `SettingsView` accepts an `appearance` ReactNode slot; operational drafts and updater state remain separately owned. The command-palette toggle names its resulting mode. Collapsed sidebar navigation receives accessible names.
- Existing style tokens and aliases remain in use. Authored colors are in the appearance model; shared semantic state colors remain mode-specific and independent of accent in `tokens.css`. Soft Graphite is the fallback/default, with the approved dark anchors retained. Supporting selection tints and Forest light tertiary text were calibrated to pass contrast. Comfortable/Compact rows use 44/36px minimums and retain the existing growing two-line layout. Input outlines, focus indicators, floating surfaces, selected rows and readable disabled controls consume the shared tokens. Bundled Geist, native titlebar allowances, and course identities remain intact.
- Architecture scan and before/after HTML report remain outside the repository: `/tmp/quanta-ui-architecture-20261114.md` and `/tmp/architecture-review-20261114-122629.html`. Ranked remaining seams are complete attention/agenda queries, shared material action policy on the existing details/mirror owners, and updater lifecycle. Their suggested interfaces and ownership are recorded in the scan; no speculative production interfaces were added for those slices.

## Verification and evidence

At implementation commit `0219857d345cc8d73cbe592f4e4e09592be6ab66`:

- `npm run lint`: exit 0, zero warnings (`/tmp/quanta-appearance-lint-final.log`).
- `npm test -- --maxWorkers=2 --minWorkers=1`: exit 0; 42 files / 422 tests passed (`/tmp/quanta-appearance-test-final.log`). All 72 palette/resolved-mode/accent combinations pass ordinary-text 4.5:1 and meaningful control/focus 3:1 checks across workspace, sidebar, raised, floating, hover and selection contexts, plus foreground-on-fill and disabled contexts. Real-App tests cover legacy migration, shared first-paint resolution, controls, shortcut, persistence after remount, reset, OS changes, storage failures/future records, narrow navigation, focus return, semantic accessibility and dirty-draft isolation.
- `npm run build`: exit 0, TypeScript and Vite passed; main chunk 508.75 kB (existing 500 kB warning threshold). `/tmp/quanta-appearance-build-final.log`.
- `git diff --check`: exit 0.
- Chromium rendered matrix: 16 cases, widths 820/960/1280/1440 and native browser zoom 100%/200%, light/dark, both densities, palette selection by Enter, reachable reset and Escape focus return, no document overflow. Forced colors, reduced motion and coarse-pointer selection passed. `/tmp/quanta-ui-progress-20261114/rendered-matrix.json`.
- Actual App screenshots show illustrative course data, light/dark workspaces, chooser, Settings, inspector, sidebar rail, minimum window, native 200% zoom and forced colors under `/tmp/quanta-ui-progress-20261114/`. Browser runtime errors: zero. The fixture API/event adapters and Vite configuration are entirely in that temporary directory, listening on port 1441; they are not production code and do not represent live LMS or native behavior.

The shared T3 browser failed because host libraries `libnspr4.so`, `libnss3.so`, and `libnssutil3.so` were unavailable. The existing Playwright adapter and local extracted browser libraries supplied the working fallback. Its browser tabs were closed after capture; the temporary dev server remains available for parent review. No shared preview tab id exists.

The first unrestricted `npm test` attempt hit a 5-second Settings timeout under concurrent host load, cascading through that suite; the focused 23-test Settings run and bounded full reruns passed. Passing test output includes existing version-script negative-case diagnostics, Node DEP0190, React act/overlapping-act warnings and jsdom canvas-not-implemented messages from axe. Dependency restoration (`npm ci`, no lockfile edits) reported deprecated packages, pending allow-scripts notices and 13 existing audit findings (10 moderate, 1 high, 2 critical). These are recorded without expanding this slice into dependency changes.

## Remaining acceptance

AC1 and the appearance portion of AC2 are implemented with the bounded evidence above. AC3–AC8 workflow work remains with the respective Inbox/query/read-state, agenda, shared-action/navigation, recovery/data-operation and Settings organization workers; appearance/draft isolation from AC7 is already covered. The updater worker should keep using the existing native bridge in `src/lib/api.ts` and can extract its lifecycle without editing appearance ownership. Assemble all slices before final AC9 gates and the full workflow walkthrough.

Windows WebView2/macOS WKWebView theme changes, Tauri native smoke, real password/SSO and Quanta flows, offline local-file opening and shipped-CSP/native rendering remain unverified here. Chromium/native browser zoom and mocked local data do not substitute for those checks.

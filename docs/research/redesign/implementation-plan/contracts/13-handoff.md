# Task 13 implementation handoff

Task: 13 — Settings appearance and single-page structure

Issue: [#34](https://github.com/Akshay-VK/quanta-pulse/issues/34)

Base: `d4438ef2208c83fd1bf8e2f1895fd12bfa558335`

Result: unstaged working-tree patch; no branch, stage, commit, push, or PR.

## Acceptance

- **PASS** — One scrolling Settings view retains its seven named sections. Desktop layout is a 216px section rail plus a 640px content column; narrow layout exposes a native section select. Anchor navigation updates the selected section and scrolls the section into view.
- **PASS** — Appearance controls remain shared between Settings and the appearance popover. Theme tiles and 24px accent radio controls update the existing appearance controller. Monospace calls the existing immediate `changeAppearance({ monospace })` path; all eight type roles use Geist Mono when enabled. Reset continues to use the existing controller and turns monospace off.
- **PASS** — `SettingsNavigationController`, operational draft ownership, save/discard, validation, retry, and navigation guard were not changed. Existing settings interaction coverage passed, including failed-save retention and retry.
- **PASS** — Focused new tests, existing appearance tests, lint, build, and rendered fixture proof passed.
- **BLOCKED** — Full `npm test`: 572 passed, 1 failed. The unchanged `tests/settingsLayout.test.tsx` assertion expects the previous `184px minmax(0, 1fr)` and `880px` layout. The task requires `216px minmax(0, 640px)` and an 888px overall width. That existing test was outside this lease and remains unmodified.

## Changed files

- `src/views/SettingsView.tsx`
- `src/components/Appearance.tsx`
- `src/styles/components/appearance.css`
- `src/styles/components/screens.css` — Settings selector blocks only
- `tests/redesignSettingsLayout.test.tsx` — new
- `tests/redesignAppearanceControls.test.tsx` — new
- `docs/research/redesign/implementation-plan/contracts/13-handoff.md` — new

Public component props and controller interfaces are unchanged. `AppearanceControls` continues to accept the shared `AppearanceController`; `SettingsView` keeps its existing props and `SettingsNavigationController` contract.

## Commands and proof

- `npx vitest run tests/redesignSettingsLayout.test.tsx tests/redesignAppearanceControls.test.tsx tests/appAppearance.test.tsx tests/appSettingsInteractions.test.tsx` — pass, 39 tests before the native-select refinement.
- `npx vitest run tests/redesignSettingsLayout.test.tsx tests/redesignAppearanceControls.test.tsx tests/appAppearance.test.tsx` — pass after the final control changes, 16 tests.
- `npm run lint` — pass.
- `npm run build` — pass; Vite reported its existing chunk-size advisory.
- `npm test` — 572 passed, 1 failed as described above.
- Fresh local API/event fixture, sandboxed headless Chromium, no live Quanta or native app: [wide light Settings, 1280×800](/tmp/quanta-redesign-progress/20261116T031220Z/settings-wide-light.png) and [narrow dark Settings with appearance popover, 820×540](/tmp/quanta-redesign-progress/20261116T031220Z/settings-narrow-dark-appearance.png). The run verified all seven sections, 216px/640px columns, Files anchor, narrow select to About, no horizontal overflow, all eight Geist Mono type roles and representative computed fonts, visible sticky save bar (y=437–489), unclipped content (730px scroll/client widths), open appearance popover, and zero browser errors.

T3 preview could not launch because the host lacks `libnspr4.so` and `libnss3.so`; after the second preview call also failed, proof used the repository’s documented sandboxed Chromium runtime. No preview tab or server remains open.

## Coordinator acceptance evidence — 2026-11-16

The old Settings geometry assertion was updated intentionally to the approved 216px/640px layout. Independent review findings were corrected: theme previews resolve their own mode tokens, and the save bar is 48px. A real-App preview regression failed before the mode-color correction and passed after it. Combined frontend gates passed 576 tests across 63 files, lint and build. [Final browser proof](13-final-browser-proof.md) verifies wide/minimum geometry, section navigation, stable mode previews, all-text Geist Mono, reachable 48px dirty/failed-save bars, and unclipped popover scrolling. This supersedes the earlier full-suite block and original 52px measurement. Native Settings/WebView behavior remains unproven.

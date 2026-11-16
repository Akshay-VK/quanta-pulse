# B09B #42 browser acceptance proof

Snapshot: shared dirty HEAD `84c20eb`, 2026-11-16. Read-only production/tests review; no delegates or Git writes. Only this repository artifact was created. Initial handoff preserved.

## Independent review

No actionable findings in bounded scope/parity/draft/save/disabled review.

- Required wire field: `src/lib/types.ts:198`; fixture parity confirmed by searching `notifyAuth:` / `notifyScanFailures` in tests.
- Existing notification organization, generic system-alert copy, draft mutation and global-disable parity: `src/views/SettingsView.tsx:620`–`632`.
- Generic comparison includes this boolean: `src/lib/settingsDraft.ts:66`. Existing save delegates the complete draft (`src/views/SettingsView.tsx:281`); App adopts the existing API response (`src/App.tsx:433`). No transport change.
- Persisted false, failed-save retention/discard and disabled behavior: `tests/settingsScanFailure.test.tsx:55`–`89`; guard coverage: `tests/appSettingsInteractions.test.tsx:71`.

## Browser route and commands

`preview_status({})` returned `available:false`. An initial `preview_open` with `about:blank` returned: “Preview automation open failed: Invalid preview URL (unsupported-protocol: about:; input length 11). Use an http(s) URL or a schemeless host such as localhost:5173. With preview_open, omit url when creating a new tab to open a blank tab.”

Corrected `preview_open({reuseExistingTab:false})` returned exactly:

```text
Preview automation open failed: This host is missing libraries T3's browser needs (libnspr4.so, libnss3.so, libnssutil3.so). Run `sudo /home/akshay-vk/.t3/wsl-runtime/sha256-c089892bf7922e2e73c6f44a5d1ea125c99f70e378c18361cbbed2fba1920e6c/t3 browser setup --base-dir /home/akshay-vk/.t3` on the host to install them, then try again.
```

Copied only config/API/event/capture sources from successful `20261116T034800Z` into fresh external run below; unique HTTP/CDP ports `14762`/`19762`. Mock settings persist in fixture localStorage. Real App/styles/fonts; sandboxed Chromium with extracted runtime libraries, no `--no-sandbox`.

```sh
npx vite build --config /tmp/quanta-redesign-progress/20261116T044822Z-B09B-proof/vite.build.config.ts
node /tmp/quanta-redesign-progress/20261116T044822Z-B09B-proof/capture.mjs
```

Build PASS (dependency directive/chunk-size warnings). First capture timed out waiting for Settings; retry PASS, exit 0. No PNG existed before successful retry. JSON records default true → unsaved false/no save → save false → page reload false → global disable blocks click → reenable → dark true draft while persisted false. Both fonts loaded; zero page errors; 4,233 body characters; switch visible and enabled save/discard within viewport. Own server/browser stopped in `finally`.

## Artifacts and limits

- `/tmp/quanta-redesign-progress/20261116T044822Z-B09B-proof/settings-wide-light.png` — 1280×800 light, saved-off switch visible.
- `/tmp/quanta-redesign-progress/20261116T044822Z-B09B-proof/settings-narrow-dark-draft.png` — 820×540 dark, changed draft/save bar visible.
- Same directory: `settings-proof.json`, reproducible scripts, and `gallery.html` (standalone, embedded local PNGs; suitable for root `html_preview`/`html_render`). Both PNGs visually inspected.

Previously reported focused 67 tests/lint not rerun. Whole tests/build gates remain deferred pending Agenda owner. Fixture Vite build is not the full type-check gate. Native OS notification delivery unproven. Contract delta: none. Root owns integration.

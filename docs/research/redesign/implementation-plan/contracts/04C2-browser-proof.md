# 04C2 real-App browser proof

Task 04C2 / [issue #47](https://github.com/Akshay-VK/quanta-pulse/issues/47). Final fixture artifact directory: `/tmp/quanta-redesign-progress/20261116T045146Z-04C2-final`.

## Method

The shared browser tool returned `{"available":false,"visible":false,"tabId":null}`. The user authorized the external harness fallback. Adapted the 04C1 real-App CDP harness following `/tmp/quanta-redesign-progress/README.md`, using a fresh timestamp directory, HTTP port 14763 and CDP port 19763. The first exploratory run timed out during Runtime.evaluate; it was retried successfully. The final source was built afresh into the final external directory before these captures.

Vite compiles the actual React App. Only `src/lib/api.ts` and the Tauri event bridge are aliased to external fixtures. No screenshot-only production changes. Sandboxed Chromium uses the README's extracted NSS/NSPR libraries. The harness closes its CDP socket and terminates its own Chromium and Vite processes; no final-run listener/process remains.

Date is frozen externally at `2026-11-16T12:00:00Z`, timezone Asia/Kolkata. Fixture inventory has 24 date-only resources: one collapsed past date, one Today, one Tomorrow and 21 This week (one beyond the 20-row cap). Source hashes, API/event fixtures, build configuration and capture script remain beside the PNGs. Source hashes record the leased files plus coordinator-owned App/CalendarView without editing either.

## Final two PNGs

- [1280×800 focused and multi-selected Agenda](/tmp/quanta-redesign-progress/20261116T045146Z-04C2-final/agenda-keyboard-wide.png): keyboard X selects the first row without opening inspection; the row retains keyboard focus. The screenshot shows the neutral selected fill and accent focus outline. Row right edge 1255 is inside the viewport; material action controls are reachable. Past collapse, grouping, timezone and date rendering are visible.
- [820×540 dismissal confirmation](/tmp/quanta-redesign-progress/20261116T045146Z-04C2-final/agenda-keyboard-narrow.png): actual keyboard Delete captures two authoritative event IDs, then opens the confirmation. Copy preserves Inbox-only dismissal scope, History, files and due dates. Cancel is focused. Cancel bounds are x374–440/y324–352; confirmation bounds x448–630/y324–352, both fully reachable. The PNG was taken while the dialog was open; metadata's restored state is measured afterward. Cancel closes the dialog and returns focus to the original selected row.

Both PNG dimensions are checked from their headers. Both were visually inspected. Dark / t3-neutral / comfortable density; body font is Geist Variable, `document.fonts.status` is loaded and the font check passes. Captured page exceptions and error logs: **zero**. Measurements: [keyboard-observations.json](/tmp/quanta-redesign-progress/20261116T045146Z-04C2-final/keyboard-observations.json). Exactly two PNGs are in the final evidence directory.

## Gates

- `npm test -- tests/appAgendaKeyboard.test.tsx`: PASS, 15 tests.
- `npm run lint`: PASS, zero warnings.
- `npm run build`: PASS (existing Vite chunk-size advisory only).
- `npm test -- --maxWorkers=4 --minWorkers=1`: PASS, 603 tests across 67 files. The earlier default-worker full run also passed 602 tests before the final regression was added.
- `git diff --check`: PASS. New leased documents/test are separately checked for trailing whitespace and one final newline.

Logs are external: `/tmp/quanta-04C2-focused.log`, `/tmp/quanta-04C2-final-lint.log`, `/tmp/quanta-04C2-final-build.log`, `/tmp/quanta-04C2-final-fulltests.log`.

## Limits

This proves browser fixture behavior, not native Tauri/OS acceptance or live Quanta data. No packaged app was run. The shared Agenda timestamp styling remains unchanged; the DOM E hint is not claimed as visible pixel evidence. This child does not accept umbrella 04C or task 04. Root remains sole integrator.

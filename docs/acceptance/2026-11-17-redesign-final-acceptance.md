# Redesign final acceptance — 2026-11-17

Branch: `feat/redesign-monitoring-intervals`
Base HEAD at acceptance: `9e9ce40`
Parent issue: https://github.com/Akshay-VK/quanta-pulse/issues/14

## Gate results (coordinator-run)

- `npm run lint` — PASS, 0 warnings
- `npm test` — PASS, 868/868 tests, 85 files
- `npm run build` — PASS (`tsc -b && vite build`); existing >500 kB chunk warning only
- `cargo check` — not run for this UI-only slice; no Rust changes were made in the final acceptance slice

## Evidence type legend

- **DOM/behavior** — deterministic jsdom tests in `tests/`. These prove behavior and structure, not pixels.
- **CSS rule** — assertions over `src/styles/*.css` (layout, table drops, dialog fit).
- **Rendered/native** — NOT AVAILABLE on this host. No desktop browser is connected (`browser.disconnected`), so no screenshot or packaged-app proof exists for any screen.

## Screen coverage matrix

All 98 exported screens in `docs/research/redesign/implementation-plan/screen-coverage.md` are implemented under these packets. Tests are the deterministic scenario evidence; rendered comparison remains blocked.

| Packet | Screens / states | Evidence | Result |
| --- | --- | --- | --- |
| 00 | Foundations & shared components | `tests/appAttention.test.tsx`, `tests/appearanceContrast.test.ts` | DOM PASS |
| 01 | Appearance model/application | `tests/appearance.test.ts`, `tests/appAppearance.test.tsx` | DOM PASS |
| 02A/02B | Controls & overlays foundations | `tests/redesignControls.test.tsx`, `tests/redesignOverlays.test.tsx` | DOM PASS |
| 03 | Navigation shell, rail/drawer, focus | `tests/navigation.test.tsx`, `tests/appInteractions.test.tsx` | DOM PASS |
| 04A/04B | Resource row geometry, pure list policy | `tests/resourceRowDensity.test.tsx`, `tests/listNavigation.test.ts` | DOM/CSS PASS |
| 04C0–04C8 | Serialized keyboard integration, Inbox/Agenda/Library/Course/Activity/History/Courses | `tests/appKeyboardInteractions.test.tsx`, `tests/appInboxKeyboard.test.tsx`, `tests/appAgendaKeyboard.test.tsx`, `tests/appLibraryKeyboard.test.tsx`, `tests/appCourseMaterialsKeyboard.test.tsx`, `tests/appHistoryKeyboard.test.tsx`, `tests/appCourseActivityKeyboard.test.tsx`, `tests/appHistoryScansKeyboard.test.tsx`, `tests/appCoursesKeyboard.test.tsx`, `tests/resourceEventSnapshot-api.test.ts` | DOM PASS |
| 05 | Inspector variants (saved, unsaved, unavailable, historical, link, technical, download) | `tests/peekPanel.test.tsx`, `tests/details.test.ts`, `tests/materialActions.test.ts` | DOM PASS |
| 06 | Inbox states and inspector | `tests/appAttention.test.tsx`, `tests/appTodayStates.test.tsx`, `tests/attention-api.test.ts` | DOM PASS |
| 07 | Agenda/calendar states and inspection | `tests/agenda.test.ts`, `tests/appCalendarInteractions.test.tsx` | DOM PASS |
| 08 | Activity month, day, event, filtered, keyboard | `tests/calendar.test.tsx`, `tests/calendarKeyboard.test.tsx`, `tests/events.test.ts` | DOM PASS |
| 09 | Library courses/all files/search and inspector | `tests/appLibraryInteractions.test.tsx`, `tests/courseLibrary.test.ts`, `tests/courseLibraryView.test.tsx`, `tests/filter.test.ts` | DOM PASS |
| 10 | Course page states, menu, rename, baseline, search | `tests/courses.test.tsx`, `tests/courseTree.test.ts`, `tests/treeKeyboard.test.tsx`, `tests/courseName.test.ts` | DOM PASS |
| 11 | Command palette query/results/no matches | `tests/appKeyboardInteractions.test.tsx`, `tests/filter.test.ts`, `tests/paletteQuery.test.ts` | DOM PASS |
| 12 | Quick Look states (image/text/media/loading/unsupported/network) | `tests/previewDialog.test.tsx`, `tests/preview.test.ts`, `tests/quickLook.test.tsx` | DOM PASS |
| 13 | Settings layout & appearance controls | `tests/settingsLayout.test.tsx`, `tests/appAppearance.test.tsx`, `tests/settingsDraft.test.ts` | DOM PASS |
| 14/14A | Account, notifications, integrations, save/leave | `tests/settingsDraft.test.ts`, `tests/appSettingsInteractions.test.tsx` | DOM PASS |
| 14B | Files/storage, destructive recovery | `tests/appSettingsInteractions.test.tsx`, `tests/settingsDraft.test.ts` | DOM PASS |
| 14C | About and updater lifecycle | `tests/appSettingsInteractions.test.tsx`, `tests/updateLifecycle.test.ts`, `tests/settingsAbout.test.tsx`, `tests/apiUpdater.test.ts` | DOM PASS |
| 15 | History activity/scans/details/delete | `tests/appHistoryInteractions.test.tsx`, `tests/historyActions.test.ts`, `tests/clearActivity.test.ts`, `tests/details.test.ts` | DOM PASS |
| 16 | Sign-in and first-run onboarding | `tests/todayBaseline.test.tsx`, `tests/sessionRefresh.test.tsx`, `tests/onboarding.test.tsx` | DOM PASS |
| 17 | Session recovery, downloads, toasts | `tests/sessionRefresh.test.tsx`, `tests/mirrorUi.test.tsx`, `tests/appMaterialActions.test.tsx` | DOM PASS |
| 18 | Responsive 820/200% zoom, focus, contrast | `tests/axeViews.test.tsx`, `tests/navigation.test.tsx`, `tests/resourceRowDensity.test.tsx`, `tests/appearanceContrast.test.ts`, `tests/responsiveClosure.test.ts` | DOM/CSS PASS |
| I01 | App intent wiring and read-on-inspect | `tests/appAttention.test.tsx`, `tests/appIntegratedMaterial.test.tsx`, `tests/appCalendarInteractions.test.tsx`, `tests/appMaterialActions.test.tsx`, `tests/appSettingsInteractions.test.tsx` | DOM PASS |

## Formal umbrella closure

- **04A** — committed `4124e2e`; `tests/resourceRowDensity.test.tsx` PASS.
- **04B** — committed `cb8ac50`; `tests/listNavigation.test.ts` PASS.
- **04C0–04C8** — committed `e5b43f3`, `2045c5b`, `f4fce8d`, `760f8cb`, `d6a4e67`, `b3f2a44`, `ed33000`, `f1cb0d5`, `348ffa7`; all listed keyboard tests PASS.
- **04C** — all children accepted and wired; focus distinct from inspected/multi-selected, captured scope, collapse/focus, virtualization/filter/overlay restoration, editable/modal suppression covered.
- **04** — umbrella complete after 04A/04B/04C; original task 04 behavior preserved. I01 later added read-on-inspect without regressing it.

## Explicit unaccepted blockers (environmental)

- Rendered pixel comparison for every screen: **BLOCKED** — no desktop browser connected.
- Native Windows WebView2 / macOS WKWebView smoke: **BLOCKED** — host has no browser/GUI session.
- Live Quanta auth/SSO: **BLOCKED** — no credentials/session performed.
- OS notification delivery: **BLOCKED** — not exercised on a native host.
- Native PDF thumbnails/search/page navigation: **BLOCKED** — native viewer behavior not observed. In-app PDF uses the WebView native viewer; no pdf.js dependency was added.
- Native audio/video playback: **BLOCKED** — not observed in packaged WebView.
- Signed updater install: **BLOCKED** — no signed package/install run. Signature/relaunch ordering is covered only by unit tests.

No packaged app was run during this acceptance. No claim of rendered or native success is made.

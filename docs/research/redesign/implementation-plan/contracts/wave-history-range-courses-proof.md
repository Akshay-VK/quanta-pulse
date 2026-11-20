# Frozen History / range / Courses wave proof — 2026-11-16

Fresh read-only acceptance/evidence worker at HEAD `5927fe55cd42e1bc3b2fa369c4c5de4a7278e75c` plus frozen pending patches. Root alone integrates. No delegates, Git writes or source/test edits. Scope: History Changes and two root corrections, B05C hash/API verification, Courses hub navigation/root seams, course-color exhaustion fix. No actionable defect found in this bounded inspection or fresh proof.

## Terminal gates

All commands below completed with exit 0; no runner remains active.

- `npx vitest run tests/appCoursesKeyboard.test.tsx tests/appHistoryKeyboard.test.tsx tests/courseName.test.ts tests/eventsRangePaging-api.test.ts --maxWorkers=4 --minWorkers=1`: four files, **53 tests passed** (Courses 8, History 22, allocator 16, API 7), duration 82.06s. `focused.log`.
- `npm run lint`: PASS, zero warnings. `lint.log`.
- `npm run build`: PASS, existing bundle-size advisory. `build.log`.
- `npm test -- --maxWorkers=4 --minWorkers=1`: **77 files, 761 tests passed**, duration 450.33s. `full-test.log`. Exactly one combined full runner, no concurrent full suite. Output includes jsdom canvas/React act diagnostics and intentional failing CLI fixture messages; terminal result is exit 0, no failed tests.
- `git diff --check`: PASS. Explicit three-new-document trailing-whitespace and single-final-newline validation: PASS.

All terminal logs and machine-readable results are in `/tmp/quanta-wave-final-evidence`. `terminal-results.json` records exits/counts; `source-before.json` and `source-after.json` enumerate SHA-256 for all 232 files under src, tests, src-tauri/src and src-tauri/migrations. Their byte-identical aggregate SHA-256, before **and** after gates/browser proof:

`7e40fb1636d744462ad22898a4123611195fe91bcf66c40fcc35a62bcc1e3385`

## Bounded findings and preserved behavior

History: fresh 22-test App suite includes root's read-confirmation primary focus (`.dialog-primary`) and disconnected search-ref return-false behavior allowing destination heading fallback after unmount. Dismissal retains Cancel initial focus. Complete paged captures, baseline exclusion, stale settlements, editor/modal ownership and write/refresh failure behavior pass. Existing History/inventory/action regressions also pass in the full suite. Original History PNGs at `/tmp/quanta-redesign-progress/20261116T080500Z-04C5-final/` predate those two corrections; no new PNG or visual claim for those corrections is made. Prior dismissed/focused paths remain unchanged.

B05C: commands.rs/db.rs/api.ts/new API test hashes below exactly match B05C-handoff.md. Its existing Windows cargo-check and 262-passed/1-ignored native proof therefore remain applicable to this frozen patch. Native not rerun; no new native/live claim. Seven API tests pass freshly. No unrelated native deep review.

Courses: eight fresh tests include seven actual App cases and one direct-props recovery case; root's lazy CourseList import avoids mocking-order contamination. Native Enter/Space proof comes from the actual browser, each yielding one trusted primary click and Course 1 navigation. Local navigation reaches 65 courses in both directions, with no material-key API calls. All seam/style/source hashes remain frozen.

Allocator: sixteen tests pass, including isolated-worker termination deadline, 65 courses, original first-twelve assignments, saved indices, repeated/reversed calls and occupied palette. Actual browser starts with empty localStorage and persists 65 colors without a UI hang. Root's separately reported old-HEAD bounded RED proof was not repeated or relabeled as this worker's run.

## Browser and artifacts

[04C8 browser proof](04C8-browser-proof.md), [04C8 handoff](04C8-handoff.md). Actual App/API+event-only aliases; no seeds/production mocks/style overrides. Exactly two retained, visually inspected PNGs under `/tmp/quanta-redesign-progress/20261116T081840Z-04C8-acceptance-final`: `courses-focus-wide.png` 1280×800 and `courses-filter-menu-narrow.png` 820×540. Dark/t3-neutral/comfortable, loaded Geist, zero browser errors, 2px inset bar/ring and 2px outline offset, offscreen scroll and native menu/filter reachability proved. `keyboard-observations.json` and `capture-metadata.json` contain exact labels, calls, geometry, trust and artifact/bundle hashes.

preview_status unavailable; preview_open failed missing NSS libraries. Authorized extracted-runtime sandbox Chromium fallback used; external harness-only selector/CDP text corrections made before final successful capture. Final ports 14966/19966 and earlier attempt ports all closed. Browser/server stopped; no packaged app run.

## Frozen file hashes

```text
src/views/HistoryView.tsx 9ea3deddbe091b1dd6ffe6d2ac3aa3521afbbda4b05b2f4cc6aec3acea3d78ff
src/views/library/CourseList.tsx 3d612244724354608cf3c967141dab1dacdaaaf772e940b00215121b117f24a8
src/views/LibraryView.tsx f300cd7952c5b58c25e4e82c700e9a5a6952f1d7bba9705ac27bce97fdf3435e
src/styles/components/screens.css bd0b6a76bbcf0b8fed8172e78d15bb96cf7a17bf2bbac01a14a1da9521063d23
src/lib/courseName.ts 16456ccadec130095dc8ce465e837a6fb23852da25a962a88ced71fe71e00b69
tests/appHistoryKeyboard.test.tsx f52a9936587d6e7013919c92bea1d3d086d7ac57bdbedb30d767ec99c1744e7a
tests/appCoursesKeyboard.test.tsx e491be75763a0ab4460aa9b945e3e7a8bd25140e5cebaa34b621ae954c1f0086
tests/courseName.test.ts a31cfc9aecd750d2281eee5ac292abb19c30db2d2a0d212ae0aa53fa78522e05
src-tauri/src/commands.rs ad9721becb51276807decf16613876692ecea5d25c7f8e090d4d05e3c88602e3
src-tauri/src/db.rs 35df0b79e717bcf489f3b8916ae307852da8d2d032be64a449e11250357152ea
src/lib/api.ts 32090277d726b1e693b013cba0f8f9e7ae7dc3301ede38850d59143a325a6fdc
tests/eventsRangePaging-api.test.ts 24eb07fce69279b40094d83d83fa0a5754fe528d74b1c73e7f8ac95e679713dd
```

Only the three leased evidence documents were created in the repo. Original 04C5/B05C/color reports, unrelated work and source/tests preserved. No issue/wiki acceptance, no umbrella task04/04C acceptance. Remaining Activity/Scans/collapse/task10 and native/live acceptance stay with root and later owners.

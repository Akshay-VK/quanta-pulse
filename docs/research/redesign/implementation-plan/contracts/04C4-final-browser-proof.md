# 04C4 final Course Materials browser proof — 2026-11-16

Bounded acceptance 6 recheck after root's 1px → 2px focus-ring correction. Actual React App from shared HEAD `d0092fd1767a2891ab4fa64ffe01962bad041de0` plus current working-tree patches, including App's `queryHistoryInventory` integration. Production, tests and Git unchanged by this worker; no delegates.

## Result

PASS for the requested browser prerequisite. At 1280×800, actual keyboard navigation focuses `resource:file-2`, independently of multi-selected `resource:file-1`; no inspected row. `:focus-visible` is true. Computed `box-shadow`: `rgb(154, 162, 240) 2px 0px 0px 0px inset, rgb(154, 162, 240) 0px 0px 0px 2px inset`; focus token `#9aa2f0`. This proves the 2px left bar and 2px inset ring. No horizontal document overflow; 26 of 321 structural/material rows mounted. All four nested controls have visible in-viewport geometry; Tab reaches title, Preview and Download and open buttons.

Real virtualized J navigation reaches offscreen `resource:file-242`, scrollTop 8414, 37 mounted rows. At 820×540, Inbox-only dismissal displays 2 changes across 1 selected material with retained Library/History/saved-files/baseline copy; Cancel owns focus. Cancel rectangle is (383,314)–(449,342), destructive button (457,314)–(630,342). Cancel removes the dialog and returns exact DOM focus to `resource:file-242`. Separate Shift+A captures all resource IDs 1–320 and confirms 640 changes across 320 materials; canceled without mutation.

Dark / t3-neutral / comfortable; Geist loaded, document fonts ready. Zero runtime exceptions or browser error entries. Both PNGs visually inspected.

## Reproduction and evidence

Fresh external run: `/tmp/quanta-redesign-progress/20261116T070653Z-04C4-final`. Copied prior complete harness; only external API fixture adds paginated `queryHistoryEvents` over existing history events and audit observations. One App resource inventory request, offset 0 / limit 2000; History request offset 0 / limit 1000. No production mock route or style overrides.

- `npx vite build --config /tmp/quanta-redesign-progress/20261116T070653Z-04C4-final/vite.build.config.ts` → PASS, existing bundle-size advisory only.
- `node /tmp/quanta-redesign-progress/20261116T070653Z-04C4-final/capture.mjs` → PASS; sandbox-enabled Chromium, HTTP 14917 / CDP 19917; both stopped, ports confirmed closed.
- Source manifest checked before and after capture: no drift. SHA-256 `79921167283da23795c5d0aa85aaa015da8515cf1afdbd86db534e5ca54ad24f`.
- App.tsx SHA-256 `0ef9833d8c60aa3806ecebf854c04d4aabda3ab9cef6413d746443cd7084486c`.
- content.css SHA-256 `0fe8b18ed11d13690890d6ce947437b12e0f81ac6f9468c76a1ab6ca85f20c5a`.

Exactly two fresh PNGs (SHA-256):

- `/tmp/quanta-redesign-progress/20261116T070653Z-04C4-final/course-focus-selection-wide.png` — 1280×800, `d68a92eba1ca33366e96e97c4b2044d9d11c35b3541f1923043d1532cfee8084`.
- `/tmp/quanta-redesign-progress/20261116T070653Z-04C4-final/course-dismiss-narrow.png` — 820×540, `a79cf123d2e85b42c83131e1e6793d695b6fbedfc25120ff252bcac95897d289`.

`keyboard-observations.json` records computed geometry, control rectangles, complete captured IDs and focus restoration. `capture-metadata.json` records source/bundle/PNG hashes, sizes and timestamps; `source-manifest.json`, build/capture logs and optional absolute-image `gallery.html` are alongside them.

`preview_status` reported unavailable; `preview_open` failed with missing `libnspr4.so`, `libnss3.so`, `libnssutil3.so`. Used explicitly authorized README fallback with existing extracted runtime and sandbox enabled.

## Limits and next consumer

This proof supersedes the two historical 1px-ring PNGs only for corrected visual acceptance; historical artifacts/reports remain untouched. Fixture browser evidence establishes no native desktop/live Quanta/SSO acceptance. Light/other densities and broader behavior are outside this bounded recheck. Root/App integration worker owns source CSS gates and final full tests; not duplicated here. No issue/wiki changes or broader acceptance claim.

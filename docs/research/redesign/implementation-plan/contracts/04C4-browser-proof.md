# 04C4 Course Materials browser proof — 2026-11-16

Approved #50, implementation base supplied as `0f5f510`; accepted prerequisites 04C3 `760f8cb` and B10 `330855c`. Actual React App, deterministic API/native event fixtures only; no production fixture route, CSS or native changes by this worker.

## Runner and artifacts

`preview_status` returned unavailable. `preview_open` failed: “This host is missing libraries T3's browser needs (libnspr4.so, libnss3.so, libnssutil3.so).” Used the explicitly authorized external README/04C3 fallback. Fresh directory: `/tmp/quanta-redesign-progress/20261116T065000Z-04C4`; HTTP 14884, CDP 19884. Extracted NSS runtime, Chromium sandbox enabled. Server/browser terminated after capture.

Commands, both exit 0:

- `npx vite build --config /tmp/quanta-redesign-progress/20261116T065000Z-04C4/vite.build.config.ts`
- `node /tmp/quanta-redesign-progress/20261116T065000Z-04C4/capture.mjs`

Exactly two fresh PNGs, both visually inspected:

- `/tmp/quanta-redesign-progress/20261116T065000Z-04C4/course-focus-selection-wide.png` — 1280×800. Resource file-1 independently multi-selected; resource file-2 has DOM keyboard focus. No inspector. Real tree virtualization: 26 of 321 structural/file rows mounted. No horizontal document overflow. Title and nested material controls have positive visible geometry inside the viewport.
- `/tmp/quanta-redesign-progress/20261116T065000Z-04C4/course-dismiss-narrow.png` — 820×540. Inbox-only captured dismissal, explicit resource/event counts and retained Library/History/files/baseline copy. Cancel focused; both modal buttons fit. After Cancel, no dialog and exact `resource:file-242` DOM focus restored.

Machine observations: `keyboard-observations.json` alongside fixture, config, capture script and build. Browser pressed J 241 times through the actual virtualizer; resource file-242 focused, tree scrollTop 8414, only 37 rows mounted. Fonts ready, Geist font check passed; dark/t3-neutral/comfortable. Zero runtime exceptions and browser error entries.

## Comparison and limits

Inspected only assigned CourseExpanded, CourseSearch, CourseNoMatches, CourseEmpty, CourseLoadFail, LibraryLight, RespCourse, FocusRow and FocusDialog references. Existing course tree/layout/search/path/empty states remain their owners. Independent neutral multi-selection, inspection class and keyboard focus consume root's token CSS; no focus-as-selection ARIA. Source inspection found root's keyboard bar is 2px but inset ring remains 1px; §6 requires a 2px ring. Sent root the exact CSS correction; visual acceptance remains blocked on that root-owned prerequisite. Narrow dismissal fits the minimum viewport and visibly rings Cancel. Light mode and alternate density were reference-inspected, not separately captured. Existing single-column course hierarchy and toolbar differ from the design's two-pane composition; no task 10/18 redesign claimed.

Captures preceded final focus lifecycle edge-case cleanup and singular-count grammar adjustment; these do not change pictured tree geometry or dialog controls. Final behavioral gates cover the final source. This fixture browser proof establishes neither native desktop integration nor live Quanta/SSO behavior.

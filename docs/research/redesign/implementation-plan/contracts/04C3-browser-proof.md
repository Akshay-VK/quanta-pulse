# 04C3 All files browser proof — 2026-11-16

Approved #48, foundation `772764b`. Actual React App with only API/native event boundaries replaced by deterministic fixtures. No production fixture routes or source files were added. Browser proof does not establish native desktop acceptance.

## Runner and artifacts

`preview_status` reported unavailable. Required `preview_open` failed: “This host is missing libraries T3's browser needs (libnspr4.so, libnss3.so, libnssutil3.so).” Used the explicitly authorized `/tmp/quanta-redesign-progress/README.md` fallback, copying the successful 04C2-final configuration and fixture into fresh `/tmp/quanta-redesign-progress/20261116T060212Z-04C3`. HTTP 14883, CDP 19883; extracted NSS runtime; Chromium sandbox enabled (no `--no-sandbox`). Server and browser terminated successfully after capture.

Commands:

- `npx vite build --config /tmp/quanta-redesign-progress/20261116T060212Z-04C3/vite.build.config.ts` — PASS.
- `node /tmp/quanta-redesign-progress/20261116T060212Z-04C3/capture.mjs` — PASS, terminal exit 0.

Exactly two fresh PNGs, viewed after capture:

- `/tmp/quanta-redesign-progress/20261116T060212Z-04C3/library-focus-selection-wide.png` — 1280×800. Focus on `file-2`, independent local selection on `file-1`, no inspector/read mutation; 25 of 320 rows mounted. No document overflow. Focused-row controls have positive visible geometry within the viewport.
- `/tmp/quanta-redesign-progress/20261116T060212Z-04C3/library-dismiss-narrow.png` — 820×540. Destructive captured-event confirmation; Cancel focused, both buttons inside viewport. After cancellation, dialog absent and `file-242` restored exactly.

Machine-readable observations: `/tmp/quanta-redesign-progress/20261116T060212Z-04C3/keyboard-observations.json`. Fresh fixture/config/script/build are alongside these artifacts.

## Observed behavior and comparison

Dark / t3-neutral / comfortable, Geist variable loaded (`document.fonts.ready`, loaded status and font check passed). Zero captured runtime exceptions or browser error log entries. Browser keyboard input moved through 241 rows to `file-242`; scrollTop 7805, only 34 rows mounted. This exercises the actual DataTable scroll-to-mount seam, not a virtualization replacement. Narrow dialog contains exact Inbox-only semantics and captured resource/event counts; cancellation preserves local selection and materials.

Compared the assigned FocusRow/FocusDialog and LibAllFiles/LibAllInspector/LibSearch references only. Existing table, search, course filters, inspector and responsive rail remain their accepted owners. Focus ring and bar, independent neutral selection, dark destructive modal and Cancel ring follow their established token styling. Existing column layout can scroll internally at narrow widths; this task does not claim a full responsive table redesign, search highlight redesign, saved-state column replacement or all 98 screens. Existing two-line titles may exceed the virtualizer's nominal 34px estimate; the observed browser navigation and return passed despite that pre-existing layout limitation. Focus/action geometry and modal reachability are browser evidence, not OS-level keyboard or native file-action proof.

The captures precede the final refresh-publication acknowledgement and disconnected-list restoration adjustments. These affect mutation completion and tab-unmount fallback respectively; neither changes the captured mounted-list behavior. Final regression gates separately cover that adjustment; the pictured focus, selection, snapshot dialog and virtual navigation paths are unchanged.

# 04C5 History Changes browser proof — 2026-11-16

Actual fixture App, accepted base `18b323f` plus the leased History patch and concurrent root/B05C changes. No production fixture route, dummy API or CSS override. This is fixture browser evidence, not native/live Quanta acceptance.

Final harness: `/tmp/quanta-redesign-progress/20261116T080500Z-04C5-final`. API/native event aliases only, copied from the named 04C4 final harness. `queryHistoryEvents` slices the full fixture inventory by offset/limit and reports its complete total. Actual App executes production `queryHistoryInventory`. Distinct Changes span three local-day groups; no collapse or virtualization.

PASS:

- `history-focus-selection-wide.png`: 1280×800. `change:104` is multi-selected; keyboard focus is independently on `change:103` (Tutorial Sheet 8); no inspector. Shared token focus bar and native row-select focus ring are visible. No horizontal document overflow.
- `history-dismiss-narrow.png`: 820×540. Delete captures selected event 104 while focus remains associated with event 103. Exact Inbox-only retention copy and captured count are visible. Cancel initially owns focus. Both buttons have positive, in-viewport rectangles. Cancel closes without mutation and returns focus to the exact event 103 row identity.
- Dark / t3-neutral / comfortable. Geist loaded; document fonts ready. Zero runtime exceptions and browser error log entries. Both final PNGs visually inspected.

Artifacts are absolute paths under the final harness directory. `keyboard-observations.json` records computed appearance, geometry, focus, overflow, console errors and identity return. `capture-metadata.json` records exact PNG/bundle hashes and leased source hashes. The final PNG pair supersedes the first external trial pair; no design export is used as implementation proof.

Browser tooling: `preview_status` returned unavailable. `preview_open` (without URL) failed: “This host is missing libraries T3's browser needs (libnspr4.so, libnss3.so, libnssutil3.so).” Used the explicitly authorized 04C4/README fallback: existing extracted NSS runtime, sandbox-enabled Chromium, fresh HTTP 14926/CDP 19926 and fresh profile/output directory. The earlier invalid `about:blank` argument was corrected by omitting URL before falling back.

Commands: `npx vite build --config /tmp/quanta-redesign-progress/20261116T080500Z-04C5-final/vite.build.config.ts` and `node /tmp/quanta-redesign-progress/20261116T080500Z-04C5-final/capture.mjs` both PASS, terminal exit 0. External alias build emits dependency directive notices and the existing bundle-size advisory. Browser/server exited; both ports closed. No packaged app was run.

Frozen source SHA-256:

- `src/views/HistoryView.tsx`: `eb043716b663b74d7551e00675f601089a600be07d021a5e63b4ae39b0c981a8`
- `tests/appHistoryKeyboard.test.tsx`: `418da4cdce5103b8b31751f2c7862ce55befe3ac3ab50682de04d87782914216`

CourseList/root changes remain outside this file-specific source attestation. Full combined frontend gate: **root-pending**, after both workers freeze. No umbrella/issue/wiki acceptance.

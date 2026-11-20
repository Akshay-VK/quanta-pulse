# 04C3 All files keyboard handoff — 2026-11-16

Task 04C3 / approved [#48](https://github.com/Akshay-VK/quanta-pulse/issues/48) / foundation `772764b` / uncommitted worker patch. Root is sole Git writer. This child does not accept 04C, 04, History, Course or other screen owners.

## Contract and ownership

No exported contract changes. AllFiles consumes the four accepted optional adapters (`onChanged`, `onFocusSearch`, `inventoryPending`, `inventoryError`), keyed DataTable navigation and DetailsAdapter restore callbacks. It uses existing `getListNavigationIntent`, `recoverFocusedId`, material destinations and API event snapshot/mutation owners. App remains complete resource inventory, global count and refresh owner; no additional resource queries, History scope queries or invoke calls were added.

Only worker-owned files changed: `src/views/library/AllFiles.tsx`, new `tests/appLibraryKeyboard.test.tsx`, this handoff and `04C3-browser-proof.md`. Concurrent Settings and root documentation changes and unrelated untracked research were preserved. No delegation, branch, stage, commit, push, PR, issue/wiki update, shared-source or CSS edits.

## Acceptance and preserved behavior

1. Stable external identities with local fallback; independent local keyboard focus, multi-selection and App-owned inspection; J/K/arrows, one Enter, X, Space material preview. No read-on-inspect change.
2. Existing full App inventory, dedupe, search fields and sort remain intact. Shift+A synchronously copies matching numeric resource membership before awaiting the authoritative complete event snapshot and policy-confirmed read dialog. Real App fixture spans 2005 resources across pages; DOM remains virtualized.
3. E/U use selected matching membership or focused fallback, only captured eligible event IDs. Delete dismisses Inbox events only; retained Library materials, History, saved files and baseline are stated explicitly. Cancel is inert; later arrivals never widen the copied scope; empty/failing capture is visible.
4. Generation ownership guards snapshot, mutation, stale success, rejection and finally continuations. Context changes/unmount invalidate captures. Duplicate action locks span snapshot, mutation and awaited App refresh. Failed confirmations retain IDs; successful backend writes remain remembered when refresh fails, offering refresh-only retry. A render acknowledgement reads App's prop-published inventory error after refresh completion. Pending/failed inventory blocks new mutations while retained inspection stays available; frozen confirmations remain stable.
5. Row-scoped bubbling shortcuts stop handled intents before App global handlers. Nested controls, editable/search targets, prevented events, modifiers, repeat, IME/229 and open modal/menu/listbox/drawer guards preserve their owners. Inactive Library tabs unmount this owner.
6. Focus recovers by identity and old neighbors, selection prunes to current matches; restoration occurs only for list-owned focus or explicit callback. Search is empty/missing fallback while this list is mounted. A disconnected list returns false from its restore callback, preserving App's destination heading fallback after tab/route removal. Keyed scroll-to-mount and disconnected-origin inspector restoration preserve true virtualization and session scrolling.

## Verification record

- `npx vitest run tests/appLibraryKeyboard.test.tsx --maxWorkers=1 --minWorkers=1` — PASS: 15 tests, run 83.66s.
- Final correction: `npx vitest run tests/appLibraryKeyboard.test.tsx tests/appLibraryInteractions.test.tsx --maxWorkers=1 --minWorkers=1` — PASS: 2 files / 23 tests (16 new keyboard tests and all 7 existing Library interaction tests), 75.96s. Fixes tab-unmount restoration entirely in AllFiles; no unleased test correction needed. The pre-wiring three-test run failed; subsequent regression runs also caught the refresh-publication race. Virtual-scroll DOM geometry was completed with actual scrollHeight and asynchronous scrolling; virtualization was never disabled.
- `npm run lint` — PASS, zero warnings (terminal final run after all source/test edits).
- `npm run build` — PASS, TypeScript and Vite; 2109 modules. Existing >500kB chunk advisory only.
- `git diff --check` — PASS. Explicit checks of all four leased files, including new test/documents: no trailing whitespace and exactly one final newline, PASS.
- Final stable assembled `npm test -- --maxWorkers=4 --minWorkers=1` — PASS, exit 0: 71 files / 651 tests, 399.19s, started 06:29:29 UTC. Both AllFiles and stable B10 sources were frozen throughout this run. Log: `/tmp/quanta-redesign-progress/20261116T060212Z-04C3/final-full-test.log`.
- Full suites were serialized with an OS process-exit wait behind B10. The intervening run terminated with 649 pass / 1 fail because it had already loaded the pre-correction tab-restoration callback; it is superseded by the final stable run above. Existing nonfatal React act warnings, jsdom canvas/axe messages, and intentional negative release/version fixture output remain; the final suite exited 0. No native gates were required or run because Rust was untouched. Earlier regression runs exposed and fixed the App refresh-publication race. Long-list DOM proof supplies browser geometry/scrolling while retaining the real virtualizer; browser proof independently navigates to resource 242.

Rendered evidence: see [04C3-browser-proof.md](04C3-browser-proof.md). Two fresh PNGs at 1280×800 and 820×540, dark/comfortable; 320-item fixture, loaded Geist, zero browser errors, focus/selection separation, offscreen navigation, Cancel focus and exact identity return. No native packaging, OS focus/file execution, backend transactional cross-page inventory snapshot or complete responsive redesign is claimed. Existing column scrolling and variable row-height limits remain with shared layout owners. No new root seam is required.

## Completion boundary

Acceptance bullets 1–6: PASS for this bounded AllFiles task, with focused App, complete assembled gate and browser evidence above. All required commands reached terminal outcomes. No outstanding blocker or root correction. Root can review the four-file uncommitted patch; no acceptance, merge, issue update or umbrella completion was performed by this worker.

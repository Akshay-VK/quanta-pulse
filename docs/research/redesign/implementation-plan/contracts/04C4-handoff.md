# 04C4 implementation handoff — 2026-11-16

Task / issue / base / patch: 04C4 / #50 / supplied shared HEAD `0f5f510`, 04C3 `760f8cb`, B10 `330855c`. Uncommitted worker patch; root alone writes Git. Observed final-gate HEAD `d0092fd1767a2891ab4fa64ffe01962bad041de0`.

Acceptance:

1. PASS: Materials consumes App's complete published inventory, filters course/dedupes, retains existing search/type/category/sort/tree/path/scroll behavior; no Materials resource query. Actual-App 2005-resource paging, dedupe/course exclusion, pending/error retention tests.
2. PASS: accepted navigation/recovery policies; namespaced folder/resource identity, independent DOM focus/inspection/resource selection. Native folder Left/Right/Enter and typeahead preserved. Space uses existing material actions, no acknowledgement.
3. PASS: complete matching resources include collapsed/offscreen files; authoritative event snapshots exclusively determine writes. Shift+A/retained Inbox dismissal confirmations show counts; Cancel inert, empty scope explicit. Global counts refresh; no History/baseline/file deletion.
4. PASS: generation/duplicate guards, stale snapshot/mutation success/rejection, tab/filter/course/route/unmount invalidation; capture retries preserve IDs. Successful mutation remembered separately; refresh-only retry observes published inventory errors.
5. PASS: treeitem-only Materials handling; nested controls/editors/prevented/IME/229/repeat/modifiers/overlays guarded. Global navigation/search/Escape remain with App.
6. Behavioral PASS; visual prerequisite BLOCKED: stable virtual keys, identity scroll-to-mount/restore, collapsed ancestor/search fallback, matching-membership pruning, superseding/modal focus guards. Added red→green real-App regression for nonvirtual inventory growing into virtualization during inspection. Root classes consumed, but content.css's keyboard focus inset ring is 1px; spec requires 2px. Root owns the exact correction `inset 0 0 0 1px var(--focus)` → `inset 0 0 0 2px var(--focus)` in `.tree-row.keyboard-focused:focus-visible`.

Changed files: CoursePage.tsx, TreeRow.tsx, new appCourseMaterialsKeyboard.test.tsx; authorized fixture/assertion adaptations in treeKeyboard.test.tsx and courseLibraryView.test.tsx; this record and browser proof. No App/LibraryView/CSS/API/type/Rust/hook edits by worker.

Contract delta: CoursePage consumes existing `inventoryPending?: boolean`, `inventoryError?: string | null`, awaitable `onChanged: () => void | Promise<void>`. TreeRow adds optional `multiSelected`; `aria-selected` describes resource multi-selection; `selected` remains inspection, `focused` keyboard state. Stable `data-row-key` identities and virtual keys.

Authorized assertion changes:

- treeKeyboard's `selectedIndex()`: `el.getAttribute("aria-selected") === "true"` → `el === document.activeElement`; every navigation assertion retained.
- courseLibraryView arrow assertion → `expect(document.activeElement).toBe(treeRows()[1])`; typeahead locator → DOM active element.
- Obsolete three capped `listResources` calls → `onChanged` called once, `listResources` never called, error copy retained after Retry.
- Both direct fixtures now supply inventory; loading/error fixtures publish pending/error props. Accepted 04C4 supersedes focus-as-selection and duplicate capped query assumptions.

Commands: focused three suites PASS 35/35; transition regression FAIL before fix, PASS after. Final lint/build PASS (existing bundle-size advisory). Full `npm test -- --maxWorkers=4 --minWorkers=1` PASS 73 files / 699 tests, 420.54s. `git diff --check`, all seven worker-file whitespace/exactly-one-final-newline checks PASS. Source drift against manifest: none. Logs alongside browser artifacts.

Evidence: [browser proof](04C4-browser-proof.md), two external PNGs and observations under `/tmp/quanta-redesign-progress/20261116T065000Z-04C4`. Dark/comfortable, fonts loaded, zero browser errors; exact offscreen identity return. Final source manifest SHA-256 `4edb2bf07c2d00bf2f511a89adb9168b9a41e3b596a9abf8a82b397424fd43d0`.

Limitations: fixture browser proof excludes native desktop/live Quanta/SSO. Activity's capped event source and existing rendering/header/reset/mirror/download preserved; Activity/History/Courses/umbrella acceptance deferred. Root-owned adapters/CSS and unrelated History foundation are included in final gates, not claimed as worker edits.

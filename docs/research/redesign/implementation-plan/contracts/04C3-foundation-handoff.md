# 04C3 coordinator foundation handoff — 2026-11-16

Scope: approved 04C3 [#48](https://github.com/Akshay-VK/quanta-pulse/issues/48), accepted source base `f4fce8df0cef6ea5fbab7aa6efc0466df77a37e3`. HEAD observed during work: `f54e9e5d36623cf1cfbe0076c7c8de4c0194980d` (concurrent documentation commits permitted). Uncommitted foundation patch only; root remains sole Git and App writer. Concurrent B08B API/native/fixture changes were left untouched.

## Interfaces ready for the AllFiles worker

`DataTable` exports `DataTableNavigationHandle`:

```ts
focusKey(key: string | number): boolean;
getRowElement(key: string | number): HTMLTableRowElement | null;
```

Additive optional props: `focusedKey?: string | number | null`, `multiSelectedKeys?: readonly (string | number)[]`, `onRowFocus?: (row: T) => void`, `navigationRef?: Ref<DataTableNavigationHandle>`.

Keys come from `getKey`; the real virtualizer also uses those keys. `focusKey` returns false for a missing key or an unmounted table; otherwise true denotes an existing target, including when a modal suppresses focus. Mounted targets focus immediately. Virtual targets scroll to their current full-row index and focus after DOM mount. Every request supersedes pending focus (including absent-key requests). An open dialog, alertdialog, menu or listbox cancels/suppresses focus; unmount and key removal cancel pending focus. Refresh alone does not request focus. A superseding mounted target also redirects the prior virtual scroll. `getRowElement` returns null offscreen. No list key bindings or selection policy are installed.

Navigation props enable `.keyboard-list`, row `data-row-key`, roving row tab stops (focused matching key, otherwise first row), `.keyboard-focused`, and `.multi-selected`. `onRowFocus` fires for the row itself only; nested controls preserve native focus/click behavior. Existing inspection `.selected` stays separate. Scoped token-based CSS gives multi-selection a neutral fill/border, inspection its existing fill, keyboard identity a focus bar and actual row focus an inset outline; dimensions remain 34px.

`LibraryView.onChanged` now accepts `() => void | Promise<void>`. It passes AllFiles `onChanged`, `onFocusSearch` (existing SearchField input ref), `inventoryPending={loading}`, `inventoryError={error}`. CoursePage's existing void callback remains compatible. AllFiles declares these four optional props but does not consume them yet; the next worker owns behavior.

## Root App patch still required

Only at the LibraryView call in `src/App.tsx`:

```diff
-          onChanged={() => void refresh()}
+          onChanged={refresh}
```

Without this root patch, AllFiles cannot await the App refresh completion. No App source was edited here.

## Verification

- `npx vitest run tests/dataTableKeyboard.test.tsx --maxWorkers=1 --minWorkers=1`: PASS, 1 file / 7 tests, final run 46.67s, no console warnings. Test authored before adapter wiring; initial harness failures (jsdom missing scrollTo and unsupported matcher) corrected. A subsequent behavioral failure caught mounted-target supersession losing focus to the earlier virtual scroll; the final fix redirects every valid virtual focus request.
- `npm run lint`: PASS, zero warnings (final rerun after source fix).
- `npm run build`: PASS, TypeScript and Vite; 2109 modules transformed. Existing >500kB chunk advisory remains. Confirmed generated bundle includes final superseding-scroll behavior.
- `git diff --check -- src/components/DataTable.tsx src/styles/components/content.css src/views/LibraryView.tsx src/views/library/AllFiles.tsx`: PASS. Explicit Python checks of all six leased files, including new test/handoff: no trailing whitespace and exactly one final newline, PASS.
- Full `npm test -- --maxWorkers=4 --minWorkers=1`: NOT RUN here. A pre-existing B08B/shared runner (`vitest run --maxWorkers=4 --minWorkers=4`, PID 4139159) remained active at final verification. No duplicate full suite was started and its result is not claimed. Root must obtain that runner's result and run/coordinate the assembled full gate after the remaining App/AllFiles integration.

Deterministic jsdom proof uses 320 rows, measured 170px viewport, 34px row estimates, real TanStack virtualization, browser-like asynchronous scroll events and no virtualization mock. Coverage: offscreen scroll-to-mount with fewer than 40 rows mounted; current indices after reversing order; disappearing/missing keys; superseding mounted and absent-key requests; unmount/handle cleanup; modal opening, suppression and no replay after close/refresh; independent inspection/focus/multi-selection classes and tab stops; native button/link/input interaction; unchanged non-navigation markup/clicks and unhandled keys. CSS dimensions/tokens are source-reviewed only. No rendered/native desktop or next-worker AllFiles acceptance is claimed; screenshots were explicitly excluded for this foundation.

## Boundary

Changed files: `src/components/DataTable.tsx`, scoped `.data-table.keyboard-list` additions in `src/styles/components/content.css`, adapter-only `src/views/LibraryView.tsx`, declaration-only `src/views/library/AllFiles.tsx`, new `tests/dataTableKeyboard.test.tsx`, this handoff. No delegates, Git writes, App/API/types/Rust/other tests or fixtures, gallery/history implementation, screenshots, graph/wiki/tracker changes. AllFiles keyboard policy, capture/mutation flows, real-App integration tests and rendered evidence remain the next worker's work; this foundation does not accept 04C3, 04C or 04.

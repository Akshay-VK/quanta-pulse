# 04C7 History Scans preflight — 2026-11-16

Docs/tracker-only inspection at observed `331f9a0`, after accepted `18b323f` foundation plus docs. History Changes #51 owns HistoryView source and remains pending. Root serializes Scans only after #51 keyboard acceptance and supplies the fresh integrated base. Native parent #35; blockers #51 and accepted policy #33; ready-for-agent remains absent. No dependency on B05C, Activity #53 or resource-event snapshot #40 is needed for navigation.

## Applicable spec and current boundary

Spec §4 explicitly moves focus in any list and opens the inspector with Enter. §5.7 defines Scans as scan summaries with a scan inspector; §7 read/dismiss rules target items/Inbox events, not scan-run metadata. There is no approved scan-to-event membership or scan bulk-action model. Reuse navigation/inspection only; X has no useful approved selected-scan operation, so it is inert. E/U/Delete/Space/Shift+A are inert on scan rows. No inherited material read, dismissal, Quick Look, saved-copy or file actions.

Current HistoryView passes `rows={scans}`, `getKey={(s) => s.id}`, `selectedKey={selectedScanId}` and no navigation props to DataTable. Started is a nested native button calling selectScan. Keep its activation and all current columns. Details selection is cleared on tab change and when its ID disappears. Changes filters do not filter Scans. App owns `api.listHistoryScans()`, whose default is 50; no complete-scan publication exists. Navigation covers exactly published rows in supplied order, including retained rows during refresh/error. Paging/diagnostics/redesign remains task15.

## Frozen contracts and focus ownership

Accepted DataTable foundation (772764b lineage), verified unchanged in current source:
```ts
interface DataTableNavigationHandle {
  focusKey(key: string | number): boolean;
  getRowElement(key: string | number): HTMLTableRowElement | null;
}
// Optional props:
focusedKey?: string | number | null;
multiSelectedKeys?: readonly (string | number)[];
onRowFocus?: (row: T) => void;
navigationRef?: Ref<DataTableNavigationHandle>;
```

Use numeric scan.id as table key and `scan:<id>` as policy identity; never row index or timestamp. Keep `selectedKey` for existing inspection, use `focusedKey` for independent focus, omit multiSelectedKeys. Pass a navigation ref and onRowFocus, and enable existing `virtual` mode (>200 threshold). The view wrapper can handle bubbling keydown without changing DataTable. Require the event target to be the mounted scan row itself, checked through getRowElement; headers, sort buttons, Started buttons and nested controls keep native behavior. getListNavigationIntent/recoverFocusedId already supply bounded movement and stable recovery. Dispatch only focus/inspect results, with empty selectedIds/completeEventIds; no material executor or event scope needed.

focusKey returns false for absent/unmounted keys; true means the key exists, including modal-suppressed requests, not proof of focus. getRowElement is null offscreen. Virtual focus scrolls by current key/index, waits for mounting, cancels superseded/removed/unmounted/modal requests and never focuses on refresh alone. Verify actual activeElement and offscreen scroll, not only its boolean return.

```ts
type RestoreDetailFocus = () => boolean;
selectScan(scan: ScanRun, origin: HTMLElement, restoreFocus?: RestoreDetailFocus): void;
```

Adapter already supports the optional callback. Enter supplies the current row and a callback resolving current scan identity through the handle; fall back to the current surviving focused scan, then a stable existing History control when no row remains. Revalidate tab/mount/overlay before restoration. App first restores a connected visible origin, then calls the callback, then its existing heading fallback. Thus mounted-origin restoration wins; do not promise the callback always runs. Preserve this owner and make row focus synchronize local focused identity. Never focus from a data refresh unless the list owned focus; explicit close may restore. Tab/route/unmount invalidates deferred requests. No App or CSS proposal is currently essential: existing content.css table focus/inspection selectors and adapter suffice.

## Global and nested priority

Inspected App useHotkey map has no E/U/Delete/Space/Shift+A/X material binding. Its palette/navigation/search/Escape remain global; useHotkey already rejects prevented/repeat/IME/229 and protects editors. Scan subjects cause no resource lookup in selectDetails. Future actual-App regressions must assert those keys cannot call read/unread/dismiss/delete-history/resource/file/preview APIs on Scans, including an open scan inspector. Preserve explicit header/native control behavior rather than swallowing unrelated keys globally.

Local handler requires Scans active, direct row target and no dialog/alertdialog/menu/listbox/palette/drawer, editor, composition/229, repeat, modifiers or defaultPrevented. Stop/default only accepted navigation/inspection. Do not register window keys. Inspector overlays and nested controls retain their handlers.

## Lease and remaining proof

Exact future two-file lease is [task packet](../tasks/04C7.md). No shared source lease exists before #51 acceptance/root dispatch. Direct HistoryView props with >200 scans establish real virtualization without expanding App query scope; actual-App fixtures establish adapter/global safety. Existing DataTable tests are prerequisite evidence, not completion of Scans integration. No additional scan action is required by this approved scope.

Preflight baseline: 224 files under src/, src-tauri/src/ and tests/, aggregate SHA-256 `532f3a3dc09198794202d154c5b34406a17454e1e52ed919569befe0c8db6b9a` (sorted relative-path to file-SHA JSON, Python sort_keys encoding). Shared B05C source/test dirt is pre-existing; Changes may continue independently. Final read-only comparison must distinguish external concurrent changes from this preflight. Coverage SHA-256 `0f4a09a03c0ab3437b894bc366b60c2c7bb741e9a9828827e5f990f2ba90002e`.

Publication requires explicit-repo duplicate search, repository Issues-enabled check, native parent/blockers and issue/label/edge readback. Docs lease: tasks/04C7.md, contracts/04C7-preflight.md, README append and one task-index node plus 04C dependency only. Validate DAG and preserve all 57 prior records except the appended 04C dependency, and all 98 coverage ownership bytes. No source/test/Git/wiki/B05C/Activity changes, implementation, runtime proof or command gates.

## Publication and read-only verification

Published [#54](https://github.com/Akshay-VK/quanta-pulse/issues/54) after empty all-state searches for 04C7 and Scans keyboard titles and explicit repository Issues-enabled verification. Readback confirms OPEN, enhancement only (no ready-for-agent), native parent #35 and blocked-by #51/#33. No existing issue was edited or closed.

Validation PASS: 58-node DAG is acyclic with no missing dependencies; all 57 prior task records are identical except appending 04C7 to 04C dependencies. Coverage bytes and their recorded hash are unchanged. All four leased documents pass trailing-whitespace/single-final-newline checks. Source/test comparison detected only concurrent creation of tests/appHistoryKeyboard.test.tsx by the active Changes worker; every baseline file remains byte-identical. This preflight wrote only its four docs and the new tracker child/edges. No implementation or command gates ran.

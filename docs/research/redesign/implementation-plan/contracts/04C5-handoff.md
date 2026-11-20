# 04C5 / #51 implementation handoff

Base `18b323f`; frozen leased patch, no Git writes, delegates, App/API/Rust/shared component/style edits. Full combined frontend gate: **root-pending** under explicit wave policy; root accepts after CourseList and History freeze plus combined proof.

Acceptance 1–6: PASS within Changes scope. Event-key navigation, inspection and selection are distinct; E/U/Shift+A capture complete filtered event IDs with baseline exclusion and no fallback widening. Already-read/orphan events remain eligible. Delete confirms Inbox-only dismissal with retention copy and Cancel focus. Existing App preview executes once. Nested/native/editor/IME/repeat/modifier/modal guards preserve App globals. Current-identity recovery and pruning preserve editor/modal focus. Immutable captures, synchronous duplicate locks and filter/tab/unmount generations prevent stale continuations; successful writes survive failed refresh without replay.

Changed files: `src/views/HistoryView.tsx`, new `tests/appHistoryKeyboard.test.tsx`, this contract and `04C5-browser-proof.md`.

Contract delta: none. Consumes optional `eventScopeReady`, rejecting `onSetEventReadState(ids,read)`, `onDismissEvents(ids)`, and separate rejecting `onChanged()`. Only explicit true readiness without loading/error enables new mutations. Void writes never claim affected counts. Missing/History-hidden IDs stay frozen; no resource snapshot, sibling expansion or permanent deletion executor.

Commands, all terminal:

- `npx vitest run tests/appHistoryKeyboard.test.tsx --maxWorkers=1 --minWorkers=1`: PASS, 20/20. Includes 1000/1001/2000 real paged inventories, arrivals, baseline/siblings/orphans/read U, hidden/missing captures, Cancel, retry, refresh supersession, stale filter/tab/route/finally, nested/modal/IME guards and selection pruning. Large inventory cases explicitly allow 120 seconds.
- `npx vitest run tests/appHistoryInventory.test.tsx --maxWorkers=1 --minWorkers=1`: PASS, 23/23, default timeout.
- `npx vitest run tests/appHistoryInteractions.test.tsx tests/historyActions.test.tsx tests/appMaterialActions.test.tsx tests/appIntegratedMaterial.test.tsx tests/materialActions.test.ts tests/historyInventory.test.ts --maxWorkers=4 --minWorkers=1`: PASS, 62/62.
- `npm run lint`, `npm run build`: PASS; existing Vite chunk advisory only. Logs `/tmp/04C5-{lint,build}-final.log`.
- `git diff --check`, explicit leased/new-document trailing-whitespace and single-final-newline checks, frozen-source comparison: PASS.

Initial red keyboard proof failed before wiring. Intermediate failures were corrected global Slash event fixtures and unnecessary initial list rerender; the latter caused a 5-second inventory timeout in a concurrent regression attempt. Final default-timeout inventory run passes. No existing tests changed.

Evidence: [browser proof](04C5-browser-proof.md), exactly two final PNGs at `/tmp/quanta-redesign-progress/20261116T080500Z-04C5-final/`; dark/comfortable, fonts loaded, zero errors, 1280×800 independent focus/selection and 820×540 dismissal Cancel/identity return. Browser/server stopped.

Source hashes: HistoryView `eb043716b663b74d7551e00675f601089a600be07d021a5e63b4ae39b0c981a8`; test `418da4cdce5103b8b31751f2c7862ce55befe3ac3ab50682de04d87782914216`. Manifest `/tmp/04C5-frozen-source.json`.

Preserved: header legacy read/delete and Scans tests, material preview/executors, unrelated research. No implementation blocker; root owns final combined gate. Header conversion/task15, Scans keyboard, collapse and broader/native acceptance remain deferred.

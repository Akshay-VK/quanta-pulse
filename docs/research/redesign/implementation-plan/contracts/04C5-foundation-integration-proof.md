# 04C5 foundation App integration proof

Base: `d0092fd1767a2891ab4fa64ffe01962bad041de0` plus the shared dirty Course/History foundation and root App/CSS patches. Test worker only; no production edits, existing-test edits, Git writes, delegates, Rust changes or Rust gates.

## Scope and acceptance boundary

Foundation App verification: PASS, pending coordinator review/acceptance. This proof covers real App publication and the declared History callback boundary. It does **not** accept the not-yet-implemented History keyboard interactions, future Scans changes or header deletion behavior. The existing History shared-details/Scans/cancel regressions remain covered, but are not evidence of those future features.

New lease: `tests/appHistoryInventory.test.tsx` and this document. There are 23 new integration cases. A test-only `vi.mock` wrapper imports and renders the actual HistoryView and records its actual props. App, rendering, production inventory helper and all refresh orchestration remain real; only the existing API/native-event boundaries are mocked. Direct callback invocation verifies the foundation contract without inventing History interaction behavior.

## Evidence

- Complete publication: 1001 rows and an exact 1000-row multiple, backend order preserved, unfiltered 1000-sized requests and required terminal request. Direct paged API fixtures prove production never invokes the legacy History listing. The helper's legacy listing remains fixture input only.
- No partial publication: a delayed final page retains the prior real History row in the DOM, excludes new rows and clears readiness until completion. A delayed Inbox collection refresh also blocks History publication/readiness.
- Later-page API failure, malformed items and duplicate IDs retain previous rows, render an error and leave readiness false; a required retry recovers to the complete current inventory.
- Generation control: late old successes/failures cannot replace the latest publication or error state. An old completion during a newer pending request cannot enable readiness or clear loading.
- Executors: exact ordered ID arrays, cloned before API handoff; true/false read state; original API errors propagate; executors do not refresh implicitly.
- Required `onChanged` rejects History/resource/course/scan/database load failures and supersession. Successful read/dismiss writes are never replayed across a failed refresh and refresh-only retry.
- App diff review: only History receives `refresh(true)`; existing default callers retain catch-and-resolve behavior. Other consumers call refresh without arguments. Existing header/Scans owners remain unchanged. No actionable production finding in this patch.
- Existing collection hooks catch their own query errors: awaiting collections guarantees settlement, not aggregate collection success. History readiness here establishes a complete current History inventory after settlement; this patch does not add collection-error propagation.

## Commands and final source

Source SHA256: `5de7a4f5df33d01b71d565c07e19dcde14dd2801fa612da8ad5dd97aa133db07` (196 frontend gate inputs). Manifest: `/tmp/04C5-app-history-gate-source.json`. Inputs comprise every file under `src/` and `tests/`, plus root `.json`, `.ts`, `.js` and `.html` files, including lockfile/configuration. Hash is SHA256 of lexicographically sorted relative path + NUL + file bytes + NUL. This covers the combined 699-test source, Course 2px CSS correction and 23 new tests; proof documentation and generated build output are outside these inputs.

Initial focused attempt: 20 passed, 3 failed because this Vitest version lacks `toHaveBeenCalledExactlyOnceWith`. Replaced only those assertions with exact call-array comparisons; no product fix was required.

Focused regression command:

```sh
npx vitest run tests/appHistoryInventory.test.tsx tests/appHistoryInteractions.test.tsx tests/historyInventory.test.ts tests/historyActions.test.tsx tests/historyQueries-api.test.ts tests/historyDeletion-api.test.ts tests/appMaterialActions.test.tsx tests/appIntegratedMaterial.test.tsx tests/materialActions.test.ts tests/appLibraryInteractions.test.tsx tests/appLibraryKeyboard.test.tsx tests/appCourseMaterialsKeyboard.test.tsx tests/courseLibraryView.test.tsx tests/courseLibrary.test.ts tests/courseTree.test.ts tests/courses.test.tsx tests/treeKeyboard.test.tsx --maxWorkers=4 --minWorkers=1
```

Focused run: all 23 new tests and the selected regression files observed in streamed output passed. Its process terminated; the session was no longer available when retrieving the final aggregate summary. The full-suite terminal result below is authoritative for every selected file.

- `npm run lint`: PASS, exit 0, zero warnings.
- `npm run build`: PASS, exit 0; Vite reports a >500 kB chunk warning.
- `npm test -- --maxWorkers=4 --minWorkers=1`: PASS, exit 0; 74 files, 722/722 tests (699 existing + 23 new), 445.04 seconds.
- `git diff --check`: PASS. New-file whitespace and exactly-one-final-newline checks: PASS.
- Final recomputed source hash/no-drift comparison: PASS; all 196 inputs match the pre-gate manifest; no additions/removals. Lint, build, focused and full test commands are terminal; no runner remains active.

No browser/pixel/native claim is made by this integration proof. The separate read-only Course browser worker owns pixel evidence.

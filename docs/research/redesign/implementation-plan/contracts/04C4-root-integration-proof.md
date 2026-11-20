# 04C4 root integration proof — 2026-11-16

Final verification: PASS. Shared HEAD `56cd0da5a1aca0b96b3247d6f25b4ea0df52f861` plus frozen dirty Course Materials / History foundation source. Verification worker only; root remains sole Git writer. No delegates, production/test edits, Rust edits/gates, or old report/wiki/tracker edits.

## Scope and correction review

Course Materials plus History foundation are ready for root acceptance. This does not accept History keyboard, future Scans changes or header deletion. Existing regression coverage does not imply acceptance of those future features.

Reviewed `src/views/library/CoursePage.tsx` focusIdentity: every valid virtual focus request now calls `virtualizer.scrollToIndex(index, { align: "auto" })` before focusing a mounted target. This redirects an outstanding offscreen scroll when a later request targets an already mounted row. Existing tab, connected owner, modal and identity guards remain in place.

The 23rd actual-App Course regression, `supersedes an offscreen End request with an immediately mounted Home target`, sends End then Home in one act, waits for virtual scrolling, and checks the initial first treeitem identity remains connected and focused with fewer than 60 mounted rows. Home correctly targets the initial folder, rather than assuming resource r1. Root's pre-fix null-focus reproduction is supplied history; this worker verified the final passing state only. No actionable finding from this bounded review.

## Terminal gates

All commands ran serially in the terminal, without duplicate active runners.

- Focused Course/History/material/Library regressions: PASS, 19 files / 193 tests, including Course actual-App 23/23. Exact 19-file command is the first line of `focused.log` and recorded in `results.json`.
- `npm run lint`: PASS, exit 0, zero warnings.
- `npm run build`: PASS, exit 0; existing Vite >500 kB chunk advisory.
- `npm test -- --maxWorkers=4 --minWorkers=1`: PASS, exit 0, 74 files / 723 tests; Vitest duration 386.34s. Axe suites pass with jsdom's HTMLCanvasElement.getContext diagnostic in stderr.
- `git diff --check`: PASS. All 13 changed/new frontend/test files: no trailing whitespace and exactly one final newline. This new artifact receives the same whitespace/newline check.

## Frozen source and logs

Before/after source SHA-256: `279a3f1599b47c42d091462363f338ccc8a62ce0c395467fc9304626c627169e`. All 196 inputs match, without additions/removals. Inputs are every file under src/ and tests/, plus root .json/.ts/.js/.html files including lockfile/configuration; aggregate is sorted relative path + NUL + bytes + NUL. Covers App, CSS, HistoryView/helper and all tests. Documentation/generated output excluded.

Only CoursePage.tsx and appCourseMaterialsKeyboard.test.tsx differ from the prior 722-test manifest. App and content.css still match the final browser proof hashes. Full per-file hashes and comparison: `/tmp/quanta-redesign-progress/20261116T072610Z-04C4-root-integration/source-before.json`, `source-after.json`, `delta-from-722.json`.

External named logs: `/tmp/quanta-redesign-progress/20261116T072610Z-04C4-root-integration/focused.log`, `lint.log`, `build.log`, `full.log`, `diff-check.log`; exact commands/exits/timings in `results.json`; source whitespace details in `source-whitespace.json`. Final freeze/process/artifact checks in `final-verification.log`.

## Earlier browser evidence limits

[04C4 final browser proof](04C4-final-browser-proof.md) records PASS for computed 2px inset ring and left bar, wide focus/selection, narrow dismissal and virtual identity restoration. Its capture predates this narrow End→Home correction. No CSS change or pixel difference is expected from the correction, but this verification does not establish new pixels or create/claim a new PNG. Earlier fixture captures do not establish native desktop/live Quanta/SSO acceptance. [04C5 foundation proof](04C5-foundation-integration-proof.md) retains its stated callback/readiness limits.

Contract delta: none. Worker changed only this leased proof artifact. Required gates are complete; no blocker.

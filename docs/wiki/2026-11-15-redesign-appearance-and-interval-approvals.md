# 2026-11-15: Redesign appearance and interval decisions approved

## Approval and scope

The user explicitly approved the two product decisions left open in task 00. This entry supersedes those blockers while preserving the earlier task-00 record as historical evidence. Implementation is tracked by [task 01, issue #17](https://github.com/Akshay-VK/quanta-pulse/issues/17), a native child of [redesign parent #14](https://github.com/Akshay-VK/quanta-pulse/issues/14) and blocked by [task 00, issue #15](https://github.com/Akshay-VK/quanta-pulse/issues/15).

Planning sources are at baseline `1bd0e8b5a24b05733295b5751a7bc42de7b90b43`; the integrated implementation checkout advanced to B01 bootstrap commit `3c705400a0d6e47e6e164bdaaa637f1809d28efa` before task 01 edits. See the [implementation spec](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/docs/research/redesign/quanta-pulse-ui-implementation-spec.md), [task decisions](../research/redesign/implementation-plan/decisions.md), and [frozen contracts](../research/redesign/implementation-plan/contracts/00.md).

## D03: monospace preference

Approved: the monospace toggle switches **all UI text** to Geist Mono. Default typography remains unchanged. Store the boolean in the local appearance version-1 record; a missing/invalid value in an older version-1 record means off, and reset restores off. Keep explicit stored palette/accent selections and unknown future-version records. `useTheme()` remains the single runtime owner. Task 01 owns persistence/application; task 13 owns the control.

## D04: scan intervals

Approved: offer exactly 5, 10, 15, 30 and 60 minutes. Lower the accepted minimum to 5 minutes, keeping frontend validation, Rust settings validation and scheduler behavior aligned. B03 owns those changes; task 01 records the decision but does not implement interval behavior. Task 14A remains dependent on B03.

## Task 01 implementation boundary

Task 01's production lease is `src/styles/tokens.css`, `src/styles/base.css`, `src/lib/appearance.ts`, and `src/hooks/useTheme.ts`; regression files are the existing appearance tests plus appearance-only additions. It does not edit `App.tsx`, `main.tsx`, API/wire types, Settings UI, backend settings, or interval validation. Task 13 consumes `preference.monospace` and `changeAppearance({ monospace: boolean })`.

## D06: PDF renderer engineering candidate

The coordinator approved pinned `pdfjs-dist@5.6.205` as task 12's candidate, using a matching legacy main/worker pair. Preserve macOS 10.15 minimum and the existing Safari 15.6 compatibility target; native packaged proof remains unaccepted. Before any worker changes, inspect the shipped `index.html` meta CSP and make only the required bundled-worker allowance. Do not weaken CSP. The first renderer report inferred no CSP from `tauri.conf.json`'s `security.csp:null`, but the actual `index.html` carries a strict policy and `vite.config.ts` explicitly describes its dev-only CSP rewrite. That inference is superseded. No dependency or platform change is authorized by this decision alone.

Evidence reports, preserved as source history and not modified: `docs/research/redesign/implementation-plan/contracts/pdf-renderer-review.md` and `docs/research/redesign/implementation-plan/contracts/pdf-renderer-compatibility.md`. The shipped policy is visible in `index.html`; the dev-only rewrite is documented in `vite.config.ts`.

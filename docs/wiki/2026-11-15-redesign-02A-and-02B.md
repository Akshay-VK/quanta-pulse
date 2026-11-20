# Redesign split acceptance: 02A and 02B

This page records the shared-controls handoff and the overlay implementation evidence. The task graph and accepted shared-control base are rooted at [Quanta Pulse `83fbbc5`](https://github.com/Akshay-VK/quanta-pulse/tree/83fbbc5), the integrated 02A revision.

## 02A shared controls

Coordinator accepted and integrated 02A at [`83fbbc5`](https://github.com/Akshay-VK/quanta-pulse/commit/83fbbc5). The primary hover contrast, status-tag radius, and course-chip outline/radius review fixes are present at that baseline. Integration gates were lint, all 54 test files / 514 tests, and build. Issue [#20](https://github.com/Akshay-VK/quanta-pulse/issues/20) remains open as `ready-for-human`. Its parent is [02 umbrella #19](https://github.com/Akshay-VK/quanta-pulse/issues/19), itself under redesign #14.

## 02B shared overlays

Issue [#21](https://github.com/Akshay-VK/quanta-pulse/issues/21) is `ready-for-agent` after 02A acceptance. Its parent link to #19 and native blocked-by relation to #20 remain intact as provenance. The current implementation is an uncommitted overlay-only patch based on `83fbbc5`; B02 committed separately at [`b6bef8a`](https://github.com/Akshay-VK/quanta-pulse/commit/b6bef8a). During final proof the coordinator moved the shared checkout to `feat/redesign-monitoring-intervals` at the same HEAD. B03 edits are limited to `src-tauri/src/settings.rs`, `src/lib/settingsDraft.ts`, `tests/settingsDraft.test.ts`, and the task-00 contract; they do not overlap 02B.

The overlay changes cover dialog focus entry and restoration, destructive Cancel focus, menu/popover/select widths, 480/520px confirmation sizing, six-second pausing toasts, tooltip keycaps, and reduced motion. The exact optional consumer props are `ConfirmDialog.scopeList?: boolean` and `Tooltip.shortcut?: string`. See the [02B implementation contract](../research/redesign/implementation-plan/contracts/02B-implementation.md) for semantics, test references, and limits.

Actual React app captures with local backend/event fixtures (not production data) are at `/tmp/quanta-redesign-progress/20261115T233936Z/`. They show the Appearance popover in light and dark themes at 1280×800, with CDP-measured width 320px and focus on “Close appearance.” A reduced-motion frame reports no animation or transform. This browser evidence does not claim native Tauri behavior. The 02B focused suite passed (6/6). Coordinator lint and build passed; the combined 526-test run had 524 passes and only two transient B03 interval red tests, caused by loading the pre-fix 15-minute validator. Rerun the combined suite after B03 stabilizes; details are in the implementation contract.

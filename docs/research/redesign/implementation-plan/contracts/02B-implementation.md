# 02B implementation evidence

## Base and scope

Overlay patch is an uncommitted working-tree change based on the accepted 02A integration, `Akshay-VK/quanta-pulse@83fbbc5`. B02 committed separately at `b6bef8a`; its backend/API/type/hook changes are not part of this patch. During final proof the coordinator moved the shared checkout to `feat/redesign-monitoring-intervals` at the same HEAD. Concurrent B03 edits are confined to `src-tauri/src/settings.rs`, `src/lib/settingsDraft.ts`, `tests/settingsDraft.test.ts`, and `docs/research/redesign/implementation-plan/contracts/00.md`; none overlap the overlay lease. No branch switch, staging, or commit was performed by 02B.

Changed overlay sources: `src/components/ConfirmDialog.tsx`, `src/components/ui/Dialog.tsx`, `src/components/ui/Toast.tsx`, `src/components/ui/Tooltip.tsx`, `src/styles/components/overlays.css`, and exact overlay portal rules in `src/styles/components/ui.css`. Regression coverage is `tests/redesignOverlays.test.tsx`. `Menu.tsx` and `Popover.tsx` public APIs remain unchanged.

## Acceptance and interface

- **Focus/keyboard:** Dialog focuses `.dialog-primary` or `[data-dialog-primary]` when present; otherwise Radix retains its normal initial focus. `initialFocusRef` still overrides that policy. Destructive `ConfirmDialog` starts on Cancel. Radix still owns focus trapping, Escape behavior, and menu keyboard navigation; controlled dialogs return focus to the element active immediately before opening.
- **Widths/motion:** Menu 240px, select portal 240px, popover 320px, confirmation dialog 480px or 520px with `scopeList`. Overlay transitions use 120–150ms ease-out. Reduced motion removes overlay animations/transforms while preserving dialog centering.
- **Popover content seam:** The appearance popover’s inner surface had a legacy 520px width. The owned overlay selector now constrains that child to its 320px floating panel; `appearance.css` remains unchanged.
- **Toasts:** `ToastItem` is unchanged: `{ id, message, error?, action?: { label, onClick } }`. All toast types last six seconds; Radix pauses its timer while the toast viewport is focused/hovered or the window is blurred. Action buttons use their visible label; the close control remains named “Dismiss.” Callers supply meaningful Retry/Undo callbacks when available.
- **Optional prop additions:** `ConfirmDialog.scopeList?: boolean` selects the 520px scoped-list width. `Tooltip.shortcut?: string` renders `formatShortcut(shortcut)` as a keycap. No existing caller is required to pass either prop.

## Proof

- `npx vitest run tests/redesignOverlays.test.tsx`: 6 tests passed.
- Coordinator combined lint and build passed before later B03 interval edits. Combined full suite reported 526 tests: 524 passed, with only two new B03 interval tests failing because that run loaded the pre-fix 15-minute validator. The coordinator confirmed no overlay or mirror test failed. Do not treat those two transient B03 failures as 02B regressions; rerun the combined suite after B03 stabilizes its validator.
- Rendered actual-app evidence used the external screenshot harness with local API/event fixtures, 1280×800 viewport, Chromium sandbox enabled, and no production fixture changes. Fresh captures and CDP metadata: `/tmp/quanta-redesign-progress/20261115T233936Z/overlay-metadata.json` and `quanta-pulse-appearance-popover-{dark,light,dark-reduced-motion}.png`. CDP measured the popover at 320px, focus on “Close appearance,” and reduced-motion `animation: none`, `transform: none`. These are desktop browser observations, not native-app acceptance.

## Tracker readback

- [02A #20](https://github.com/Akshay-VK/quanta-pulse/issues/20) remains open with `ready-for-human`, accepted at `83fbbc5`; its 54-file / 514-test integration result is recorded on the issue.
- [02B #21](https://github.com/Akshay-VK/quanta-pulse/issues/21) remains open with `ready-for-agent`; parent #19 and native blocked-by edge to #20 are preserved.

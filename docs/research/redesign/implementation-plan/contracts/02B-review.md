# 02B overlay review

Compared the overlay diff against HEAD `b6bef8a`, task 02B, and spec §§3, 4, and 6. No concrete user-facing defect or missing implementation acceptance found.

- **Widths:** confirmation dialogs use 480px, scoped confirmations use 520px, menus/select portals use 240px, and popovers use 320px, each clamped to the viewport. Existing global `border-box` makes these outer widths. No current ConfirmDialog caller supplies a scoped list, so the 520px option is available for the matching caller contract without changing current content.
- **Focus and keyboard:** normal dialogs focus the primary action; destructive ConfirmDialog focuses Cancel. Radix retains modal focus trapping, Escape, and menu navigation; controlled dialogs restore the captured active element. The focused regressions exercise primary focus/trap/Escape/restoration, destructive Cancel, and menu keyboard return.
- **Toast:** Radix duration is 6000ms and the controlled rendered item is retained for the 140ms exit animation before `onDismiss(id)` removes it from App's toast array. Action, error alert, and direct dismiss are covered by focused tests. Radix pauses its timeout during interaction/window blur.
- **Motion and readability:** overlay entrances use 120–150ms ease-out; reduced motion disables overlay animation/transitions and transforms while retaining dialog centering. Tooltip shortcut keycaps use formatted shortcut text. The reduced-motion appearance-popover browser evidence in the implementation record does not exercise a dialog or menu.

**Bounded proof:** reviewed source and the recorded six focused overlay tests; did not rerun tests or inspect the browser screenshot. DOM tests do not establish rendered 480/520 dialog dimensions, viewport-clamp behavior, or reduced-motion appearance for every overlay. Existing browser proof establishes the appearance popover at 320px and its focus/reduced-motion state only. Native-app acceptance remains outside this review.

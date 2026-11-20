# 04C1 Inbox keyboard handoff

- Task / issue / base: 04C1 / [#36](https://github.com/Akshay-VK/quanta-pulse/issues/36) / `cb8ac503a0e1d83b59b025aaa3c316f01dcc19c1`.
- Parent: 04C umbrella [#35](https://github.com/Akshay-VK/quanta-pulse/issues/35), itself under #30. The umbrella and this child are blocked by #33 and #28. Only #36 has `ready-for-agent`.
- Scope: Inbox surface integration only. Does not accept 04C or task 04.

## Reusable ResourceRow props

These optional props are backward-compatible; existing surfaces can omit all of them:

- `keyboardFocused?: boolean` adds `.keyboard-focused`, puts the `.row-select` button in the roving tab stop, and remains independent from inspection.
- `multiSelected?: boolean` adds `.multi-selected`; the surface still owns selection state.
- `showFocusHint?: boolean` adds the E keycap in the time slot. Inbox uses `.row-time-focused` to let the keycap remain visible while the timestamp is visually compacted.
- `tabStop?: boolean` keeps a row in the roving tab order without marking it visually focused; it defaults to `keyboardFocused`.
- `selectRef?: (node: HTMLButtonElement | null) => void` exposes the row's existing details button for stable-ID DOM focus recovery.
- `onKeyboardFocus?: () => void` lets the surface track focus caused by pointer or native tab navigation.

No reusable keyboard hook was added. Each surface must attach one keydown handler to its own active list region, call `getListNavigationIntent` with stable displayed identities, and perform its own focus/selection/intent execution. Guard row descendants that are native controls; keep the row details button distinct from course and action controls.

## Inbox ownership and behavior

- Stable list IDs are `InboxItem.key`. Inspection remains `DetailsAdapter.selectChange`; focus and multi-selection are separate local state. No read-on-inspect behavior was introduced.
- J/K and arrows change roving DOM focus. Enter calls the existing details adapter once. X and the accessible Select/Selected button own only local group selection. E/U request desired read state for the selected groups, or the focused group when selection is empty. Delete captures those groups' event IDs for the existing dismiss confirmation only.
- Shift+A freezes the current Inbox filter, calls `api.snapshotInboxEventIds`, then passes the returned complete IDs through `getListNavigationIntent`; confirmation opens only from `openCapturedScope`. The displayed page is never used as the complete scope. Captured IDs are copied and frozen while confirmation is open; later arrivals are not included.
- Space dispatches the `preview` action returned by `MaterialActionsContext`; it does not acknowledge the event. App remains the details and material execution owner.
- Focus recovery uses `recoverFocusedId` against ordered item keys after settled list changes, retains surviving DOM focus through background refresh, and returns focus after Inbox confirmation closes.

## Proof

- Real-App regression file: `tests/appInboxKeyboard.test.tsx` (navigation without acknowledgement, Enter inspection, grouped read state, full asynchronous scope beyond loaded items, preview independence, guards, Delete confirmation, and filtered-row focus recovery).
- Fixture screenshots and measurements: `/tmp/quanta-redesign-progress/20261116T031500Z/inbox-keyboard-wide.png`, `inbox-keyboard-narrow.png`, and `keyboard-observations.json`. The actual React App used local API and Tauri event fixtures only; Chromium reported no page errors. Wide viewport 1280×800 and narrow viewport 480×900 both showed focused and multi-selected states, reachable actions, and modal focus restoration.
- Acceptance remains surface-local; no Agenda, Library, History, App, global hotkey, API, type, or backend behavior was changed.

## Coordinator corrections and proof — 2026-11-16

`tabStop` no longer defaults from `keyboardFocused`: callers that omit it preserve the native button tab stop; explicit roving surfaces supply true/false. The compatibility regression failed before and passed after this correction. Focus-only rows use hover background and a 2px accent bar. Multi-selection uses neutral selected fill with its separate accent bar, avoiding unsupported color-mix. The E keycap replaces the time inside its original 40px slot. Combined frontend gates passed 576 tests/63 files, lint and build. [Final desktop proof](04C1-final-browser-proof.md) covers 1280×800 and 820×540, native Tab access in Library/Agenda, guarded nested controls, focus/selection distinction and modal return. This supersedes the original mobile-only narrow evidence and default-tabStop statement. Only Inbox wiring is accepted; other 04C surfaces and I01 acknowledgement integration remain outstanding.

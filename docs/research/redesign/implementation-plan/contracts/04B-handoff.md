# 04B implementation handoff

- Task / issue / base: 04B / [#33](https://github.com/Akshay-VK/quanta-pulse/issues/33) / `4124e2e66032c0b639b432b06549c04d65dddee8`.
- Scope: pure list keyboard and stable-identity focus policy. This child does not accept umbrella task 04; App/surface integration remains for 04C.

## Exports

- `ListNavigationInput`: current ordered stable row `ids`, `focusedId`, `inspectedId`, `selectedIds`, `key`, explicit surface/editing/nested-control/modal/IME/repeat/default-prevented guards, explicit modifiers, and authoritative `completeEventIds`.
- `ListNavigationIntent`: `focus`, `inspect`, `toggleSelection`, `setReadState`, `confirmDelete`, `preview`, or `openCapturedScope`. These are intents only; no state or side effects are performed here.
- `getListNavigationIntent(input): ListNavigationIntent | null`: maps a single key event. Inapplicable events return `null`.
- `recoverFocusedId(previousIds, nextIds, focusedId): string | null`: retains a surviving ID; if removed/filtered, chooses the next surviving old neighbor, then the previous, then the first ID in the new list. Empty new lists return `null`.

## 04C usage

```ts
const intent = getListNavigationIntent({
  ids: visibleRows.map((row) => row.id),
  focusedId,
  inspectedId,
  selectedIds,
  key: event.key,
  activeSurface,
  editableTarget,
  nestedControl,
  modalOpen,
  isComposing: event.isComposing,
  imeKeyCode229: event.keyCode === 229,
  repeat: event.repeat,
  defaultPrevented: event.defaultPrevented,
  shiftKey: event.shiftKey,
  ctrlKey: event.ctrlKey,
  altKey: event.altKey,
  metaKey: event.metaKey,
  completeEventIds: authoritativeCompleteEventIds,
});
if (intent) handleListIntent(intent);
```

The surface owner supplies authoritative state and executes the returned intent. Shift+A copies and freezes the supplied event ID array immediately; the policy never derives it from displayed or paged rows. E/U and Delete target the visible selected IDs when any remain, otherwise the focused row. Focus movement does not inspect or acknowledge. `inspectedId` is independent of `focusedId` and is not mutated by this function.

## Key and guard behavior

| Input | Intent |
| --- | --- |
| J / ArrowDown | Focus next row, clamped; with no current focus, first row |
| K / ArrowUp | Focus previous row, clamped; with no current focus, last row |
| Enter | Inspect focused row |
| X | Toggle focused row in multi-selection |
| E / U | Request desired read / unread state |
| Delete | Request delete confirmation |
| Space (`key === " "`) | Preview focused row |
| Shift+A | Request scope dialog with captured complete event IDs |

Only Shift+A accepts a modifier. All intents are suppressed for inactive surfaces, editables, nested controls, modal ownership, IME composition (including legacy keyCode 229), repeats, and already-prevented events. The caller derives guard flags without adding another global listener. In particular, do not route a nested native button's activation through this policy.

## Limits

This module does not own DOM focus, native button activation, read-on-inspect, confirmation UI, filtered-list state, query completeness, or action execution. `recoverFocusedId` chooses an ID only; the owner restores DOM focus. No default surface, DOM lookup, global state, or generic command framework is provided. `npm test`, lint and build outcomes are recorded in the worker completion report.

Coordinator correction on 2026-11-16: `completeEventIds` and `openCapturedScope.eventIds` are `readonly number[]`, matching B05 and the existing acknowledgement API. Stable list row identities remain strings.

Coordinator verification on 2026-11-16: all 562 tests across 60 files passed after the numeric captured-ID correction; focused policy tests (20), lint and production build also passed. Independent review found no blocking defect; DOM/surface behavior remains 04C.

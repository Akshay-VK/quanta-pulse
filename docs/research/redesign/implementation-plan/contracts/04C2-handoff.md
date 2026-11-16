# 04C2 Agenda keyboard handoff

Task 04C2 / [issue #47](https://github.com/Akshay-VK/quanta-pulse/issues/47), accepted HEAD supplied by coordinator: `84c20eb`. Shared dirty checkout; no branch, staging, commit, push or PR operations. Changes are an unstaged patch for the sole integrator.

## Interface and ownership

`AgendaView` accepts optional `onChanged?: () => Promise<void>`. Successful mutations await `due.refresh()` and then this callback. The coordinator already wires it through CalendarView to App refresh; neither file was edited by this worker. No backend, API, shared component, stylesheet or read-on-inspect changes.

## Acceptance

- PASS: stable external resource IDs drive `getListNavigationIntent` and `recoverFocusedId`. J/K/arrows only focus; Enter uses the existing details adapter; X owns local multi-selection. Inspection does not acknowledge events.
- PASS: E/U snapshot selected visible resources, falling back to focused resource. Only returned authoritative event IDs are mutated, including eligible events absent from History or already read; no second event query widens the capture.
- PASS: Delete captures before confirmation, cancels without mutation and dismisses only captured Inbox event IDs. Copy explicitly preserves History, saved files and Agenda dates.
- PASS: Shift+A freezes the entire filtered due inventory, including collapsed past dates and rows beyond the per-group cap. It waits for the event snapshot and passes its IDs through policy before opening confirmation. Later arrivals are excluded.
- PASS: empty captures are explicit; snapshot and mutation failures remain visible. Pending actions reject duplicates. Generation checks protect newer captures from stale snapshot rejection, stale mutation rejection/success and stale confirmation completion; filter changes/unmount invalidate captures and dialogs.
- PASS: successful mutations refresh due resources and App/global Inbox counts. Failed mutation retains confirmation for retry without claiming success.
- PASS: Space uses the material preview action; modal, native control, input, IME, repeat, modifier, prevented-event and inactive-surface guards apply. Settled filtering and show-more recover stable focus; empty results focus Agenda search. Refresh cannot pull focus out of an open modal, even when the focused resource disappears. Modal close restores focus after its trap closes.
- PASS: original date-only/local timezone rendering, groups and Past due dates collapse remain intact.

## Regression evidence

`tests/appAgendaKeyboard.test.tsx` runs the actual App with mocked API/native event boundaries. Date alone is frozen at `2026-11-16T12:00:00Z`; real timers keep debounce and portal behavior exercised. November 20 is explicitly **This week**, not Later. Coverage includes 23-resource complete capture, hidden/collapsed rows, pending duplicate activation, arrivals during capture, authoritative E/U and Delete IDs, preview independence, failure/retry, global counts, filtering/unmount invalidation, show-more, empty scope and modal focus during refresh.

Browser evidence and gate results are recorded in [04C2-browser-proof.md](04C2-browser-proof.md). Browser fixtures do not establish native desktop acceptance. This child does not accept 04C or task 04.

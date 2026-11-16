# Task 03 review

## Findings

- **[P1] The narrow inspector scrim is visible while the inspector is closed.** `WorkspacePanel` receives the `PeekPanel` element on every route, so `inspector && onCloseInspector` is true even when `PeekPanel` returns `null`; below 1100px the CSS displays `.workspace-inspector-scrim` across the viewport. This leaves the app covered and blocks interaction whenever no selection is open. In `src/components/WorkspacePanel.tsx:28`, render the scrim only when the inspector is open (pass an explicit open flag or render the scrim alongside the open inspector).

- **[P2] Inbox is rendered as two visible route titles.** `App` passes `currentLabel` (“Inbox”) to the top-bar breadcrumb (`src/App.tsx:776`), while `InboxView` renders `PageHeader title="Inbox"` (`src/views/InboxView.tsx:75`). The route heading belongs to the view per the handoff contract; keep one visible Inbox title by omitting the duplicate route label from the top bar on this route (or otherwise suppressing one title).

## Bounded proof

Static review confirms the requested 224/48px sidebar, 8px inset and 10px radius, 44px header, 40px toolbar slot, 30px status slot, 340px inline inspector, 320px overlay below 1100px, and rail/drawer breakpoint below 960px. Drawer focus trapping, initial focus, focus restoration, Escape handling, navigation close, and drawer scrim behavior are present in source. The supplied report says 531 frontend tests, lint, build, and 39 focused tests passed; these were not rerun. Supplied screenshots cover the wide shell and narrow drawer only; inspector behavior was not exercised. Browser screenshots do not prove native titlebar hit regions or production Tauri event delivery. No route IDs, Settings guard, selection owner, or backend behavior were changed in the reviewed scope.

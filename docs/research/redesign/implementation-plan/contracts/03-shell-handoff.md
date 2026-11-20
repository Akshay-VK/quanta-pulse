# Task 03 shell consumer handoff

Baseline source: integrated `3b1a67ebd33a37966d4a88026d761c778e770d4a`. The implementation patch described here is unstaged and uncommitted.

## Exported shell interface

`TopBarProps` is exported from `src/components/TopBar.tsx`: optional `items`, required `current`, optional `actions`. `PageHeaderProps` is exported from `src/components/PageHeader.tsx`: required `title`, optional `caption`, `summary`, `actions`, legacy `subtitle`, and `children`.

`WorkspacePanelProps` is exported from `src/components/WorkspacePanel.tsx`:

- `status?: ReactNode` — fixed 30px workspace status bar content.
- `toolbar?: ReactNode` — optional 40px route toolbar; omit when an existing view owns its toolbar.
- `due?: ReactNode` — optional full-width region before route content.
- `content: ReactNode` — route body and its existing title.
- `inspector?: ReactNode` — shared inspector placement.
- `onCloseInspector?: () => void` — closes an open inspector when its narrow-layout scrim is clicked.

The panel renders toolbar, due, content, inspector, and status in their named shell slots (`data-shell-slot`). The App currently supplies existing route content and its shared `PeekPanel`, plus an empty status slot. Existing view headings and filter bars stay view-owned to avoid duplicate titles or second selection owners.

## Evidence and limits

The patch changes App composition and shell CSS from the source baseline above. `src-tauri/tauri.conf.json` already sets native minimum dimensions to 820×540. A deterministic fixture build of the patched React app rendered at 1280×800 and 820×540 in Chromium with its sandbox enabled. Measurements and screenshots are in `/tmp/quanta-redesign-progress/20261116T003543Z/shell-metadata.json`; browser errors: zero. At 820×540 the rail measured 48px with a 31px search target; the drawer measured 224px, had `aria-modal=true`, and received focus. Screenshots do not establish native titlebar behavior or production Tauri event delivery.

Issue #23 is a native child of #14 with verified blocker edges to accepted #17 and #19. The coordinator recorded 02B/umbrella acceptance evidence on #21 and #19; both remain open and `ready-for-human`. See `docs/wiki/2026-11-16-workspace-shell.md` for commands and remaining limits.

## Coordinator corrections on 2026-11-16

The uncommitted integration patch supersedes the initial custom narrow scrim: `WorkspacePanel` renders the inspector in the shared modal `Dialog` below 1100px. Supply an inspector only when it has content, and pass `onRestoreInspectorFocus?: () => void` for App-owned restoration after the modal releases focus. `Dialog` additionally accepts `container?: HTMLElement` and `overlayClassName?: string`; it owns Escape from its content even when a background toast becomes the highest dismissal layer. Nested layers that consume Escape remain authoritative. `PeekPanel.focusOnOpen?: boolean` defaults true for inline use; set false under a modal so its focus scope owns initial focus. The title supplies the shared `data-dialog-primary` marker.

The coordinator also removed the duplicate top-bar route title and the closed-inspector scrim. Focused shell/interaction/overlay/navigation verification passed 49 tests across four files after these corrections, including a successful file action followed by Escape. Full integration and corrected browser proof remain pending.

Combined coordinator gates on 2026-11-16 passed 535 tests across 57 files, lint, and production build. A later visual correction prevents flex children (including the title) from shrinking and keeps the inner width at 100%; final rendered evidence is recorded separately.

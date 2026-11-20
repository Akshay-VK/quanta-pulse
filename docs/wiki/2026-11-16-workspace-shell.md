# 2026-11-16: Workspace shell implementation

This dated record covers task 03 implementation evidence at integrated source baseline [`3b1a67e`](https://github.com/Akshay-VK/quanta-pulse/commit/3b1a67ebd33a37966d4a88026d761c778e770d4a). The shell patch remains unstaged and uncommitted for coordinator integration.

## Shell and consumers

The patch sets the sidebar to 224px, rail to 48px, main panel inset to 8px with 10px radius, header to 44px, optional toolbar slot to 40px, and status bar to 30px. The shared inspector sits inline at 340px from 1100px upward and overlays at 320px below 1100px. Below 960px the rail opens a 224px navigation drawer over a scrim; drawer labels return, Tab focus stays within it, and closing returns focus to its opener unless another modal has taken focus. Existing route IDs and view-owned titles/content remain intact. The global session banner now precedes the header.

Exported consumers: `TopBarProps` (`items`, `current`, `actions`), `PageHeaderProps` (`title`, `caption`, `summary`, `actions`, compatibility `subtitle`/`children`), and `WorkspacePanelProps` (`status`, `toolbar`, `due`, `content`, `inspector`, `onCloseInspector`). Detailed placement semantics are in the [task 03 shell contract](../research/redesign/implementation-plan/contracts/03-shell-handoff.md).

## Proof

- Focused Vitest: `tests/navigation.test.tsx` passed 15 tests, including a newly added modal-drawer focus-trap and focus-return test. `tests/appInteractions.test.tsx` is included in the full suite.
- Full `npm test`: 531 tests across 56 files passed.
- `npm run lint` and `npm run build`: passed for this implementation patch. The isolated fixture build for the screenshots also passed.
- Deterministic fixture app mounted at 1280×800 and 820×540 with zero browser errors. DOM measured 224px sidebar, 44px header, 30px status bar, 10px panel radius, 48px rail, 31px search target, and 224px open drawer with focus inside. Screenshots and measurements: `/tmp/quanta-redesign-progress/20261116T003543Z/` (`quanta-pulse-shell-1280x800.png`, `quanta-pulse-shell-820x540-rail.png`, `quanta-pulse-shell-820x540-drawer.png`).

These checks do not certify native titlebar drag behavior, production Tauri progress delivery, or macOS rendering. The drawer issue is [#23](https://github.com/Akshay-VK/quanta-pulse/issues/23), a native child of #14 with verified native blocking edges to accepted #17 and #19. Its `ready-for-agent` label remains and the issue stays open. Acceptance evidence was added to [02B #21](https://github.com/Akshay-VK/quanta-pulse/issues/21) and [umbrella #19](https://github.com/Akshay-VK/quanta-pulse/issues/19); both remain open and `ready-for-human`. No issue was closed.

## Coordinator follow-up on 2026-11-16

The initial browser inspection exposed a hidden narrow scrim, 8px inspector overflow, and escaped keyboard focus. The uncommitted coordinator follow-up replaces the narrow inspector with the shared Radix modal, gives that scope initial focus ownership, and restores the originating row after dismissal. It also resolves duplicate route headings and the closed inspector’s residual scrim. A background success toast exposed another Escape ordering case; the dialog handles unconsumed Escape from its content. The [updated consumer handoff](../research/redesign/implementation-plan/contracts/03-shell-handoff.md#coordinator-corrections-on-2026-11-16) records the optional prop additions. Focused proof passed 49 tests; combined gates and corrected screenshot proof remain pending. This supersedes the initial patch’s implied narrow-inspector acceptance.

On 2026-11-16, the combined coordinator run passed **535 tests across 57 files**, with lint and production build passing. Subsequent visual inspection found the inspector title shrinking under flex pressure; the follow-up sets its children to retain their natural height and scroll, and removes a stale fixed inner width. This CSS correction receives a separate lint/build and browser recheck; it does not change application behavior.

On 2026-11-16, the [final browser recheck](../research/redesign/implementation-plan/contracts/03-final-browser-proof.md) passed at 1280×800 and 960×700. The title retained 24px height; wide/narrow widths measured 340/320px; tight content scrolled internally; Tab remained contained; successful download/open produced the expected toast and Escape restored row focus with no residual scrim. This supersedes the earlier failed inspector screenshots and the previous fixture’s unsupported success-action limit. This remains browser fixture proof, with native titlebar behavior outside its scope.

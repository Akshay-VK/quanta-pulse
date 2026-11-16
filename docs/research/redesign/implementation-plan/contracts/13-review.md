# Task 13 independent review

## Findings

- **P2 — Theme mode tiles do not preview their labeled modes.** `src/styles/components/appearance.css:10-16` colors each `.appearance-mode-preview` from the active document tokens (`--bg`, `--floating`, `--side`, `--line-strong`); `Appearance.tsx` does not supply per-mode tokens. In the provided light screenshot (`/tmp/quanta-redesign-progress/20261116T031220Z/settings-wide-light.png`), the Dark tile renders with a light background and light sidebar, so all three previews depict the current light theme. The dark screenshot shows them all dark. Resolve preview colors for each mode independently of the selected mode.

- **P2 — Save bar exceeds the requested 48px height.** `src/styles/components/screens.css:516-527` gives `.save-bar` 12px vertical padding (`--sp-3`); its Save/Discard buttons are 28px tall (`src/styles/components/ui.css:39-43`, `src/styles/tokens.css:119`). That yields a 52px bar, consistent with the handoff's measured y=437–489. Reduce vertical sizing to meet 48px while retaining sticky positioning.

## Review notes

The scoped implementation retains seven named sections, 216px/640px desktop columns, sticky rail, and narrow native select. Anchor clicks and select changes update the shared active state and scroll; existing observer logic remains in place for scroll-driven active state. Appearance continues through the shared `AppearanceController`, with immediate monospace/reset behavior. Theme and accent radios expose checked state, roving tab stop, and arrow-key navigation. The appearance popover uses a viewport-constrained, vertically scrollable container; the supplied 820×540 screenshot shows its contents continue below the fold without horizontal clipping. Draft/save ownership and `SettingsNavigationController` code are unchanged in the scoped diff.

## Limits

Reviewed only the task 13 scope and supplied screenshots. Did not run tests or launch a browser. No review of Inbox, Rust, or other changes.

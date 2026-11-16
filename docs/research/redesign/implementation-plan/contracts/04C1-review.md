# 04C1 bounded review

## Findings

- **P1 — Existing ResourceRow callers lose keyboard access.** [ResourceRow.tsx:84](../../../../../src/components/ResourceRow.tsx:84) defaults `tabStop` to `keyboardFocused`, which itself defaults to `false`, then applies `tabIndex={-1}` to `.row-select` ([ResourceRow.tsx:153](../../../../../src/components/ResourceRow.tsx:153)). Callers outside Inbox that omit the new optional props therefore lose the native button tab stop they had before this change. Preserve the prior native default for callers that do not opt into roving focus; Inbox already supplies `tabStop` explicitly.

- **P2 — Keyboard focus misses the specified row treatment.** [content.css:29](../../../../../src/styles/components/content.css:29) gives `.keyboard-focused` only a 2px outline. The screen spec requires focused rows to use the `--hover` background and a 2px accent bar on the left edge (`quanta-pulse-ui-implementation-spec.md`, §6.5, row-state table). The current `.multi-selected` rule supplies a 3px bar and mixed accent background, but the focused state alone does not meet the spec. Add the prescribed focused background/bar while retaining the E keycap.

## Proof limits

- The wide 1280×800 capture shows the focused+multi-selected row. Its accent fill follows the explicit `.multi-selected` rule; the spec does not define a separate multi-selection color, so the fill is not raised as a defect. The capture does not establish focused-only styling.
- The narrow capture is 480×900, below the task's 820×540 desktop minimum. Narrow desktop proof remains incomplete.
- Review was limited to the requested diff and `tests/appInboxKeyboard.test.tsx`. Worker-reported frontend result: 575 tests passing; no additional test run was performed.

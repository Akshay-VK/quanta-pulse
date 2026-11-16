# 04A implementation handoff

- Task: 04A visual foundation; base `2bfe2bd2dcc80ce96d1e8832330f5a6678b3daf3`.
- Public component contract: `ResourceRow` adds optional `sectionLabel?: string | null`, rendered as a mono section slot between course metadata and time. Existing props and callbacks are unchanged. `DataTable` preserves its existing props.
- Geometry: material row 36px comfortable / 30px compact; table body row and virtualizer estimate 34px; group header 28px.
- Compact policy: preserve the 800px `ResizeObserver` threshold and `.row-compact` activation. Material rows use a compact single-line slot at 30px; non-material compact rows retain the prior two-line layout.
- Action boundaries: course and action buttons remain outside `.row-select`; selected continues to mean existing inspected/detail selection. Source/local action separation remains owned by the existing material-action policy.
- Out of scope: navigation/focus state, keyboard actions, multi-selection state, collapse state, read-on-inspect, App/view wiring, and new product states. Task 04 remains incomplete pending later children and coordinator integration.
- Evidence / gates: see worker completion report for commands, screenshots and any environment limits.

## Coordinator integration on 2026-11-16

The review’s Inbox/Agenda cascade conflict was fixed by restricting the old five-track rule to non-material rows. Both material time slots retain their 40px treatment. The raw source/CSS test file was removed; actual rendered geometry now supplies this proof. [Fresh browser evidence](04A-browser-proof.md) measures six tracks in both composed views, 36/30px material rows, 40px time/92px actions, 34px real table rows and virtual spacing, 28px real group headers, and scrolling through row 260. Fonts loaded, no page overflow, no browser errors.

Worker full gates reported 541 tests before the coordinator correction; a later combined B05B worker run reported 542 tests with the corrected shared tree. Coordinator lint/build passed after the CSS correction. Native and packaged-app behavior remain outside this browser evidence. The umbrella remains incomplete until keyboard policy and serialized surface integration are accepted.

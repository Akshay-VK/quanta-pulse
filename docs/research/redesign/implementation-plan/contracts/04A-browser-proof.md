# 04A browser proof

Fresh sandboxed Chromium run: `20261116T021140Z`. The harness used the actual React app with local API/event fixtures and an external component page importing production `DataTable`, `GroupHeader`, and production CSS. No live Quanta or native app was used. Preview status was unavailable, so the local Chromium fallback ran with its sandbox enabled.

Rendered app results: Inbox and Agenda wide/narrow rows each have six computed tracks, no page overflow, positive title width and full title attributes. Wide material rows measure 36px; narrow rows measure 30px. Each measured time slot is 40px and actions slot 92px, both within the row. Fonts loaded and captured page errors are empty.

Rendered component results: body row height and virtual row spacing are 34px; group header height is 28px. The virtual table rendered 21 rows initially, then scrolled to and rendered row 260 (20 visible rows at the end). Fonts loaded, document width matches viewport, and browser errors are empty.

Evidence (measurements and errors are in JSON):

- [App capture metadata](/tmp/quanta-redesign-progress/20261116T021140Z/capture-metadata.json)
- [Component capture metadata](/tmp/quanta-redesign-progress/20261116T021140Z/component-metadata.json)
- [Rendered Inbox screenshot](/tmp/quanta-redesign-progress/20261116T021140Z/quanta-pulse-inbox-dark.png)
- [Rendered component screenshot](/tmp/quanta-redesign-progress/20261116T021140Z/quanta-pulse-component-proof.png)

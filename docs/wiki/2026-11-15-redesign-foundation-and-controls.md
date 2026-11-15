# 2026-11-15: Redesign foundation acceptance and shared-controls split

## Acceptance evidence

- Foundation task 01 is accepted at [`985b1a9`](https://github.com/Akshay-VK/quanta-pulse/commit/985b1a9). Its recorded frontend gates passed: 505 tests, lint and build. The implementation retains the existing public appearance contract and the accepted user decisions recorded in [the prior dated approvals](2026-11-15-redesign-appearance-and-interval-approvals.md).
- B01 durable course rename is accepted at [`23bf0ce`](https://github.com/Akshay-VK/quanta-pulse/commit/23bf0ce); native Rust check and three focused DB tests passed.
- B02 per-file download lifecycle is active and owns its backend/API/types/useMirror files. Shared controls must not modify those files. No B02 acceptance is implied here.
- GitHub acceptance evidence is recorded on [#15](https://github.com/Akshay-VK/quanta-pulse/issues/15#issuecomment-6902328048) (task 00), [#16](https://github.com/Akshay-VK/quanta-pulse/issues/16#issuecomment-6902328716) (B01) and [#17](https://github.com/Akshay-VK/quanta-pulse/issues/17#issuecomment-6902329462) (task 01). They remain open with their parent open. Task 01 evidence is implementation/automated-gate evidence; no native appearance claim is made.

## Task 02 boundary

Task 02 remains the umbrella so task 03 and later downstream dependency edges stay acyclic and unchanged. [Umbrella #19](https://github.com/Akshay-VK/quanta-pulse/issues/19) has native children [02A #20](https://github.com/Akshay-VK/quanta-pulse/issues/20) and [02B #21](https://github.com/Akshay-VK/quanta-pulse/issues/21), splitting shared controls from overlays. 02A depends on task 01 and is the only child approved ready-for-agent. 02B depends on accepted 02A and remains not ready until that acceptance. The umbrella completes after 02B. All 98 screen-coverage ownership rows remain unchanged; Foundations stays assigned to 01, while 02A may consult only its relevant control examples.

Task 02A owns Button, IconButton, TextField, PasswordField, SearchField, TimeField, Switch, Checkbox, Select, ToggleGroup, Tabs, Kbd, StatusTag and CoursePill, plus exact corresponding selectors in ui.css and tests/redesignControls.test.tsx. It excludes overlays.css, ConfirmDialog, App/shell/views, global hotkeys, and B02 files. See [task 02A](../research/redesign/implementation-plan/tasks/02A.md) and [task 02B](../research/redesign/implementation-plan/tasks/02B.md).

The CoursePill display-color seam remains explicit: current persisted course assignment is a twelve-color courseDot algorithm; the redesign reference names three semantic course colors. 02A may render three semantic tokens but cannot reassign/migrate persisted colors. A follow-up decision or integration seam owns any palette remapping.

## Worker and evidence preference

Keep implementation packets bounded to one child task and its named sources so the user can review small work increments. Capture real-app light and dark controls screenshots at the 02A milestone when feasible and return the PNG paths for inline review. A design-export image or DOM-only evidence does not establish rendered geometry. Preserve the established working actual-app fixture under `/tmp/quanta-redesign-progress`; do not add repository fixtures, use real credentials, or launch the packaged app.

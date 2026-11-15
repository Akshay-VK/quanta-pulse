# 2026-11-15: Redesign implementation planning and task 00 contracts

## Tracker and baseline

The user authorized strict implementation of the local redesign plan and coordinator-led dispatch. The planning checkout is `docs/redesign-subagent-plan` at `1bd0e8b5a24b05733295b5751a7bc42de7b90b43`; only the pre-existing untracked `docs/research/` tree and the task-00 documentation outputs are present. The dedicated parent is [issue #14](https://github.com/Akshay-VK/quanta-pulse/issues/14); [task 00 is native sub-issue #15](https://github.com/Akshay-VK/quanta-pulse/issues/15). Repository/Issues availability and duplicate search were confirmed explicitly for `Akshay-VK/quanta-pulse`. Readback confirmed parent label `enhancement`; task 00 labels `enhancement`, `ready-for-agent`; its parent relationship is #14. Existing issue #12 remains untouched.

The source-of-truth planning artifacts are [the implementation plan](../research/redesign/implementation-plan/README.md), [task decisions](../research/redesign/implementation-plan/decisions.md), and [frozen contract excerpts](../research/redesign/implementation-plan/contracts/00.md). The plan is a set of dispatch inputs, not a second live status board. Task 00 is docs-only; no product code is changed.

## Frozen choices and blockers

- Inspection captures unread event IDs for the inspected identity, updates optimistically and rolls back on failure. Focus and preview do not acknowledge. Inbox grouped IDs are complete; Library/Agenda inspection waits on B05's complete resource-scoped unread snapshot.
- Inbox refresh/count status sits below filters; global session lifecycle status sits above the header, with one reconnect action.
- Appearance remains local/immediate; explicit existing choices and future schema records are preserved. Existing Soft Graphite/system/comfortable default remains because the implementation spec does not explicitly change the default. The monospace toggle's exact effect remains a blocker for 01/13.
- Calendar has Agenda and Activity tabs only. Date-only deadlines do not gain invented instants/timezones/countdowns. Retention means version retention only. Unknown download totals stay indeterminate. Historical scan detail is never fabricated.
- Sign-in copy reflects the native SSO window. Failed/incomplete baseline work retains reset markers; failed file removals retain index rows.
- D04 5/10-minute interval options, D03 monospace semantics and D06 bundled PDF renderer selection remain explicit blockers for their consumers. No approval is inferred.

See the [implementation spec at the baseline SHA](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/docs/research/redesign/quanta-pulse-ui-implementation-spec.md), [`appearance.ts`](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src/lib/appearance.ts), [`types.ts`](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src/lib/types.ts), [`api.ts`](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src/lib/api.ts), and [`details.ts`](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src/lib/details.ts) for the inspected code evidence.

## Execution routing and staging boundary

The previous OpenCode run stopped at its free-usage limit. The user authorized GPT-6 Luna as the fallback for this research/coordination pass. Use the explicitly authorized routing preference on subsequent implementation work; do not silently switch to another provider.

The user-owned design/spec inputs remain untracked and were not staged. Before isolated worktrees can see them, the minimum common staged source set is:

- `docs/research/redesign/implementation-plan/README.md`, `decisions.md`, `screen-coverage.md`, `worker-contract.md`, `task-index.json`, `tasks/*.md`, and `contracts/*.md`;
- `docs/research/redesign/quanta-pulse-ui-implementation-spec.md`;
- `docs/research/redesign/pulse-design/README.md` and `pulse-design/fonts/**`;
- only the `pulse-design/screens/*.html` entries assigned in `screen-coverage.md` to the dispatched task, plus `Foundations.html` when that task names shared foundations.

Do not stage `pulse-design/index.html` or other `docs/research/` material for workers that do not need it; do not stage unrelated research. No staging or commit occurred in this task.

## Execution limits

No production source changes, tests, commits, subagents or app launches were made. Documentation/link and source-contract review was performed against the baseline. Implementation dispatch belongs to the coordinator after task 00 handoff.

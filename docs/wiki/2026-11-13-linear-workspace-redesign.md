# 2026-11-13: Linear-inspired workspace redesign approved

On 2026-11-13, the user approved the Quanta Pulse workspace redesign spec, eight-ticket graph, palette proposal, and application-level test seam for implementation.

## Published tracker records

- [Approved spec issue](https://github.com/Akshay-VK/quanta-pulse/issues/1)
- [01: Compact Today workspace](https://github.com/Akshay-VK/quanta-pulse/issues/2)
- [02: Today shared details lifecycle](https://github.com/Akshay-VK/quanta-pulse/issues/3)
- [03: Library stable courses](https://github.com/Akshay-VK/quanta-pulse/issues/4)
- [04: Calendar details](https://github.com/Akshay-VK/quanta-pulse/issues/5)
- [05: History details](https://github.com/Akshay-VK/quanta-pulse/issues/6)
- [06: Keyboard and palette](https://github.com/Akshay-VK/quanta-pulse/issues/7)
- [07: Settings feedback](https://github.com/Akshay-VK/quanta-pulse/issues/8)
- [08: Acceptance review](https://github.com/Akshay-VK/quanta-pulse/issues/9)

GitHub's native sub-issue links make issues 2–9 children of issue 1. Native blocking edges are: 2 → none; 3 → 2; 4–7 → 3; 8 → 2; 9 → 4, 5, 6, 7, 8. Arrows point from a ticket to its blocker. Ticket bodies also link to the parent and blockers.

## Decisions

The user selected GitHub Issues in `Akshay-VK/quanta-pulse` and the repository's dated `docs/wiki` as the decision record. The proposed near-black/violet palette and bundled Geist typography are Quanta design choices, not a claim to reproduce Linear's exact app palette. The test seam is the real application DOM with mocked existing frontend API and Tauri adapters; no production API or backend seam is planned.

The implementation remains a frontend redesign over existing local data and contracts. The approved spec preserves local-first storage, authentication behavior, existing themes, and the existing product capabilities. It excludes backend/schema changes and the unrelated uncommitted authentication work.

## Code baseline and evidence

As of `Akshay-VK/quanta-pulse@967333bb585bff478810f453be1c6ba2c2c96c59`, `AGENTS.md` describes a Tauri 2 Rust shell and React/TypeScript UI, a frontend API wrapper, local SQLite state, and existing test commands. That commit is the clean isolated integration baseline; the redesign feature work must retain these boundaries.

The approved source artifacts and detailed verification matrix were prepared on 2026-11-13 in `/tmp/quanta-linear-redesign-plan/`. Baseline outputs are recorded in `baseline-lint.log` and `baseline-test.log`; environment readiness must be rechecked in the isolated checkout before feature work.

## Implementation routing

The user-selected routing is Iceman `opencode/iceman-free` with no exposed reasoning setting for ticket 01; Beam `opencode/beam-free` variant with low reasoning; Luna `codex/gpt-6-luna`; and Sol `codex/gpt-6.1-sol`. On 2026-11-13, parent orchestrator capability inspection verified these model options. Preserve Iceman's lack of an exposed reasoning setting and do not mark any selected option unavailable. Beam remains an alternate for bounded mechanical sub-recipes when assigned.

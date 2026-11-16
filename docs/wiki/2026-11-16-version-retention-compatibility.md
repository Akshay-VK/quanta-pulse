# 2026-11-16: Version-retention compatibility

This dated clarification supersedes only the unresolved exact-value/default portion of the historical D05 record. D05's earlier wording remains unchanged as a record of its original resolution. The compatibility choice preserves the existing settings contract and valid saved preferences.

On 2026-11-16, the coordinator chose compatibility with the incumbent Rust behavior as of `Akshay-VK/quanta-pulse@f54e9e5`; the source inspection is recorded in [B10 preflight](../research/redesign/implementation-plan/contracts/B10-preflight.md).

## Frozen behavior

- Keep `mirrorKeepVersions`; its value is the number of superseded copies retained per resource in `.history`, excluding the current saved copy.
- Accept integer values from `0` through `10`, with default `3`. Preserve and display valid persisted nonpreset values, including `2` and `10`.
- Keep the offered presets `0`, `1`, `3`, and `5`; represent a valid current value outside those presets as a dynamic current option.
- Reject negative, fractional, nonfinite, and above-10 frontend drafts with a field error.
- Explain that this controls previous versions and that saved files are kept independently; no age-based removal or new lifecycle/wire field is introduced.
- Existing Rust sanitization and default already match, so this compatibility decision requires no Rust behavior change.

## Implementation boundary and gate

The B10 implementation lease is `src/lib/settingsDraft.ts`, only the previous-versions row in `src/views/SettingsView.tsx`, `tests/settingsDraft.test.ts`, and a focused version-retention test file. The task must not begin while final B08B/foundation acceptance is active. No historical report is rewritten and no screen ownership assignment changes.

The live implementation ticket is [B10 #49](https://github.com/Akshay-VK/quanta-pulse/issues/49), under redesign parent [#14](https://github.com/Akshay-VK/quanta-pulse/issues/14), with task 00 [#15](https://github.com/Akshay-VK/quanta-pulse/issues/15) as its native blocker. This durable record documents the accepted compatibility decision; current task state belongs in GitHub Issues.

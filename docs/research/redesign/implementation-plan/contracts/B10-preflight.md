# B10 preflight — version-retention contract

Base inspected: `f54e9e5d36623cf1cfbe0076c7c8de4c0194980d` (accepted checkout).

## Source facts

- Settings wire field is `mirrorKeepVersions` (`usize` in Rust, `number` in `src/lib/types.ts`, camelCase serde). It counts **superseded copies per resource** kept in `<mirror root>/.history`; it does not count the current mirrored copy.
- Rust default is `3`. Rust sanitization caps at `10`, with no lower clamp (so `0` is valid). The current Files settings select offers `0`, `1`, `3`, and `5`. The frontend draft validator currently has no explicit `mirrorKeepVersions` validation.
- On replacement, `archive_previous` indexes the superseded copy and prunes beyond the configured count. The current copy remains in the mirror independently of this history count.
- D05 explicitly resolves version retention only and prohibits age-based deletion absent a separately approved lifecycle/migration spec. The spec §7 local-files rule says each detected item is saved on disk when auto-download is on; the baseline mirror contract calls this the permanent local copy.

## Consumer contract supported by recorded decisions

The Settings control must be explicitly labeled **Previous versions to keep** (or equivalent wording that says versions, not file age). Its explanation must say that it controls older copies of changed files in `.history`, separately from the current saved file, and must make clear that saved files are not removed by age. No age/last-access cleanup may be introduced. Existing wire field remains `mirrorKeepVersions`; no new field or backend command is indicated by D05.

## Remaining decision before B10 implementation

D05's original row remains an accurate historical record of what that entry resolved at the time. A dated compatibility clarification now freezes the product contract: accept all integer values `0..=10`, default `3`, and preserve/display valid persisted nonpreset values. Keep current selectable presets `{0,1,3,5}`; dynamically include the current valid persisted value when it is outside those presets. Reject negative, fractional, nonfinite, or above-10 frontend drafts with a field error. This preserves existing persisted data and Rust sanitization; it does not infer product approval from source defaults.

Implementation lease: `src/lib/settingsDraft.ts`; only the previous-versions row in `src/views/SettingsView.tsx`; `tests/settingsDraft.test.ts`; and one focused version-retention test file. No Rust change is needed because existing `0..=10` sanitization and default `3` already match the accepted contract. Keep the existing wire field and lifecycle. Do not begin implementation while the final B08B/foundation acceptance gate is active.

Task 14's consumer is only the frozen field/copy semantics above; it must not add age-based retention or reinterpret the value as total copies including the current file. B10 owns the Settings presentation/copy and frontend draft validation under its exact lease; existing Rust behavior needs no change.

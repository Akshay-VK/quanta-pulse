# 04C0 resource event snapshot handoff

- Task / issue / base: 04C0 / [#40](https://github.com/Akshay-VK/quanta-pulse/issues/40) / `34cbe7dee8d111b2c1e055665a9204f838714baa`.
- Parent: [04C umbrella #35](https://github.com/Akshay-VK/quanta-pulse/issues/35). Native blocker: [accepted B05A #28](https://github.com/Akshay-VK/quanta-pulse/issues/28). The umbrella now has both 04C0 and existing 04C1 as prerequisites.
- Scope: backend/API resource event membership snapshot only. Does not implement a UI surface or accept 04C/task 04.

## Contract

`api.snapshotResourceEventIds(resourceIds: number[]): Promise<number[]>` invokes `snapshot_resource_event_ids` with `{ resourceIds }`. It returns a complete ascending unique event-ID set for exactly the selected resources, including read and unread events. Baseline and calendar-suppressed events are excluded; Inbox dismissal and History clear watermarks do not affect membership. Nonpositive resource IDs reject. Duplicate resource IDs are harmless; empty input returns `[]`. The query chunks resource IDs by 500, below SQLite bind limits, and unions results without caps. Snapshot reads do not mutate events or read/dismissal state. The existing singular `snapshotResourceUnreadEventIds` API is unchanged.

A later resource consumer may freeze the IDs at activation and pass that array to existing `api.setEventReadState(ids, desiredRead)` or `api.dismissInboxEvents(ids)`. It must not derive a complete scope from capped/paged History rows or re-query after activation, which could admit later arrivals.

## Proof

- Rust attention regression: 1,205 events on one resource, 1,005 requested resources, duplicates, read/unread, dismissed, cleared, baseline, suppression, resource isolation, empty/invalid inputs, ascending unique IDs and unchanged persisted state.
- API regression asserts the exact command name, camelCase payload and resolved IDs.
- The tested implementation sorts/deduplicates resource IDs, queries chunks of 500, and sorts/deduplicates the combined event IDs.
- Windows Rust gates passed with `CARGO_INCREMENTAL=0` and `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`: `cargo check`, focused resource snapshot test, and `cargo test --lib` (250 passed).
- Frontend gates passed: `npm run lint`, `npm test` (581 tests / 65 files), and `npm run build`. Vite emitted its existing large-chunk advisory; build completed successfully.
- Plan validation passed: 47 tasks, no missing dependencies or cycles, 04C depends on both 04C0 and 04C1, and all 98 screen assignments remain present.

Tracker readback confirmed #40's parent #35, blocker #28, and `enhancement` plus `ready-for-agent` labels. No UI/rendered/native application behavior is claimed.

# B05C preflight — root approval, 2026-11-16

Root approved the minimal extension documented in [B05C](../tasks/B05C.md), superseding the unapproved proposal in [04C6 preflight](04C6-preflight.md). Read-only inspection at `Akshay-VK/quanta-pulse@d0092fd1767a2891ab4fa64ffe01962bad041de0` plus frozen pending frontend. Execution stays serialized until root finishes the App gate and dispatches a new accepted base. No implementation occurred during this preflight.

## Shared caller assessment

- `commands.rs:198` existing `events_range` delegates to `db.rs:1135` `list_events_filtered`; API `api.ts:103` exposes four positional arguments. CoursePage Activity (`CoursePage.tsx:170`) requests course/2000; ActivityCalendar (`ActivityCalendar.tsx:138`) requests date range/default limit. Optional fifth offset leaves these calls valid. Raw timestamp primary ordering and date conversion remain unchanged.
- The only other production path into that DB query is `db.rs:1184` `list_events`, through `commands.rs:144` and `api.listEvents` (`api.ts:91`). Repository search found no current view call to `api.listEvents`. Keep its unread flag, default 200 and command clamp 1..1000; DB filter's own default 500/clamp 1..5000 and type/date predicates also remain unchanged. Existing DB/attention tests call these functions directly.
- `list_events_filtered` already normalizes `EventFilter.offset` to nonnegative zero by default. It currently orders raw `detected_at DESC` only. Appending `id DESC` resolves undefined equal-raw-timestamp order, including bounded tied-page membership selection, without changing WHERE predicates, joins, watermarks, read/dismiss behavior or any event's eligibility. Root explicitly approved this shared effect after caller assessment. It does not adopt History's parsed-instant ordering.
- B05A `query_history_events` is separate and applies `history_clear_event_id`; its parsed-instant/ID order, total and accepted consumers stay unchanged. `list_dashboard_events` is separate too. `EVENT_SELECT` preserves missing-resource events; no resource join or visibility predicate is added by B05C.

## Frozen decision and limits

The [packet](../tasks/B05C.md#exact-approved-contract) owns the exact signature, normalization, wire shape, membership, error contract and proof matrix. This is an existing-command offset extension, without new DTO/registration/mode/query framework. Accepted B05 #27 remains unchanged; B05C is a redesign #14 prerequisite for 04C6, depending on accepted #15/#28.

Retain raw-timestamp ordering, calendar suppression exclusion and local-date half-open bounds. Include History-cleared, read, dismissed, baseline and orphan rows. App's complete History publication cannot replace Activity due to the clear-watermark difference. Completed offset traversal is not an atomic snapshot; no total or concurrency consistency guarantee is added. No growth/time cleanup or extra UI features.

Native publication requires duplicate search, explicit `Akshay-VK/quanta-pulse` target, ready-for-agent plus explicit execution hold for B05C, and blocked/unlabelled-for-agent 04C6 under #35 with #50/#33/#40/B05C edges. Root must accept #50/B05C and integrate matching-course independent Activity props before 04C6 can be ready. Prior proposal remains historical.

Published B05C: [#52](https://github.com/Akshay-VK/quanta-pulse/issues/52), native child of #14, blockers #15/#28; ready-for-agent with explicit root App-gate execution hold. Next consumer: [04C6 #53](https://github.com/Akshay-VK/quanta-pulse/issues/53).

## Publication readback and docs-only validation — 2026-11-16

Duplicate searches (B05C, 04C6, Course Activity, range paging and offset/events_range) found no matching bounded issue before creation. Explicit repository API confirmed `Akshay-VK/quanta-pulse` with Issues enabled. `gh issue` mutations used `--repo Akshay-VK/quanta-pulse`; REST calls used explicit `repos/Akshay-VK/quanta-pulse/...` endpoints (the REST CLI has no `--repo` flag).

Native readback: #52 parent #14, blockers #15/#28, labels enhancement/ready-for-agent; #53 parent #35, blockers #50/#33/#40/#52, enhancement only. The execution hold is explicit in #52's body despite readiness. Parents/blockers were read back with labels: #14 enhancement; #15/#28/#40 enhancement/ready-for-human; #35 no labels; #50 enhancement/ready-for-agent (preserved, not an acceptance claim); #33 ready-for-human. Existing issue bodies, labels and blocker edges are unchanged. Accepted B05 #27 remains enhancement/ready-for-human under #14, with its B05A/B05B contract unchanged. Issues remain open under the existing acceptance workflow.

PASS: all 57 task records retained, unique and acyclic with every real dependency present (`none` is the existing task-00 sentinel). B05C now depends on 00/B05A; 04C6 retains 04C4/04B/04C0/B05C. The other 55 records are identical to this task's starting snapshot. All 98 ownership rows remain byte-identical; screen-coverage SHA-256 `0f4a09a03c0ab3437b894bc366b60c2c7bb741e9a9828827e5f990f2ba90002e`. All 291 files enumerated by `rg --files src src-tauri tests` retain their starting hashes, with no additions/removals, including frozen pending frontend. HEAD remains `d0092fd1767a2891ab4fa64ffe01962bad041de0`. All six leased documents pass local-link, trailing-whitespace and exactly-one-final-newline checks; `git diff --check` passes.

Only tasks/B05C.md, contracts/B05C-preflight.md, dated additions to tasks/04C6.md and contracts/04C6-preflight.md, README.md and task-index.json changed. No Git writes, source/test changes, implementation, app launch or frontend/Rust/runtime gates. Root alone integrates and lifts execution holds.

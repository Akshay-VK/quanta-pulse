# Redesign implementation: subagent execution plan

Planning artifact, 15 November 2026. Planning-source baseline: `1bd0e8b5a24b05733295b5751a7bc42de7b90b43`. Historical checkpoint at planning time: task 01 was accepted at `985b1a9`, B01 at `23bf0ce`, and B02 was active. Later acceptance evidence lives in dated wiki records and GitHub Issues. Existing untracked `docs/research/` inputs are user material and must be preserved.

The plan uses fresh, narrowly scoped workers and one coordinator/integrator. Dispatch one packet at a time to a worker; do not give workers this entire directory or the planning conversation. Task 02 is an umbrella split into native child packets 02A (shared controls) and 02B (overlays); 02A depends on 01, 02B depends on accepted 02A, and 02 completes after 02B. Downstream dependencies remain on 02. All 98 exported screens retain their existing single ownership rows. Shared foundations precede screen work; missing backend capabilities are explicit prerequisites.

B04 is split into native child packets B04A (storage/query) and B04B (engine observation/proof). B04A depends on task 00; B04B depends on accepted/integrated B04A; downstream task 15 remains dependent on B04 until both children are accepted. This records its original dispatch order; both children were later accepted on 2026-11-16, documented in the dated scan-diagnostics wiki record.

B05 is split sequentially into native child packets B05A (complete History reads and resource unread snapshot) and B05B (frozen History deletion scope). B05A depends on task 00; B05B depends on accepted B05A; task 15 remains directly dependent on B05 and I01 consumes that contract through its existing task dependencies. Only B05A is approved/ready. All 98 screen-coverage ownership rows remain unchanged.

B07 is split sequentially into native child packets B07A (frozen saved-file deletion core) and B07B (Tauri/frontend API exposure). B07A depends on task 00 and accepted B02; B07B depends on accepted B07A; downstream task 14B remains dependent on B07. Only B07A is approved/ready. Settings UI ownership stays with task 14B, Inbox ownership is unchanged, and all 98 screen-coverage ownership rows remain unchanged.

## Read in this order

Coordinator: this document → [decisions](decisions.md) → [screen coverage](screen-coverage.md) → the next eligible packet. Worker: `AGENTS.md` → [worker contract](worker-contract.md) → its single task packet → only named source/spec sections and its assigned screen rows. [task-index.json](task-index.json) is machine-readable dependency/scope data, not live status.

Authoritative inputs are [the local 98-screen export](../pulse-design/README.md) and [the written implementation spec](../quanta-pulse-ui-implementation-spec.md). The spec's reference to a 20-screen canvas predates the local export. Use local HTML for visual detail and written recipes for behavior; resolve contradictions through task 00 rather than silently choosing a variant. Gallery HTML is static reference, not production architecture. All exact copy/dimensions/state details in assigned sources remain acceptance requirements even when summarized in a packet.

## Scope and retained architecture

Implement the redesign across existing Inbox, Calendar, Library/course, History, Settings, sign-in, inspector, previews, overlays, responsive/light/focus states. Reuse current Radix, cmdk, fonts, local data, complete attention/deadline queries, material actions, selection adapters and Settings guard. No academic scraping expansion, submissions tracking, server/cloud account, telemetry, unrelated architectural rewrite or packaging/release project.

Current ownership at the baseline:

- `src/App.tsx:84` owns auth/routes/event bridge/collections/global overlays. Selection starts at `:438`, closes/restores focus at `:557`, adapters at `:589`; material execution is at `:489`/`:515`. These remain single owners.
- `src/hooks/useAttention.ts` independently owns list/count generations and complete due data. `CalendarView.tsx` owns tabs; Agenda is presentation over App-owned due data; `ActivityCalendar.tsx` owns independent month/day requests. Freeze a panel-placement contract so historical inspection replaces the selected-day panel.
- `SettingsView.tsx` owns draft/controller; App owns guarded navigation. Appearance stays local and separately owned by `useTheme`/`appearance.ts`.
- Actual CSS already lives in `src/styles/`, imported by `src/main.tsx`; the AGENTS shorthand `src/styles.css` is not an instruction to create a new parallel stylesheet. Split mixed view selectors once or lease exact sections.
- Core snapshots/read-state/dismiss APIs, due inventory, monitoring/reset/cache/Telegram/local-file actions already exist. Extend narrow gaps rather than rebuilding them. New command registration and API wrappers stay paired; wire types remain camelCase.

## Roles, context and integration

Reserve one slot for the coordinator. Run at most two independent implementation workers; use the remaining fourth slot for a focused read-only review when useful. Parallel work is conditional on disjoint leases and stable contracts, not a quota. Backend tasks share command/registration/API/type/database files: serialize them by default.

Each dispatch includes task ID/approved issue, integrated base SHA, exact file lease, relevant resolved decisions, necessary contract excerpt, assigned screen rows, and prerequisite completion records. Start fresh workers (`fork_turns: none`); do not reuse a long transcript across tasks or inherit the coordinator's history. Keep completion messages under approximately 500 words; preserve details in code/tests/evidence instead of replaying tool logs. No worker spawns its own workers.

00 freezes these contracts before parallel screen work: shell/header/status slots; DetailsAdapter identity/owner/focus restoration; selected-day vs inspector placement; row intent callbacks/multi-selection; material destination and mirror lifecycle DTO; captured read/dismiss/delete snapshots; Settings draft/navigation controller; course effective-name precedence; History query/diagnostic DTO; scoped/global hotkey priority. Exact TypeScript/Rust signatures come from inspected current exports and approved B-task contracts, not speculative replacement APIs.

The coordinator alone writes `App.tsx`, global keyboard wiring, `main.tsx` imports and shared integration tests when others are running. Screen workers return prop/interface changes and integration hunks. Accept and wire each slice as it arrives; keep the app runnable throughout. I01 is the final integration acceptance gate, not permission to postpone all integration until the end. Small composition-preserving extraction is allowed where it establishes a required seam; wholesale App refactoring is outside scope.

## Execution order

Dependency lists in packets are hard prerequisites; all refer to accepted integrated results. This order is a scheduling guide, not a mandate to wait for unrelated branches.

1. **00** reconciles sources and decisions, inventories actual exports and publishes frozen contract excerpts. Missing product decisions block only named consumers.
2. **01 → 02A → 02B → 02 → 03 → 04** establishes tokens/appearance, shared controls, overlays, shell and rows/keyboard. Coordinator wires shell first. Backend capability tasks **B01–B10** can proceed after 00, serialized over shared files.
3. **05** establishes inspector after B02. **13** can establish Settings structure after 01/02. **16** can proceed after shell and B08. Screen work may use existing safe APIs, but acceptance requiring an unimplemented contract must wait.
4. Once 04/05 are accepted, eligible independent screen workers are **06** Inbox, **07** Agenda, **08** Activity, **09** Library, **15** History after B04/B05. Run at most two at a time with view/CSS leases. For 07/08, freeze Calendar wrapper and panel contract first; serialize `CalendarView.tsx` or assign it to integrator.
5. **10** follows Library and B01/B06. **11** follows Library search/navigation contracts. **12** follows inspector and approved PDF decision. **14 → 14A → 14B → 14C** serializes draft lifecycle, account/notifications/Telegram, storage/destructive recovery, then About/updater. The packets list exact backend prerequisites. **17** follows shell/B02; reserve DownloadsPopover until 14B releases it; 17 also waits for B08 cancellation.
6. **I01** accepts all App wiring and intentional read-on-inspect change. **18** closes integrated responsive/zoom/focus/theme behavior. **19** proves every screen and spec-only requirement, then records external native limits.

No dependency cycle exists. Tasks 13/14/14A/14B/14C deliberately serialize SettingsView; task 14B releases DownloadsPopover before 17; task 05 releases shared details presentation before 15. 09 releases `filter.ts` before 11. 04 releases row/table primitives before dependent views.

## Ticket publication and acceptance

Use GitHub Issues in **Akshay-VK/quanta-pulse** as the live tracker per [issue-tracker guidance](../../../agents/issue-tracker.md). These files are reusable planning/dispatch references, not a second status board. The dedicated redesign parent is [#14](https://github.com/Akshay-VK/quanta-pulse/issues/14), with [task 00 as native sub-issue #15](https://github.com/Akshay-VK/quanta-pulse/issues/15). Task 02 is published as an umbrella with native 02A/02B children. B07 is native sub-issue [#37](https://github.com/Akshay-VK/quanta-pulse/issues/37) of #14, with B07A #38 blocked by #15 and accepted B02 #18, and B07B #39 blocked by B07A. Only fully specified 02A and B07A receive ready-for-agent; 02B and B07B remain not ready until their preceding child is accepted. The earlier accepted themes/workflows issue #12 remains untouched.

Repository/Issues availability and duplicate titles were checked with the explicit repository target before publication. Task 00 and 02A carry `ready-for-human` after acceptance; B07A has `ready-for-agent`; 02B and B07B remain not ready until their predecessors are accepted. Use native blocking relationships with readable parent/blocker links, preserve labels, and read back every issue/label/parent/blocker after publication. Every `gh` command uses `--repo Akshay-VK/quanta-pulse` explicitly. Do not close issues until their accepted integration workflow is satisfied. Current task-00 decisions/blockers are in [decisions](decisions.md); its source-frozen consumer excerpts are in [contracts/00.md](contracts/00.md).

## Acceptance gates

For each slice: behavioral regression before new wiring, exact source states covered, required frontend lint/test, Rust check/focused tests if changed, clean diff, contract handoff and read-only review. Integrator runs build after accepted slices; rerun full gates on final assembled head. A worker passing standalone fixtures does not prove App integration.

Final UI evidence must cover every one of the 98 exported states through deterministic scenarios, with primary task IDs in [screen coverage](screen-coverage.md). Capture the running implementation, not exported HTML. Verify nominal 1280×800 and 1440×960, minimum 820×540, 1100/960 breakpoint boundaries, both densities, reference light/dark screens, long names, empty/error/stale data, large inventories, reduced motion and focus. Actual 200% zoom and 720×480 CSS reflow are separate checks. Check contrast on composite rendered states, including unavailable rows and custom accents.

Spec-only behavior also needs explicit proof: shortcut scope/IME guards; captured action scopes and arriving items; rollback and Undo; silent first/reset baselines across partial scans; source/saved/offline independence; complete search and authoritative deletion counts; local date/DST/date-only truth; Settings drafts/leave races; old/future appearance storage; partial delete; unknown-length progress/cancel; auth callbacks after cancellation; safe diagnostics; signed updater ordering.

Use development app/runtime checks for native SSO, baseline/reconnect, local file and PDF/media handling, OS theme/permission behavior, tray/autostart and update lifecycle where hosts/credentials are available. Never run packaged app in dev. Record simulated/DOM/rendered/native evidence separately and name missing hosts/credentials as acceptance limits. Do not claim live Quanta or signed installation success from mocks. An unavailable required native check remains explicit, not silently passed.

## Copyable dispatch

```text
Implement task <ID> from <packet path> against <base SHA> for <approved issue URL>.
Read AGENTS.md, worker-contract.md, that packet and only its assigned sources.
File/CSS lease: <exact paths and selectors>. Shared files remain coordinator-owned.
Resolved decisions: <only relevant IDs and resolutions>.
Frozen contract: <exact minimal signatures/invariants>.
Predecessors: <compact accepted handoffs>.
Screen rows: <only this task's references>.
Write regression before behavior wiring, fulfill every packet/source acceptance,
run required gates, and return worker-contract completion record. No subagents.
```

If a scope needs more than one independent lifecycle or cannot fit this context budget, split it before dispatch and update native blockers and screen ownership. Settings backend work is already separated into interval validation (B03), failure notifications (B09) and explicit version retention (B10). Each uses a fresh worker and serialized shared-file lease.

Settings packets are deliberately sequential even where operations are independent: their shared SettingsView file has one writer, and every pass starts with fresh context.

On 2026-11-16, task 04 was split into 04A visual geometry, 04B pure keyboard policy, and 04C serialized surface integration. Dependencies remain on umbrella 04; I01 stays downstream, avoiding a keyboard/read-on-inspect integration cycle. The original 98 screen ownership rows are unchanged.

On 2026-11-16, the resource action membership gap was split into prerequisite 04C0 under 04C. It adds a complete, uncapped API snapshot for selected resource event IDs, independent of read state, Inbox dismissal and History clear watermarks, while excluding baseline and calendar-suppressed events. 04C remains dependent on both 04C0 and 04C1; all original 98 screen owners remain unchanged.

On 2026-11-16, B07 was split into core B07A and API B07B; 04C’s first surface packet is 04C1 Inbox. The coordinator validated 46 acyclic packets with all 98 unique screen assignments unchanged. B07A depends on plan tasks 00 and B02 (GitHub issues #15 and #18), not final validation task18. Later 04C surfaces remain required before umbrella acceptance.

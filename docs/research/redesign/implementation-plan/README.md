# Redesign implementation: subagent execution plan

Planning artifact, 15 November 2026. Application implementation has not started. Code baseline: `1bd0e8b5a24b05733295b5751a7bc42de7b90b43`. Planning branch: `docs/redesign-subagent-plan`. Existing untracked `docs/research/` inputs are user material and must be preserved.

The plan uses fresh, narrowly scoped workers and one coordinator/integrator. Dispatch one packet at a time to a worker; do not give workers this entire directory or the planning conversation. There are 34 task packets, with all 98 exported screens assigned exactly once. Shared foundations precede screen work; missing backend capabilities are explicit prerequisites.

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
2. **01 → 02 → 03 → 04** establishes tokens/appearance, primitives, shell and rows/keyboard. Coordinator wires shell first. Backend capability tasks **B01–B10** can proceed after 00, serialized over shared files.
3. **05** establishes inspector after B02. **13** can establish Settings structure after 01/02. **16** can proceed after shell and B08. Screen work may use existing safe APIs, but acceptance requiring an unimplemented contract must wait.
4. Once 04/05 are accepted, eligible independent screen workers are **06** Inbox, **07** Agenda, **08** Activity, **09** Library, **15** History after B04/B05. Run at most two at a time with view/CSS leases. For 07/08, freeze Calendar wrapper and panel contract first; serialize `CalendarView.tsx` or assign it to integrator.
5. **10** follows Library and B01/B06. **11** follows Library search/navigation contracts. **12** follows inspector and approved PDF decision. **14 → 14A → 14B → 14C** serializes draft lifecycle, account/notifications/Telegram, storage/destructive recovery, then About/updater. The packets list exact backend prerequisites. **17** follows shell/B02; reserve DownloadsPopover until 14B releases it; 17 also waits for B08 cancellation.
6. **I01** accepts all App wiring and intentional read-on-inspect change. **18** closes integrated responsive/zoom/focus/theme behavior. **19** proves every screen and spec-only requirement, then records external native limits.

No dependency cycle exists. Tasks 13/14/14A/14B/14C deliberately serialize SettingsView; task 14B releases DownloadsPopover before 17; task 05 releases shared details presentation before 15. 09 releases `filter.ts` before 11. 04 releases row/table primitives before dependent views.

## Ticket publication and acceptance

Use GitHub Issues in **Akshay-VK/quanta-pulse** as the live tracker per [issue-tracker guidance](../../../agents/issue-tracker.md). These files are reusable planning/dispatch references, not a second status board. The dedicated redesign parent is [#14](https://github.com/Akshay-VK/quanta-pulse/issues/14), with [task 00 as native sub-issue #15](https://github.com/Akshay-VK/quanta-pulse/issues/15). The earlier accepted themes/workflows issue #12 remains untouched.

Repository/Issues availability and duplicate titles were checked with the explicit repository target before publication. Only the fully specified task-00 child currently has `ready-for-agent`; unresolved future tasks remain unpublished and not ready. Publish each future native sub-issue after prerequisites/contracts are ready, use native blocking relationships with readable parent/blocker links, preserve labels, and read back every issue/label/parent/blocker after publication. Every `gh` command uses `--repo Akshay-VK/quanta-pulse` explicitly. Do not close issues until their accepted integration workflow is satisfied. Current task-00 decisions/blockers are in [decisions](decisions.md); its source-frozen consumer excerpts are in [contracts/00.md](contracts/00.md).

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

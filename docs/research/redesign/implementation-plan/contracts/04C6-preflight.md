# 04C6 Course Activity preflight — 2026-11-16

Current status: see the dated superseding root approval at the end of this document; the earlier proposal/publication status below is historical.

Docs-only inspection at shared HEAD `d0092fd1767a2891ab4fa64ffe01962bad041de0`, including frozen pending Course Materials and App/History source. Root alone integrates. [Packet](../tasks/04C6.md) is BLOCKED / NOT ready-for-agent. #50 has behavioral evidence (699 tests), but its final 2px focus/pixel gate remains pending; this preflight does not accept it. App currently wires complete `queryHistoryInventory`, but that integration remains unaccepted until root's App gates. Neither fact grants Activity completeness.

## Existing membership: History is incompatible

Observed `CoursePage.tsx:170` calls `api.eventsRange(undefined, undefined, course.id, 2000)`. `commands.rs::events_range` converts optional local calendar dates to UTC bounds, clamps limit to 1..5000, and delegates to `db::list_events_filtered`. Its DB filter excludes `calendar_suppressed`, applies course and optional time bounds, and defaults `unread_only` false. It applies neither History nor Dashboard clear watermarks and does not join Inbox dismissals as a visibility condition. Baseline, read, dismissed, orphan and History-cleared stored events remain members. Physical deletion removes membership. Raising the cap to 5000 is still incomplete.

B05A `db::query_history_events` additionally requires `e.id > history_clear_event_id`. It sorts parsed timestamp instants with ID tie-break, supports History search/type filters and returns totals. Activity's existing query sorts raw `detected_at DESC`, without an ID tie-break. Thus a complete App History publication cannot reconstruct Course Activity: filtering it by course silently loses History-cleared events, and its ordering semantics also differ. Keep B05A and its accepted History consumers unchanged. Do not borrow History readiness to grant Activity action permission.

Activity currently groups every returned course event by local day, sorts day keys descending, and retains backend order within each group. Materials search/type/category/sort do not filter Activity; preserve that separation. The current event array also feeds last-change/new-this-week header metrics. Complete replacement must keep their course scope and retained-data status explicit. Existing Activity `unread={false}` is presentation, not action eligibility. Existing loading failure retains prior event state. Inspection resolves current resources through the existing deduped Materials inventory; missing resources remain inspectable events.

## Proposed prerequisite B05C: preserve range semantics while paging

This is an unapproved backend proposal, not an implementation lease or published issue. Root must approve/freeze it, arrange a native prerequisite and accept its proof before 04C6 dispatch. Minimal proposal:

```ts
api.eventsRange(from?: string, to?: string, courseId?: number,
                limit?: number, offset?: number): Promise<ChangeEvent[]>
// Existing default limit 2000; omitted offset means 0.
```

Append optional `offset: Option<i64>` to the already registered Rust `events_range` command; pass it to existing `EventFilter.offset` (currently unused by this command). Preserve existing nonnegative offset normalization and limit clamping, local-date conversion, half-open UTC bounds, suppression, baseline/read/dismissal/watermark membership and existing error behavior. Add `e.id DESC` after raw `e.detected_at DESC` to stabilize ties for offset paging; preserve raw timestamp ordering rather than silently adopting B05A's instant sorting. No new command, DTO, registration, History mode flag or generic query layer is necessary. Root must explicitly approve that tie-order clarification and assess other callers of the shared DB query before implementation.

Candidate serialized prerequisite files: `src-tauri/src/commands.rs`, `src-tauri/src/db.rs`, `src/lib/api.ts`, new focused API test and in-module Rust tests. No model/lib.rs change is expected because the command and return type already exist. Backend proof must cover >2000 and >5000 events, exact-multiple terminal pages, stable equal-timestamp ties, course exclusion, missing resources, baseline/read/dismissed/History-cleared inclusion, suppression exclusion and unchanged existing date boundaries/default callers. Relevant Rust tests/cargo check and frontend API gates belong to that future lease.

Root then collects course-specific pages of 2000 until a short page, including an empty final request at exact multiples. Reject invalid IDs, duplicate IDs, oversized pages or API errors; publish only after all pages succeed for the current course/refresh generation. Retain the last completed array on failure, with readiness false. This vector API supplies no total: count drift or every concurrent offset omission cannot be detected. Offset paging is not atomic, even with stable ties. Promise a completed traversal, not a transaction-wide snapshot. If atomic completeness or total consistency is required, stop for a revised backend contract rather than claiming the minimal proposal proves it.

## Exact root adapter proposal after prerequisite approval

Root owns collection lifetime, App/global refresh, LibraryView forwarding and adapter tests. Add these declarations to LibraryView and CoursePage, passing names unchanged at the existing CoursePage call:

```ts
activityEvents?: ChangeEvent[]; // undefined = no completed course publication
activityCourseId?: number;    // must equal CoursePage.course.id
activityPending?: boolean;
activityError?: string | null;
activityScopeReady?: boolean; // only explicit true permits a new mutation
onActivityChanged?: () => Promise<void>; // rejects refresh failure/supersession
```

The separate course identity prevents a retained prior-course array from becoming this course's scope. Root's App call supplies the completed range publication, its matching course ID, independent error/pending/ready state and rejecting refresh completion. The worker consumes those props, removes its capped event request and preserves Materials inventory props/onChanged. Root's retry must refresh both this Activity publication and existing App counts/resources through their current owners after mutation; it must not report success when either required refresh failed. Initial/failed range loading uses the Activity props, with retained rows inspectable but unavailable for new mutations. Retry uses `onActivityChanged` only. Resource inventory failure remains separately visible; it does not authorize replacing event scope with resource siblings. App's existing catch-and-resolve refresh is insufficient unless root uses its rejecting success-required path and validates Activity readiness too.

Do not pass `historyEvents`, History's `eventScopeReady` or History error state as Activity scope. Root chooses the serialized collector location; no worker hook/App/API lease or new preview executor is granted. Existing explicit-ID `api.setEventReadState` and `api.dismissInboxEvents` suffice inside the leased view; refresh execution stays with App.

## Event capture, focus and lifetime contract

Identity is `change:<event.id>`, separate from `resource:<id>`. Reuse ResourceRow's `keyboardFocused`, `multiSelected`, `tabStop`, `selectRef`, `onKeyboardFocus`, existing DetailsAdapter and accepted list policy/recovery. Movement changes only focus; X changes local event selection; Enter calls `selectChange(event, origin, currentResourceOrNull, restoreFocus)` once. Keep inspection/read-on-inspect unchanged until I01. Space invokes the existing material action policy's available preview once; unsupported preview is inert. Baseline is inert for E/U/Delete/Shift+A; navigation and existing inspection semantics remain.

For E/U/Delete first choose selected matching event identities, otherwise focused matching identity; then exclude baseline and freeze positive unique event IDs. An ineligible selected set stays empty: never fall back to focus after eligibility filtering. Already-read events are eligible for U; orphan events remain eligible. Shift+A copies every eligible event ID in the complete course publication across all day groups and offscreen rows, then opens captured confirmation. Freeze synchronously at activation, with no resource snapshot or unread snapshot and no sibling expansion. Same-course arrivals after capture survive.

Delete confirms only `dismissInboxEvents`: “Dismiss these captured changes from Inbox? Course activity, History, Library materials, saved files and your baseline are kept.” Show event count; Cancel/empty scope mutate nothing. Current void APIs ignore physically missing IDs and may mutate still-stored History-hidden IDs; promise captured intent, not affected counts or eligibility revalidation. Dismissal keeps read state and visible Activity membership. Preserve permanent History header deletion and Scans under #51/task15's separate boundaries.

Each capture carries copied IDs, generation, duplicate lock and mutation-success state. Invalidate dialog and all success/rejection/finally continuations on course/route/unmount and Activity→Materials transitions. Any future Activity membership filter must invalidate too; Materials-only filters must not silently redefine Activity scope. Same-course refresh/read changes prune current selection but never widen a capture. Failures remain visible; failed mutation retries original IDs. After mutation success, refresh failure offers refresh-only retry, never replaying mutation. Stale finally cannot unlock a newer action.

Handle keys only from the active Activity row-select control. Nested native controls, editables, prevented keys, IME/229, repeat/modifiers and drawer/dialog/menu/listbox/palette overlays win. Handled keys prevent default/stop propagation before App globals; App retains navigation/search/Escape. No new global registry. Restore by current event identity through a view-local ref map, using `recoverFocusedId`; absent/empty fallback is the Activity tab control. Restoration requires prior list focus or explicit close, cancels superseded/unmounted/modal-blocked requests and never steals focus on refresh alone. Keep day groups non-collapsible in this packet: section/time collapse remains an umbrella gap, not permission to modify GroupHeader.

## Tracker and documentation boundary

Explicit repository `Akshay-VK/quanta-pulse` confirmed with Issues enabled. Searches for 04C6, Course Activity and range paging found no existing matching bounded child; older inspection tickets and #50/#51 are different scopes. Read #35 parent and #50/#33/#40 prerequisites. Under the instruction to return a proposal when a backend prerequisite is needed, publish neither an ambiguous backend issue nor a prematurely specified Activity child. Native bootstrap is deferred to root's approval: 04C6 under #35, blockers #50 plus accepted #33/#40 and the newly approved paging prerequisite. Read back parent/blocker/label edges at publication; omit ready-for-agent until #50 accepted, paging accepted and root adapter integrated. Existing issues/labels are unchanged.

Only this contract, tasks/04C6.md, README's new entry and task-index additions/04C dependency are leased. B05C is a proposed prerequisite record, outside the accepted B05 umbrella. Preserve all 55 prior task records except 04C's appended dependency and all 98 screen ownership bytes. No source/test edits, Git writes, delegates, runtime proof or implementation gates are part of this preflight.

Validation PASS: 57 unique task records form an acyclic graph with every dependency present. All 55 previous records match the preflight snapshot exactly except 04C's appended 04C6 dependency. All 98 screen ownership rows are byte-identical (SHA-256 `0f4a09a03c0ab3437b894bc366b60c2c7bb741e9a9828827e5f990f2ba90002e`). All 291 source/test files in the frozen snapshot retain identical hashes, with no additions/removals. Four leased documents pass trailing-whitespace/exactly-one-final-newline checks; `git diff --check` passes. No frontend/Rust/runtime gates were run because this is documentation-only research. No tracker mutation was performed; root must finish native publication/readback after prerequisite approval.

## 2026-11-16 — Superseding root approval and native publication

Root explicitly approved [B05C #52](https://github.com/Akshay-VK/quanta-pulse/issues/52) as the minimal existing-command extension; [B05C packet](../tasks/B05C.md) and [caller assessment](../contracts/B05C-preflight.md) now freeze its exact contract. This supersedes the earlier unapproved-proposal/publication-deferred statements, without changing the historical inspection. B05C is a native child of #14, depends on accepted #15/#28, and leaves accepted B05 #27 unchanged. It is fully specified / ready-for-agent but implementation is held until root's pending App frontend gate finishes and root dispatches its serialized lease. No B05C implementation is authorized during that gate.

04C6 publication under #35 is approved with native blockers #50/#33/#40/#52; **BLOCKED / NOT ready-for-agent** until Materials #50 accepted, B05C #52 accepted, and root's independent matching-course Activity collector/props and rejecting refresh adapter integrated. Root supplies the accepted implementation base. Existing Activity acceptance, exact view/test lease and adapter/capture/lifetime contracts above remain binding. App complete History cannot substitute because its History clear watermark removes still-visible Activity members. Offset paging preserves Activity membership and raw timestamp order with explicitly approved ID ties; it supplies neither a total nor an atomic snapshot. No extra UI features or growth/time cleanup.

Published 04C6: [#53](https://github.com/Akshay-VK/quanta-pulse/issues/53), native child of #35, blocked by #50/#33/#40/#52; no ready-for-agent label.

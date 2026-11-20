# 04C4 Course Materials preflight — 2026-11-16

Read-only source inspection at accepted [`772764b`](https://github.com/Akshay-VK/quanta-pulse/commit/772764b). Approved native child [#50](https://github.com/Akshay-VK/quanta-pulse/issues/50) of [04C #35](https://github.com/Akshay-VK/quanta-pulse/issues/35); [packet](../tasks/04C4.md) owns acceptance. Implementation is blocked until 04C3 #48 is accepted. Root remains sole integrator. No source/test implementation is part of this preflight.

## Owner and bounded lease

`src/views/library/CoursePage.tsx` owns Materials/Activity tabs, resource loading, tree flattening, search/filter/sort, expansion, index focus, virtualizer and inspection restoration. `TreeRow.tsx` presents treeitems and nested folder/name/Quanta/material controls. Materials alone is a bounded next packet; Activity adds event-history completeness, grouping and a distinct interaction lifecycle and stays deferred. Courses hub navigation and History each require a fresh later preflight. No whole gallery or History implementation was loaded.

Worker lease: `src/views/library/CoursePage.tsx` (Materials behavior, shared resource inventory consumption and tab invalidation only), `src/views/library/TreeRow.tsx`, new `tests/appCourseMaterialsKeyboard.test.tsx`. Keep Activity's event query/rendering, course header actions, baseline reset, mirror/download execution and existing tests unchanged. Local policy stays within the current owner; no new shared policy or hook owner. App, hooks, CSS, DataTable, APIs/types/Rust and B08B/B10 tests have no worker lease.

## Complete resource and event scopes

At this base `CoursePage.load()` calls `listResources({courseId, limit:2000})` and `eventsRange(..., course.id, 2000)`. The comment claiming a backend course discovery cap is not a completeness guarantee. `inventory` currently only triggers that reload. App already calls `queryResourceInventory()` in `useAttention.ts`, paging offset/limit 2000 until a short page (including an empty page at exact multiples), then publishes after a refresh-generation check. Reuse the completed `inventory` prop, filtered by `course.id`, as Materials' resource source; remove its redundant capped resource query. Preserve Activity's existing event query and generation guards without claiming complete Activity scope. Missing inventory is unavailable scope, not permission to query a second copy. Pending/error flags gate new mutations while retained rows remain navigable. App paging is complete for its last publication, not an atomic cross-page backend snapshot.

Apply existing `dedupeCourseResources`, then `filterCourseResources` and `sortResources` unchanged. Search matches title/type/section path; an empty query shows the tree. Freeze numeric resource IDs from all matching resources before awaiting or traversing visible/virtual rows. Collapsed descendants remain in Shift+A scope. Multi-selection is resource-only, pruned by course/search/type/category membership, retained across sort/collapse. E/U/Delete use selected matching resources, otherwise the focused file. A focused folder is structural: X/E/U/Delete/Space are inert, even with selections; Shift+A remains whole matching course scope. No implicit folder-descendant action.

`api.snapshotResourceEventIds(resourceIds)` from accepted [04C0](04C0-handoff.md) returns complete unique eligible event IDs, including already-read and History-hidden events, independent of Inbox dismissal. Baseline/calendar-suppressed events stay excluded. Resource membership freezes synchronously; event membership freezes at the backend read. Events arriving after that read survive; events arriving between activation and the read may be captured. Never derive event scope from Activity's 2000 rows, App History, rendered rows or unread-only snapshots.

E/U call `setEventReadState(capturedIds, true|false)`. Shift+A awaits snapshot, passes IDs through accepted policy and confirms those IDs without resnapshotting. Delete uses the same resource capture and `dismissInboxEvents` after confirmation. Copy: “Dismiss these captured changes from Inbox? Library materials, History, saved files and your baseline are kept.” Show resource/event counts; Cancel is inert, empty scope explicit, and no deletion/reset API is used.

## Identity, tree controls and asynchronous lifetime

Use namespaced `resource:<externalResourceId || local:id>` and `folder:<CourseTreeNode.id>` identities; folders already use serialized ordered paths. Replace `search:id:index`, numeric/index focus and captured-index restoration. Give the local virtualizer `getItemKey` stable IDs. Keep navigation IDs in visible tree order; for resource action policy supply complete matching file IDs so collapsed selected files stay eligible. Recover focus with `recoverFocusedId`; explicit collapse of the focused descendant targets its surviving ancestor. Scroll-to-mount by current identity/index, cancel superseded/missing/unmounted/modal-blocked requests, and never replay an obsolete focus request. DetailsAdapter's restore callback resolves current identity, not an old index. Empty fallback is the local SearchField input ref. Restore only when the list owned focus or an explicit restore callback runs.

Use `getListNavigationIntent` for supported keys. Preserve guarded Home/End, folder Left/Right/Enter and typeahead locally; reserve J/K/X/E/U/Space/Shift+A before typeahead. Folder Enter toggles once; file Enter inspects once. Movement never inspects or changes read state. Space uses existing MaterialActionsContext preview, with existing fallback only as defined by that owner; no new preview shell. Preserve read-on-inspect until I01.

TreeRow currently lets nested focus bubble to `onActivate`, and its parent key handler catches nested Enter/arrows. Notify row focus only when target equals currentTarget. Native folder/name/link/material buttons retain keyboard ownership; suppress parent handling for nested controls, editors, prevented events, IME/229, repeats, modifiers and all drawer/dialog/menu/listbox/palette overlays. Scope handling to focused Materials tree only. Handled local keys prevent default and stop propagation; ignored global navigation/search/Escape retain App ownership. Activity tab must never activate Materials shortcuts.

Each capture holds immutable resource/event IDs and a generation token plus duplicate lock. Course/route/unmount, tab, search/type/category and sort changes invalidate dialogs and every async success/rejection/finally continuation; stale finally cannot unlock newer work. Collapse does not widen a capture; same-filter arrivals/refresh keep frozen membership. Failures are visible; snapshot failure has no mutation, mutation failure keeps confirmation IDs for retry. Track successful mutation separately from subsequent refresh: await `onChanged`, never resubmit successful mutation on refresh failure. App refresh catches failures and publishes `inventoryError` rather than reliably rejecting; observe those props as well as callback rejection. Retry refresh through existing ownership, with new mutations blocked until settled successful inventory. Preserve resource focus/inspection on retained-data failure.

## Root prerequisites, exact adapter hunk and visual gate

At `772764b`, App already passes `onChanged={refresh}` to LibraryView. No new App/hook/DataTable change is proposed. Root's only data adapter hunk is at the existing CoursePage call in `src/views/LibraryView.tsx`:

```diff
           inventory={resources}
+          inventoryPending={loading}
+          inventoryError={error}
```

Worker declares `inventoryPending?: boolean`, `inventoryError?: string | null`, and widens CoursePage's `onChanged` to `() => void | Promise<void>`; root applies the call-site hunk after those declarations exist, before assembled verification. Root supplies serialized dispatch/base and integration timing, not a second writer in CoursePage. CoursePage owns its own SearchField ref and virtual focus; accepted DataTable navigation is not applicable to this ARIA tree.

Visual prerequisite: current TreeRow conflates focused/inspected `aria-selected`, and tree CSS provides one selection fill plus a 1px focus inset. Independent resource multi-selection/inspection and spec 2px focus bar/ring are not established by the DataTable foundation. Root must resolve this scoped styling integration separately before acceptance; no CSS patch/proposal or implementation is supplied here, and worker must return a missing-adapter blocker instead of writing CSS. Keep this prerequisite visible at dispatch; accepted #48 alone does not establish tree styling.

## Publication and stop

Issues enabled in explicit `Akshay-VK/quanta-pulse`; searches for 04C4 and Course Materials keyboard titles returned no duplicate. Created #50 with enhancement only, no ready-for-agent. Readback confirms OPEN, native parent #35 and blocked-by #48/#33/#40; #33/#40 are accepted/open ready-for-human. #48 remains RUNNING/unaccepted per coordinator instruction despite its existing ready-for-agent label. No existing label/state was changed and no issue was closed. Stop after this Materials packet; Activity, Courses navigation, History and remaining section/time collapse/cross-surface integration remain separate, with 04C/04 incomplete.

## Documentation validation

Validated 54 unique acyclic task IDs with every dependency present. All 53 existing records are unchanged except 04C's added dependency on 04C4. All 98 screen ownership rows are byte-identical (SHA-256 `0f4a09a03c0ab3437b894bc366b60c2c7bb741e9a9828827e5f990f2ba90002e`). Six changed/new documentation files pass trailing-whitespace and exactly-one-final-newline checks. No frontend/native tests, browser work, delegates or Git writes were performed. Shared base observed at `772764b`; root supplies the next accepted dispatch base.

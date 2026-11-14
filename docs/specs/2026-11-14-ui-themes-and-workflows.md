# Quanta Pulse themes and student workflow overhaul

Specification date: 14 November 2026. Status: ready for implementation planning. The user requested this specification and approved the testing seams described below. This document specifies future work; saving or publishing it does not implement the overhaul.

Tracker: [GitHub issue #12](https://github.com/Akshay-VK/quanta-pulse/issues/12), labeled ready-for-agent.

## Problem Statement

Students need a comfortable desktop workspace for understanding course changes, finding material, checking deadlines, and opening saved files. The current appearance offers only light, dark, and system modes, with one palette per mode. Its dark surfaces and violet emphasis do not give users enough control over comfort or visual character. Status, course identity, file type, selection, and background work can compete for attention.

The previous workspace redesign already introduced compact Geist typography, fluid working views, stable course shortcuts, shared details, keyboard fixes, and safer Settings navigation. Those capabilities must be retained. Remaining problems include the lack of named themes, a read-state action that cannot mark material unread, globally scoped read operations behind potentially scoped labels, inconsistent material-opening destinations, and a Calendar whose activity dates can be confused with actual due dates.

Students should not need to understand scans, preview caches, download queues, and source URLs to answer four questions: what changed, what is due, where is my material, and is monitoring working? They must also be able to distinguish no changes from an unsuccessful refresh, and source availability from the existence of a saved copy.

## Solution

Evolve the existing workspace into a calm academic tracker using Linear-style list navigation and triage, Notion-style course context and inspection, and T3 Code-inspired neutral palettes. Keep the application's own identity and existing local-first architecture.

Provide independent appearance mode, named palette, accent, and row-density preferences. Use Soft Graphite as the new default palette, with T3 Neutral available for closer reference fidelity. Preserve the user's explicit light/dark/system choice during migration.

Rename the global change feed Inbox, separate attention state from event type, introduce a due-date agenda based on actual resource deadlines, retain the existing activity calendar with an explicit label, and use the same inspector and material-opening actions throughout the application. Group settings around user goals and make healthy sync unobtrusive while retaining actionable recovery messages.

The overhaul is complete only when the observable behavior, persistence, accessibility, error handling, and bounded native verification requirements below are satisfied. Screenshots or a theme picker alone do not establish completion.

## User Stories

1. As a student, I want a calmer workspace, so that course material carries more emphasis than application decoration.
2. As a student, I want neutral T3 Code-inspired colors, so that the tracker feels familiar alongside my working tools.
3. As a student sensitive to stark dark surfaces, I want a softer charcoal palette, so that I can choose a comfortable appearance.
4. As a student, I want several coherent color families, so that personalization changes the workspace rather than only a button color.
5. As a light-mode user, I want every palette to have a readable light variant, so that choosing a palette does not force dark mode.
6. As a system-mode user, I want the app to follow OS appearance changes, so that it stays aligned with my environment.
7. As an existing user, I want my saved appearance mode preserved, so that upgrading does not unexpectedly switch light and dark.
8. As a student, I want an independent accent choice, so that I can personalize emphasis without changing the entire palette.
9. As a student, I want semantic status meanings to survive accent changes, so that warnings and failures remain recognizable.
10. As a student, I want a live appearance preview, so that I can judge readability before settling on a choice.
11. As a student, I want appearance changes remembered immediately, so that I do not need to save an unrelated settings draft.
12. As a student, I want a reset appearance action, so that I can return to a known readable configuration.
13. As a student, I want comfortable and compact density choices, so that I can balance scanning speed and reading space.
14. As a student reopening the app, I want the chosen theme applied at first paint, so that startup does not flash the wrong appearance.
15. As an offline student, I want bundled fonts and themes, so that the interface needs no external asset request.
16. As a student, I want the main change feed called Inbox, so that its name accommodates unread changes from earlier days.
17. As a student, I want All and Unread filters, so that I can distinguish browsing from triage.
18. As a student, I want separate course and event-type filters, so that I can narrow attention without mixing different meanings.
19. As a student, I want an explicit announcements filter, so that important posts are easy to find.
20. As a student, I want repeated changes to the same resource summarized in one Inbox item, so that frequent edits do not overwhelm the feed.
21. As a student, I want complete recorded events retained in Activity, so that summary rows do not erase history.
22. As a student, I want to mark an item read or unread, so that I can manage attention reliably.
23. As a student, I want inspection and preview to preserve read state, so that browsing is not silently treated as acknowledgment.
24. As a student, I want bulk-read action scope stated explicitly, so that filtering cannot hide the operation's effect.
25. As a student, I want badge counts to describe the same units as the visible feed, so that I can trust the numbers.
26. As a first-run user, I want the baseline explained without existing files appearing as new, so that initial discovery is useful rather than alarming.
27. As a student, I want an Open Library action after baseline discovery, so that I can immediately find known material.
28. As a student, I want distinct loading, empty, filtered-empty, and failure states, so that I know what to do next.
29. As a student, I want a due-date agenda, so that I can see upcoming coursework without decoding activity dots.
30. As a student, I want deadlines sourced from actual due dates, so that notification detection time cannot masquerade as the deadline.
31. As a student, I want baseline resources with deadlines included in the agenda, so that existing assignments are not hidden.
32. As a student, I want exact dates and local times alongside relative labels, so that “tomorrow” is unambiguous.
33. As a student traveling between timezones, I want consistent date grouping, so that Inbox, Calendar, and details agree.
34. As a student, I want deadline changes to move agenda entries while retaining the earlier change record, so that the current date and its history stay distinct.
35. As a student, I want the existing activity calendar retained, so that I can explore changes by detection date.
36. As a student, I want past deadlines distinguished from confirmed incomplete work, so that the app does not invent submission status.
37. As a student, I want stable course navigation and aliases preserved, so that I can develop reliable navigation habits.
38. As a student, I want paused courses to remain locatable, so that pausing monitoring does not hide my material.
39. As a student, I want readable course names and supporting codes, so that I can recognize subjects without memorizing LMS naming conventions.
40. As a student, I want course material organized by its existing sections, so that the app reflects the structure I know from Quanta.
41. As a student searching a course, I want matching material presented clearly with its section context, so that a search result remains understandable.
42. As a student returning from details, I want my filters, expansion, selection, and scroll position preserved, so that inspection does not interrupt browsing.
43. As a student, I want the same inspector from Inbox, Library, Calendar, and Activity, so that I learn one material interaction.
44. As a student inspecting an older event, I want its recorded metadata available even when its resource is gone, so that history remains useful.
45. As a student, I want Preview, Open saved copy, Download and open, and Open in Quanta to have distinct meanings, so that I can predict the destination.
46. As an offline student, I want saved material to remain usable when its Quanta source is unavailable, so that I can continue studying.
47. As a student downloading material, I want progress and retryable failure feedback, so that I know whether opening is pending or failed.
48. As a student, I want unsupported or oversized previews explained neutrally with a fallback, so that a format limit is not mistaken for a broken account.
49. As a student searching globally, I want relevant metadata matches and access to all matches, so that a small palette result limit does not hide my file.
50. As a keyboard user, I want consistent shortcut hints and reachable material actions, so that pointer interaction is unnecessary.
51. As a keyboard user, I want predictable Escape handling and focus return, so that nested surfaces do not lose my place.
52. As a touch or coarse-pointer user, I want important actions discoverable without hovering, so that I can use the same features.
53. As a low-vision user, I want readable text, control boundaries, focus, and zoom behavior in every theme, so that customization does not reduce accessibility.
54. As a user of reduced motion or forced colors, I want meaningful static and high-visibility states, so that the app respects my accessibility preferences.
55. As a student changing operational settings, I want draft validation, save progress, failure recovery, and navigation protection preserved, so that changes cannot be silently lost.
56. As a student, I want notifications, storage, and integrations organized into focused settings sections, so that maintenance controls do not crowd everyday preferences.
57. As a student, I want preview cache and saved files explained separately, so that I understand what clearing or deleting each one does.
58. As a student, I want scan health separate from download progress, so that successful checking is not mistaken for completed downloads.
59. As a student with an expired session, I want an actionable reconnect message while keeping stored material accessible, so that recovery does not block studying.
60. As a student, I want normal background monitoring to remain quiet, so that persistent animation does not demand unnecessary attention.
61. As a student clearing the Inbox, I want dismissal separated from permanent history deletion, so that I cannot accidentally erase the audit trail.
62. As a privacy-conscious student, I want appearance and coursework to stay local without analytics or cloud accounts, so that the overhaul preserves the product's privacy model.

## Implementation Decisions

### Baseline, precedence, and scope

- Use the merged version 0.3.0 workspace as the implementation foundation. The original audit examined the older parent checkout; its claims about serif typography, bounded working lists, no-op Calendar/History detail actions, unstable course ordering, palette shortcut hints, and unguarded Settings navigation are historical findings, not an instruction to rebuild already completed fixes.
- Preserve the existing shared details lifecycle, stale-result protection, keyboard/editable-target guards, Settings draft protection, stable course ordering, and distinction between baseline, no matches, and refresh errors. Extend their acceptance coverage for the new workflows.
- This specification supersedes the previous single near-black/violet palette decision and the prior exclusions of named themes, an agenda, and state-changing read commands. Earlier implementation acceptance remains historical evidence; it does not verify this feature.
- Preserve the Rust shell, React interface, local SQLite storage, Tauri command boundary, bundled fonts, existing notification and Telegram capabilities, source scraping, native window behavior, and two-scan unavailable threshold. No authentication algorithm or scanner redesign belongs to the UI feature.
- Pending session-expiry recovery work is integrated into the starting baseline separately from this feature. Its existence is not evidence that the new UI is implemented.

### Appearance preferences and persistence

- The appearance preference contains a schema version, mode, palette identity, accent identity, and density. Mode is System, Light, or Dark. Palette is T3 Neutral, Soft Graphite, Slate, Ocean, Forest, or Iris. Accent is Palette default, Blue, Violet, Teal, Rose, or Amber. Density is Comfortable or Compact.
- Fresh or invalid preferences resolve to System mode, Soft Graphite, Palette default accent, and Comfortable density. Preserve a valid legacy mode when migrating. Persist the versioned preference as one local record; support the previous mode-only record as a read fallback until migration succeeds.
- Keep preference reading, migration, validation, and resolved-token selection in one pure appearance model. Both first-paint startup and the React theme owner use that model. Only the theme owner subscribes to OS mode changes; explicit Light or Dark ignores subsequent OS preference changes.
- Invalid fields fall back independently. Unknown future versions must not be overwritten automatically; run with safe defaults and retain the unreadable original for possible recovery. Unavailable persistence must not crash the app or prevent in-memory theme changes; show a quiet explanation that appearance cannot be remembered when a user attempts to change it.
- Mode, palette, accent, and density are independent. Selecting a palette cannot force mode, reset density, or overwrite the chosen accent. Selecting Palette default follows that family's calibrated accent pair. Reset appearance changes only appearance preferences.
- Appearance applies immediately and persists after a successful control selection. There is no hover-only theme application. Preview cards are labeled examples, not production account data. Appearance does not mark the operational Settings draft dirty and must not discard or save that draft.
- The existing quick theme shortcut switches the effective light/dark mode while preserving palette, accent, and density. This sets an explicit mode; the appearance popover and Settings always expose Follow system to restore System. Its label must identify the resulting mode rather than promise to change palette.
- Follow system affects appearance mode only. Fonts and all shipped palette values remain bundled; there is no runtime theme download.

### Palette and semantic tokens

- T3 Neutral uses upstream T3 Code's neutral colors as the reference, mapped into the app's semantic roles. The other families are Quanta Pulse adaptations, not claims to reproduce upstream presets. Soft Graphite is recommended because the user explicitly requested reduced harshness.
- Each family supplies a complete independently authored light and dark token set: workspace, sidebar, raised and floating surfaces, primary/secondary/tertiary text, borders and strong control outlines, hover, selection, links, focus, disabled states, and foreground-on-fill. Accent presets provide calibrated mode-specific fills, foregrounds, links, focus, and restrained tints. Never mechanically invert a palette or reuse a light accent as dark-theme body text without checking contrast.
- These palette anchors define the intended character. Supporting values may be adjusted to pass acceptance, with any visible change recorded in the implementation review.

| Palette | Dark canvas | Light canvas | Default dark accent |
| --- | --- | --- | --- |
| T3 Neutral | #0A0A0A | #FCFCFC | #346BF1 |
| Soft Graphite | #18191B | #F7F8FA | #86A9FF |
| Slate | #1A1D23 | #F5F7FA | #9FB4D8 |
| Ocean | #171D24 | #F4F8FB | #82B9DC |
| Forest | #191E1B | #F5F8F5 | #94B99E |
| Iris | #1D1A23 | #F8F6FB | #B7A4E1 |

- Soft Graphite dark uses sidebar #151618, raised surface #202125, primary text #E6E7EA, and secondary text #A1A4AC. A light accent fill uses a suitably dark text color. T3 Neutral reference text and fill values can differ; contrast determines the foreground.
- Semantic state remains independent of accent. Amber indicates warnings or approaching dates; red indicates a failure needing intervention. A past due date is not proof of non-submission. Source unavailability and unsupported previews are not automatically critical failures.
- Prefer neutral file icons, small course dots, textual change descriptions, and one selected-row treatment. Do not remove icon/text reinforcement or recolor every status to the selected accent. Keep course identities stable across themes and sessions.
- Extend the existing token layers and retain aliases while component consumers migrate. Use explicit colors compatible with the documented minimum webview. Do not require newer CSS primitives or add another styling framework to implement palettes.

### Typography, density, layout, and motion

- Keep bundled Geist Variable for all UI text. Use page titles at 24/32, weight 600; section titles at 16/24, weight 600; main row text at 14/20; secondary text at 12–13/18. Geist Mono is reserved for technical paths and identifiers; normal timestamps/counts use tabular numerals in the UI face. Respect text zoom without fixed-height clipping.
- Use the established 4px spacing scale. Sidebar target is 232–240px, rail 56px, topbar 44–48px, desktop content padding 24–32px, and narrow padding 16px. Retain native titlebar and macOS traffic-light allowances.
- Comfortable single-line row minimum is 44px; Compact is 36px. A narrow row can become two lines in either density and grow as needed. Density cannot remove accessible hit areas or truncate essential actions. Use approximately 6px control corners and 10px floating-panel corners; list rows do not receive individual shadows.
- Working views use available width. Reading/explanatory copy stays around 65–75 characters and operational Settings remains bounded. Align titles and metadata consistently across a list; right-align numeric values and times where useful.
- Maintain one inspector, approximately 360–420px on sufficiently wide layouts. Dock it only when at least 520px of useful list width remains after navigation, gutters, and inspector. Below that use an explicitly closable overlay; at very narrow effective widths use a full detail surface. Base this on available work-column width, not only the outer window breakpoint.
- Every user-initiated surface change may use a 120–180ms transition. Do not animate every arriving row or pulse while healthy and idle. Honor reduced motion and forced colors. Focus, selection, and disabled states remain distinguishable without color alone.

### Navigation and Inbox

- Use visible destinations Inbox, Calendar, Library, History, and Settings. Keep History as a secondary navigation destination so the existing audit trail remains easy to discover; it contains Activity and Scan history. Settings may move to the sidebar footer. Existing route identifiers and tray messages remain compatible: legacy Today/dashboard events open Inbox rather than falling into an unknown-route state.
- Put the attention badge on Inbox. Course badges use the same attention units scoped to the course. Preserve stable course ordering, aliases, paused-course access, and the All courses entry. Pinning, manual course reordering, and a new favorites model are deferred.
- Define an Inbox item as one surviving resource with relevant recorded changes, or one orphan historical event when no resource identity exists. Several events for one resource produce one item. Use the latest detection timestamp to order change activity; retain actual source upload/modified dates in details with honest labels.
- The global and course badge counts represent unread Inbox items, not raw events or a mislabeled new-file count. An item is unread when at least one event in its attention group is unread. Display the group's number of updates if useful; do not present that event count as a number of files.
- All/Unread is an attention filter. Course, type, and search remain separate dimensions. Event types include new files, updates, announcements, deadlines, and unavailable/restored changes as supported by stored events. Announcements have a distinct choice. Active filters have a visible clear/reset action.
- Opening details, previewing, and opening material do not change attention state implicitly. Mark read/unread is explicit. Marking a grouped item read or unread updates the underlying event IDs represented by that item's current attention group, then refreshes counts consistently.
- With active filters, label bulk action Mark filtered results read and apply it to the complete matching attention set, including matches beyond the loaded page. Without filters, label Mark all Inbox items read. Capture the operation's ID scope at activation; changes arriving later remain unread. Disable duplicate submission, retain data on failure, and report failure without claiming success.
- Due soon is a compact separate section sourced from the agenda. It does not count as unread activity merely because a baseline resource has a future due date. Show at most the next five entries due within seven local calendar days and a View agenda action for the rest. Hide this section when no due dates qualify.
- Preserve a quiet initial baseline. Show progress only when known, a clear discovery state otherwise, and a completion message explaining that existing resources are in Library. An empty Inbox after baseline is a valid success state; failed discovery is not.
- Distinguish loading, no courses, baseline complete/no changes, no unread changes, filter no matches, retained data with refresh failure, and unavailable connection. Each state has the appropriate next action, such as Open Library, Clear filters, Retry, or Reconnect.

### Read-state and collection contracts

- Add an explicit event read-state operation accepting unique event IDs and a desired boolean state. Existing mark-read callers remain compatible. The backend validates inputs, performs one atomic update, treats already-matching rows and missing historical IDs idempotently, and uses bound SQL parameters. The frontend's only command bridge continues to own invocation; handlers remain registered in the shell's authoritative command list.
- The persisted event read column already exists; no new read-state column is required. Keep wire names camelCase on both sides. Never implement Mark unread as a mark-read alias or direct component database write.
- Existing capped resource/event arrays are not automatically the full Inbox or agenda. Provide paginated local queries with deterministic ordering and total counts where the existing API cannot supply a complete result. The shared query/filter semantics used for listing, badges, and bulk targeting must agree. A truncated result cannot silently drive an “all” action or global badge.
- Inbox grouping and filtering have pure, deterministic selectors for test fixtures. For larger persisted datasets, server-owned matching/counting must preserve those semantics. Bulk read captures complete matching IDs before mutation; if that snapshot cannot be obtained, the action fails visibly rather than marking a guessed subset.
- Reading, grouping, and badge updates do not delete events, rewrite baseline records, or change scan-diff detection. Backend changes for this feature are bounded to explicit user state operations and complete local querying.

### Due-date agenda and activity calendar

- Calendar defaults to Agenda and offers Activity calendar as a clearly labeled alternative. Retain current month navigation, keyboard navigation, per-day activity, and recorded scan diagnostics in the activity mode.
- Agenda reads stored resource due dates independently of detection events, baseline status, and Inbox dismissal. Query the complete matching local resource set, not only dashboard resources or a capped page. Default to monitored courses; an explicit course filter can include a paused course and must label it paused.
- Group agenda entries into Past due dates, Today, Tomorrow, This week, and Later. Past due dates are collapsed by default and paginated. This week uses the existing Monday-first calendar convention after excluding Today/Tomorrow. Items sort by actual due instant/date, then readable course/title and stable identity. Deduplicate canonical resource identities; do not merge unrelated assignments merely because titles match.
- Use the configured valid IANA timezone consistently for date grouping and labels, falling back to OS timezone and then UTC if necessary. Preserve stored RFC 3339 timestamps. Compare absolute instants where supplied; do not compare formatted strings. All date selectors accept a controlled current time and timezone so midnight/DST behavior is testable.
- Timestamp deadlines show a relative day plus exact local date, time, and timezone context. If a source date has no trustworthy time, show the date without inventing a submission time. Invalid or unavailable due dates are omitted from the agenda and remain explicitly unavailable in details; no detection timestamp substitutes for a due date.
- A changed due date updates the current agenda entry after refresh while the previous recorded event stays in History. Source-unavailable items retain known dates with a source warning; saved files remain accessible where present. Do not infer completed, submitted, unsubmitted, or overdue coursework from the clock alone. Use Past due date with a link to confirm status in Quanta.
- A selected agenda item opens shared resource details with its due-date context. A selected activity event opens its recorded-event details, including orphan events. Selection survives a background refresh if identity remains valid and clears with a sensible focus fallback when no longer present.
- An agenda refresh failure retains a prior successful snapshot and labels it stale. Initial load failure is not an empty agenda. Only one request result for the active filter/range can become authoritative; late responses cannot overwrite newer navigation.

### Library, course pages, inspector, and actions

- Preserve Courses and All files as Library views, and use Materials and Activity within a course. Retain section hierarchy, explicit folder expansion, aliases, metadata search, filtering, sorting, keyboard access, and virtualization. Search results show section context rather than falsely appearing as a new folder structure.
- During the current application session, preserve query, sort, filters, section expansion, and scroll when moving into course details and returning. Key remembered state by route/course/view identity. Background refresh may update material without resetting user navigation. Do not restore a selected item that was actually removed.
- Use one shell-owned details identity for resources, recorded events, and scans. Reuse the existing adapters and lifecycle. Opening details does not open a browser. History without a surviving resource still shows recorded metadata and truthful recorded links; do not fabricate a downloadable resource.
- The inspector presents title/course/section, preview capability, source/change/due-date facts, local availability, and primary/secondary actions. Technical path, size, and raw error details can expand on demand. Do not show conflicting duplicate primary actions.
- Define one action policy from resource identity/type, valid URLs, preview capability, source status, and local status. Every view, palette result, inspector, and context menu uses that policy. Resolve local availability through the same provider used by the shared inspector; ignore stale asynchronous lookups after selection changes.
- Preview opens supported material in the existing in-app preview surface and can expand for reading. Open saved copy opens the existing local file. Download and open uses the local download/open operation, disables duplicate activation while pending, and reports download failures without claiming that a file opened. Open in Quanta explicitly opens the recorded source page, or a known valid resource URL when no page exists. Never guess a URL or offer a local action for an external-only link.
- Missing source and missing local copy are separate facts. An unavailable source can coexist with an openable saved file. A stale local record whose file no longer exists reports the missing copy and offers redownload only when supported. Network/auth failures, unsupported formats, and preview size limits receive distinct explanations and valid fallbacks.
- Always expose overflow actions. Secondary preview/open shortcuts may appear on hover/focus but remain visible for coarse pointers. Native semantic tables keep an accessible title activation control rather than a click-only row. Tree and calendar navigation retain their established semantics.

### Search, settings, recovery, and data operations

- Global palette search remains local metadata search over title, course, and section. Rank exact title matches before prefixes and broader substrings with deterministic tie-breaks. Show course/section and available local status, limit the short list to eight, and offer See all results that carries the query into the complete Library search. Do not imply full-text document indexing.
- File search results inspect material consistently; external opening remains an explicit action. Shortcut hints use canonical command identities regardless of filtering. Preserve editable-target guards and topmost-surface keyboard priority.
- Organize Settings into Appearance; Account & connection; Notifications; Files & storage; Integrations; Data & recovery; About. Keep a focused section navigation model with a usable narrow-layout fallback. Telegram remains in Integrations and retains its existing capabilities.
- Operational Settings preserves one validated draft, Save/Discard feedback, failed-save retention, and app-level dirty-navigation protection. Sidebar, courses, palette, hotkeys, back navigation, and tray navigation all pass through that protection. Appearance changes are independent. A failed Save blocks pending navigation; Stay cancels its intent even if a previous request later succeeds.
- Use Saved files folder instead of mirror root in normal copy. Explain preview cache separately from saved course material. Delete-local-files and reset-baseline controls state their exact effects and require confirmation. Do not imply that removing a preview cache deletes saved coursework or vice versa.
- Healthy monitoring uses quiet footer status and last-success time. Scan progress and download progress are separate; completing one does not declare the other complete. A failed course shows a recoverable course-specific status rather than labeling all monitoring failed.
- Session-expired UI retains stored material and offers one Reconnect action with a pending browser/sign-in state, cancel/retry behavior, and a clear recovery result. Do not claim reconnect success before the backend verifies the session. Preserve the baseline's scheduler pause and once-per-expiry notification behavior.
- Inbox clearing becomes dismissing its current visible attention items while preserving recorded history and resources. Scope the confirmation to the actual affected set. Persist a separate local dismissal ledger keyed by event identity; an event arriving later for the same resource can bring the item back. Add a reversible initialization migration for that ledger, with foreign-key cleanup when historical events are deliberately deleted. Baseline rebuilding and read-state mutations are independent of dismissal. No undo UI is required in this slice.
- Delete history is a separate explicitly destructive operation stating whether scan records and changes are both removed. Existing notification, preview, local download, update, and Telegram operations remain reachable. No action changes retention merely as a side effect of renaming a view.

### Acceptance criteria and delivery order

- AC1: All six palette families work in Light, Dark, and System; all six accent options and both densities can be selected independently, reset, and restored. Legacy mode survives migration and the first rendered frame agrees with the resolved preference.
- AC2: Text, focus, selection, hover, floating panels, input states, and text-on-accent remain readable in every authored combination. Essential controls survive narrow layouts, coarse pointers, reduced motion, forced colors, and 200% zoom.
- AC3: Inbox groups repeated resource events without deleting history; All/Unread/course/type/search, badges, and scoped bulk read agree across complete result sets. Mark read/unread survives refresh/relaunch and errors do not produce false success.
- AC4: Baseline items never flood Inbox. No-match, caught-up, loading, stale-data, initial failure, and expired-session states are distinguishable and actionable.
- AC5: Agenda uses due dates from the full tracked resource inventory, including baseline items; detection dates stay in Activity calendar. Timezone boundaries and date changes are correct. No submission-state claim is invented.
- AC6: Every supported list and palette result reaches one shared inspector. Focus return, late request protection, orphan event handling, local availability, explicit file destinations, and return context remain consistent.
- AC7: Appearance changes do not touch operational drafts. Dirty navigation, save retry, pending intent cancellation, and explicit destructive operations behave correctly from every route entry point.
- AC8: Inbox dismissal preserves History; new events reappear; permanent history deletion remains separately named and confirmed. Existing notifications, integrations, baseline/diff rules, and local-only ownership remain intact.
- AC9: Required frontend/backend gates pass on the assembled branch, and bounded rendered/native checks have evidence or are explicitly recorded as outstanding verification. No unavailable dependency or mocked result counts as a live-service pass.
- Deliver in bounded slices: appearance model/token migration and chooser; attention/query/read-state correctness and Inbox; agenda and explicit date semantics; shared action policy and navigation context; settings/recovery/data-operation organization; assembled accessibility and native acceptance. Existing behavior fixes are regression requirements, not a reason to reimplement the completed workspace.

## Testing Decisions

- The user approved app-level user flows backed by existing pure-logic tests and backend command tests where state changes. The primary seam is the real application DOM with mocked existing frontend API, Tauri event, and platform adapters. Extend the existing application-render fixture rather than create a parallel test harness or production abstraction only for testing.
- A good test exercises externally meaningful behavior: visible labels and state, chosen destination, active filter, persisted outcome after remount, data retained after a failure, focused element after dismissal, and exact operation scope. Avoid implementation snapshots, private state assertions, and one test per CSS declaration. Write behavior tests before wiring each new feature.
- Prior art includes the application Today-state, cross-view interaction, Calendar, History, Library, keyboard, and Settings suites; pure filter/event/date/summary/course-tree tests; preview/focus tests; settings-draft validation; semantic accessibility tests; and token contrast tests. Preserve the repository's timezone setup and existing regression expectations unless this spec explicitly changes the user-facing behavior.
- Appearance flows cover migration, reset, invalid individual fields, future schema versions, unavailable storage, in-memory operation, first-paint agreement, System media events, explicit mode immunity to media events, and changing appearance while operational settings are dirty. Pure preference resolution is the supporting seam; the application test proves controls reach it.
- Inbox flows cover multiple events sharing a resource, orphan events, unchanged baseline material, event type versus attention filters, announcements, grouped unread counts, per-item read/unread, duplicate activation, complete filtered bulk scope beyond one page, newly arriving events during a read operation, and mutation failure with truthful state recovery.
- Agenda flows cover baseline deadlines, absent/invalid/date-only values, past dates, midnight, month/year changes, DST and explicit timezone behavior, changed deadlines, paused course filters, source-unavailable items with saved copies, and inventories beyond existing fetch caps. Control the clock and timezone; do not encode today's real date into tests.
- Inspector/action flows cover every surface, recorded events without a resource, stale local lookups, source versus saved-copy availability, external-only links, actual download/open command invocation, missing disk files, retry, unsupported previews, focus return, Escape priority, route/filter removal, and preservation of scroll/filter/tree context.
- Settings/recovery flows retain existing failed-save and navigation-guard tests and add appearance isolation, section navigation, scoped dismissal, cache-versus-saved-file copy, reconnect pending/failure/success, and stored-data access during expiry. Backend session recovery tests remain regression gates rather than being replaced by optimistic UI mocks.
- Backend tests use existing command/database seams and temporary SQLite databases for atomic read/unread, complete matching/counting, stable pagination, dismissal migration and persistence, new-event reappearance, and history deletion cleanup. Use fixture HTTP discovery only for relevant authentication regressions; the UI overhaul introduces no new network test seam.
- Check every theme/accent pair automatically: six families, two resolved modes, six accents. Both densities require behavior/layout coverage but do not require duplicate color math. Measure ordinary text at least 4.5:1, qualifying large text at least 3:1, and meaningful focus/control indicators at least 3:1 where applicable. Include selected/hover/disabled and floating-surface contexts, not only base canvas. Decorative separators are not control boundaries.
- Existing jsdom accessibility checks do not measure rendered contrast or layout. Retain them as semantic gates and add rendered review at the 820×540 minimum, 960px, 1280px, and 1440px widths; 100% and 200% zoom; sidebar expanded/collapsed; inspector open/closed; both densities; long names; missing metadata; large datasets; and representative light/dark palettes. Automate complete token coverage and use a bounded representative rendered matrix rather than claiming exhaustive screenshots prove all states.
- Run lint, the full frontend tests, and the production build on the integrated feature. Backend changes require Cargo check for all targets and relevant Rust tests, including database migrations and state operations. Use the native development environment for Windows WebView2 and macOS WKWebView checks; do not run the packaged application during development.
- Native smoke includes password/SSO entry points, baseline completion, reconnect, PDF/media preview fallbacks, local file opening, explicit Quanta opening, offline stored material, and OS theme changes. Record platform/tool limitations accurately. A short student walkthrough should verify finding the next date, recognizing unread changes, locating a lecture, using a saved file offline, and recovering a session, without adding telemetry.

## Out of Scope

- A Notion block editor, document authoring, kanban/task management, custom dashboards, grade tracking, or invented submission/completion status.
- Cloud accounts, remote sync, collaboration, analytics, telemetry, AI summaries, or new third-party service dependencies.
- Arbitrary theme CSS, a theme marketplace, theme importing/exporting, an unrestricted color editor, full-text document indexing, or external font loading.
- New scraping capabilities to infer missing dates, a replacement authentication strategy, a new scheduler, notification feature expansion, or changed unavailable/baseline detection thresholds.
- Pinning/favorites, configurable table columns, user-defined saved views, bulk-download product features, free-form inspector resizing, broad dependency upgrades, or a new UI framework.
- Rebuilding the already accepted compact workspace, reproducing commercial branding assets, running a packaged build, creating installers, or releasing a new application version as part of writing this spec.

## Further Notes

- This specification follows the user's request for a detailed stored spec and the confirmed test seams. Publication uses GitHub Issues in Akshay-VK/quanta-pulse and the ready-for-agent triage state. No implementation tickets or delegation are created merely by publishing this parent spec.
- The existing workspace spec is issue #1, accepted and closed after its implementation. This feature is a follow-up with broader scope, not a reopening or relabeling of that completed issue. Its constraints on backend changes are superseded only for the bounded read/query/dismissal behavior explicitly described here.
- Code reconciliation baseline: merged main fb3fc9d885126fa0825af6bc8e410d6efbc7c9b7, which already contains the prior workspace redesign and version 0.3.0 preparation. The pending session-expiry fix was captured separately as b3fd2b7 before integrating that main baseline. Exact final integration SHA and verification results belong in the integration record.
- The previous proposal and interactive specimen remain historical design artifacts. The specimen uses illustrative data, does not persist appearance, and does not implement production file actions. Syntax/interaction smoke results do not verify native behavior or visual layout.
- The T3 Neutral anchors reference the [upstream T3 Code palette definitions](https://github.com/pingdotgg/t3code/blob/main/packages/shared/src/themePalettes.ts). The interaction direction draws on [Linear Inbox guidance](https://linear.app/docs/inbox) and [Notion database view guidance](https://www.notion.com/help/views-filters-and-sorts). These sources explain reference choices; the acceptance criteria in this document define Quanta Pulse behavior.
- Backend state operations and full-resource agenda completeness carry more integration risk than changing tokens. Keep them reviewable and preserve the existing model/API registration conventions. The user requested a clean merged baseline now, not immediate implementation of every requirement in this specification.

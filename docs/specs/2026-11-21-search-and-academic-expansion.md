# Unified desktop search and student academic tracking

Date: 2026-11-21. Status: test boundaries confirmed by the user on 2026-11-21; published as [GitHub issue #57](https://github.com/Akshay-VK/quanta-pulse/issues/57) with `ready-for-agent`. This specifies future work, not completed implementation or verified live Quanta coverage.

## Problem Statement

Students can browse course folders in the sidebar, but finding the same material through the command palette and Library produces different matching, scope, and ordering. Folder destinations are not searchable, quoted course names do not parse correctly, and expanding a palette query into Library can lose its meaning. Searching the contents of a saved document is a separate, currently unsupported workflow.

Pulse discovers assignment links and some course-card deadlines, but cannot explain a student's effective deadline, submission attempt, released grades, or attendance report. Students must repeatedly open Quanta to understand what requires action. Adding these records directly to the material scan would risk false changes, mixed student data, and optional report failures interrupting working material monitoring.

The existing research identifies failure paths in persistence, completeness, session publication, and migration backups. Its findings describe an older baseline and must be checked against the current implementation. Upstream Moodle feasibility is not proof of Quanta's installed configuration, student permissions, or safe unattended polling behavior.

## Solution

Deliver two independent tracks. First, make desktop metadata search consistent across the command palette and Library, with searchable course folders and explicit scopes. Second, strengthen the existing in-process collection and reconciliation boundaries, then introduce student-owned academic domains in order: assignments and Agenda enrichment, grades, and supported attendance reports.

Keep the local desktop architecture, existing sidebar folder navigation, material identities, retained files, and quiet first-run behavior. Show source coverage and freshness explicitly. A denied optional academic report must leave working material monitoring usable. No academic domain may collect unattended until its student source and polling policy are verified. Local file-content search is a later measured extension, independent of academic delivery.

## User Stories

1. As a student, I want to search across my courses and files from one entry point, so that I can find material without remembering its location.
2. As a student, I want folders to appear in search results, so that I can open a relevant collection directly.
3. As a student, I want folder results to identify their course and full path, so that identically named folders do not confuse me.
4. As a student, I want selecting a folder result to reveal its sidebar branch, so that I retain my navigation context.
5. As a student, I want Everywhere, Course, and Folder scopes, so that I control how widely I search.
6. As a student, I want Materials search to default to my selected folder, so that unrelated files do not obscure its contents.
7. As a student, I want course names, short names, and local aliases to match, so that I can use familiar terminology.
8. As a student, I want quoted multiword filters, so that a query such as `course:"ECOM F222" lecture 4` works.
9. As a student, I want several search terms to combine predictably, so that I can narrow a large inventory.
10. As a student, I want invalid filters to be explained, so that an incorrect query never silently broadens my results.
11. As a student, I want exact title matches to rank above incidental metadata matches, so that likely results appear first.
12. As a student, I want See all results to preserve my query and scope, so that Library continues the same search.
13. As a student, I want type, source-date, unread, saved, and deadline filters, so that I can identify the material I need.
14. As a student, I want deadline filters to use my configured timezone, so that results agree with Agenda.
15. As a keyboard user, I want to open a folder, inspect a file, and expand results without a mouse, so that search remains efficient.
16. As a student, I want an honest empty state for unmatched searches, so that I can distinguish no matches from a broken load.
17. As a student, I want consistent results during a background refresh, so that files do not disappear or repeat between pages.
18. As a student, I want metadata search to work offline without downloading anything, so that it stays fast and predictable.
19. As a student, I want a later option to search supported locally saved document contents, so that I can find text I remember from a file.
20. As a student, I want content matches to show a labeled snippet, so that I understand why a document matched.
21. As a student, I want materials and announcements to retain their current identities and History after the refactor, so that existing links and read state keep working.
22. As a student, I want failed scans to report failure truthfully, so that I do not trust changes that were never saved.
23. As a student, I want incomplete scans to preserve availability and pending baselines, so that transient failures do not create false removals or new-item floods.
24. As a student, I want each academic domain's first successful collection to be quiet, so that enabling it does not flood me with old records.
25. As a student, I want an inaccessible grades or attendance report to leave my materials available, so that optional features do not break core tracking.
26. As a student, I want freshness and source coverage beside academic data, so that I know whether it is current, partial, unavailable, or stale.
27. As a student, I want my academic records isolated from other accounts, so that switching accounts cannot show another student's data.
28. As a student, I want delayed work from a signed-out session rejected, so that old responses cannot repopulate my current workspace.
29. As a student, I want a recoverable backup before schema changes, so that a failed upgrade does not destroy my local state.
30. As a student, I want my effective assignment deadline, including visible overrides and extensions, so that I plan against the date that applies to me.
31. As a student, I want opening, due, cut-off, and grading dates distinguished, so that lateness is not confused with submission closure.
32. As a student, I want unknown, unsubmitted, draft, submitted, and reopened states distinguished, so that Pulse does not invent my progress.
33. As a team member, I want team submission and outstanding confirmation information when exposed, so that a teammate's upload is interpreted correctly.
34. As a student, I want an assignment represented once in Agenda, so that enrichment does not duplicate its existing deadline.
35. As a student, I want confirmed submitted work to stop routine action reminders, so that completed work does not distract me.
36. As a student, I want unknown or stale submission status to preserve deadline reminders, so that uncertainty does not hide required work.
37. As a student, I want to open the authoritative assignment page for submission, so that editing and submission remain in Quanta.
38. As a student, I want to see released assignment feedback, so that I can read what my instructor has made available.
39. As a student, I want course grades including manual items and categories, so that the view reflects the student grade report.
40. As a student, I want numeric, letter, scale, and text grades preserved, so that Pulse does not misrepresent the source.
41. As a student, I want hidden, unreleased, blank, unavailable, and zero grades distinguished when supported, so that missing information is not displayed as a failing mark.
42. As a student, I want Moodle's displayed category and course totals, so that hidden components and weighting are respected.
43. As a student, I want an old grade labeled stale after a transient failure, so that a failed refresh does not become a new zero.
44. As a student, I want a grade that becomes restricted removed from the current view, so that old visibility is not mistaken for current permission.
45. As a student, I want my supported attendance report separated by activity and date scope, so that lecture and lab records are not misleadingly combined.
46. As a student, I want custom attendance statuses and source-reported points, so that local course rules remain intact.
47. As a student, I want future, unrecorded, and explicitly absent sessions distinguished, so that missing records do not inflate absences.
48. As a student, I want the attendance report's own summary and denominator, so that a points percentage is not mistaken for a universal eligibility calculation.
49. As a student, I want unsupported attendance reported clearly with a source link, so that Pulse does not imply coverage it lacks.
50. As a student, I want academic values excluded from Telegram, generic diagnostics, and ordinary metadata search, so that adding tracking does not unexpectedly expose private information.
51. As a student, I want background collection constrained to verified read sources, so that Pulse does not submit work or mark attendance on my behalf.
52. As a student, I want paused courses, saved files, appearance, and keyboard behavior preserved, so that these additions do not undo the redesign.

## Implementation Decisions

### Existing behavior and architectural boundaries

- Retain Tauri, Rust collection, React presentation, and local SQLite. Add no server, account service, telemetry, browser automation runtime, generic repository layer, or runtime collector registry.
- Keep the scheduler and command surface as adapters. The coordinator owns admission, session generation, cancellation, progress, shared budgets, and sequencing. Concrete collectors own domain requests, parsing, enrichment, and interpretation. Reconciliation owns durable state changes, baselines, and change detection.
- Extract material and announcement collection first. Course inventory, traversal, identity normalization, body limits, and request budgeting remain shared where behavior is genuinely shared. Do not mechanically split parser files and call that the refactor.
- Preserve stable resource IDs, section paths, source-page attribution, monitored/paused courses, captured Inbox mutation scopes, History paging, retained mirror copies, preview-cache separation, and previous-version retention. Preserve the two-complete-scan material missing threshold. Academic domains do not inherit that absence policy.
- Preserve the approved 5/10/15/30/60-minute monitoring choices and hourly default. The scheduler tick remains a due-time check, not a scraping interval. Academic requests share the existing bounded scan budget; unresolved domains remain disabled rather than silently raising request volume.
- Keep one frontend invocation boundary with registered Rust commands and matching camelCase TypeScript contracts. Keep the intentional material-action execution owner. Grade and attendance records must never acquire file download or preview actions merely by reusing a material adapter.

### Desktop metadata search contract

- Introduce one pure desktop query/matching/ranking policy consumed by the command palette and Library. Views render results and invoke existing navigation/actions; they do not implement separate matching algorithms. Telegram retains its existing metadata search behavior in this scope.
- Query state contains raw text, parsed terms, validated filters, explicit scope, and destination identities. Scopes are Everywhere, a stable course ID, or a stable course ID plus exact normalized folder path segments. Folder scope includes descendants. The global palette starts Everywhere; a course Materials search starts at the selected folder, or course scope at its root. Scope is visible and changeable.
- Index metadata already held locally: canonical course name, short name, local alias, folder segments/path, resource title, and resource type. Derive folders from current inventory paths without another Quanta request. A folder destination uses course ID plus path, never its display label alone.
- Support quoted values and literal punctuation, including multiword course aliases. Whitespace separates free terms, all of which must match; quoted free text is a phrase. Support escaping quotes and backslashes within quotes. Unclosed quotes and known invalid values produce a visible query error and no results. Unknown filter keys remain visibly unsupported and cannot silently drop constraints.
- Repeated values within course or type are alternatives; distinct filter dimensions intersect. Course filters intersect explicit scope. Read/unread and saved/unsaved are separate dimensions; requesting both mutually exclusive states in one dimension is invalid. Tokens and filter controls use the same normalized state.
- Retain existing `course:`, `type:`, `is:`, and `due:` vocabulary. Add a folder scope control and source-date range controls; additional textual date/folder syntax is unnecessary for the first release. Source-date ranges use the existing material activity timestamp policy, display that meaning, and exclude unknown dates only while a date filter is active. Inclusive selected calendar dates resolve to a half-open instant range in the configured timezone.
- Deadline filters retain the distinction between date-only and instant values and reuse Agenda's configured-timezone policy. Invalid dates do not match deadline ranges; `due:none` means no usable deadline. Submission tracking must not silently change the meaning of metadata deadline filters.
- Rank file matches by exact title, title prefix, all terms in title, then path/course/type metadata. Break ties by the existing source/activity timestamp descending, unknown dates last, then stable ID. Course/folder groups use the corresponding exact-name/prefix/term order and stable destination tie-breakers. Highlight literal matches safely without injecting HTML.
- Type, saved/unread, date, and due filters constrain file results. Under those filters, show a course/folder navigation hit only if its scope contains matching files; unfiltered queries may match course/folder metadata directly. App commands stay a separate palette group and never masquerade as file results.
- Empty Library queries list the complete selected scope under active filters. An empty palette preserves its existing navigation/command affordances. A nonempty query with no matches remains empty. Clearing filters never changes the selected course or folder implicitly.
- See all results transfers the normalized query, scope, and all filters into Library. Its file order must match the corresponding palette results against the same inventory revision. Explicit user-selected Library sorting may override relevance and must be visible. Repeating the same palette query after editing Library reapplies the query.
- Selecting a folder expands its ancestors, selects it, and shows its materials. File results use the existing shared inspection and open actions. Navigation uses stable identities through local renames; missing destinations show an honest unavailable state instead of redirecting to a different course. Preserve keyboard selection, Escape dismissal, focus return, drawer behavior, and independently expanded sidebar courses.
- Queries perform no network requests or automatic downloads. If large result sets are paged, use a revision-bound query snapshot or a bounded restart on revision change; request generation alone is insufficient. Concurrent writes must not publish duplicated/skipped rows as a complete fresh result. Preserve previously successful results with a visible refresh error where appropriate.

### Optional local-content search

- Complete metadata delivery and measure representative 5k, 25k, and 100k inventories before committing to a content index. Record input-to-result p50/p95, inventory derivation cost, memory, database lock time, machine/platform, and cold/warm conditions. Set the supported-size latency budget from those measurements before enabling content search; no unmeasured performance promise is accepted.
- Prototype a rebuildable SQLite FTS5 index for supported text and text-layer PDFs already saved locally. Reuse safe local extraction where supported; verify extraction availability on each shipped platform rather than assuming PDF preview text extraction is a backend indexer.
- Index by resource identity, local content hash, and extraction version. Process bounded batches outside the UI and avoid holding the shared database lock during extraction. Enforce documented size/time limits and cancellation. Search never downloads files to satisfy a query.
- Label body matches and show escaped snippets. Metadata results remain available when extraction/indexing fails. Replacement, removal, cache eviction, and explicit local deletion invalidate affected indexed content; rebuilding recovers without modifying authoritative resource records or creating material change events.
- Publish a supported-format/platform matrix. OCR, network-side indexing, historical-version indexing, academic values, and Telegram content search are excluded. This stage is gated follow-up work rather than a prerequisite for assignments.

### Correctness before extraction

- Reproduce audit findings against the current revision and add failing regressions before behavior fixes. Separate those fixes from structural moves. Do not reimplement already accepted History pagination, bounded course colors, or reset-generation guards.
- Treat authoritative database read/write failures as errors, not empty collections or successful mutations. Resource, event, miss, baseline, and scan-result persistence must yield an explicit committed outcome. Never clear failure state, consume baseline/reset markers, dispatch notifications, or enqueue new mirror effects for an uncommitted scope.
- Keep the inventory, derived events, eligible miss updates, baseline decisions, and successful scope outcome atomically consistent. If a scope rolls back, its last successful snapshot and pending baseline remain intact. Successful independent scopes may commit, but the overall run reports partial coverage and only committed scopes produce effects. Do not claim crash-proof exactly-once delivery from post-commit dispatch alone.
- Represent coverage structurally per course and domain, including complete, partial, denied, unsupported, offline, cancelled, and failure reasons. Fresh/stale is derived from the last permissible successful snapshot and current attempt, not a competing synonym for completeness. Resource/page/detail caps, task join failure, parse mismatch, truncation, and cancellation cannot become complete absence.
- Preserve a quiet baseline until a complete scope commits. Repeated global/course reset requests that arrive during a scan remain pending according to their captured generations. Missing streaks advance only for a completely observed, successfully reconciled eligible material scope.
- Publish the fully verified session facts in the active HTTP client, including Moodle user identity and current session metadata, for password and SSO flows. Keep existing SSO attempt ownership and cancellation fences.
- Replace lexical application-version backup decisions with explicit schema revisions and semantic application-version handling where needed. Back up a populated legacy store before a pending migration; abort without modifying it if backup fails. Define same-version, unknown legacy, prerelease, and newer-schema startup behavior. A newer unsupported schema must not be migrated backward silently.

### Student ownership, storage, and request policy

- Support one active verified student at a time. Namespace academic records and baselines by official origin plus verified Moodle user ID, not email/display name. Separate retained academic partitions may exist internally, but no simultaneous multi-account UI is required. Reads require the active matching verified owner; logout and switching hide academic records immediately. Offline access may continue within an established matching active session, not by bypassing sign-in after an account switch.
- Advance a session/work generation on logout, reset, and account replacement; cancel/drain affected work and reject late responses at persistence, event publication, and frontend application. A previous student's result must not become visible or mutate the next student's academic baseline. Expiry parks collection; a successful reconnect for the same owner restores its own partition. Do not retroactively assign legacy unowned academic data to the next login.
- Use additive versioned tables for assignment observations, grade items/categories, attendance report snapshots or stable sessions, coverage, domain baselines, and necessary source relationships. Reuse course identity and reference an existing assignment resource where appropriate. Keep course-module, activity-instance, grade-item, calendar-event, attendance-instance, and attendance-session IDs distinct.
- Store source display values with normalized facts, provenance, observation time, last successful time, coverage, and supported visibility state. Store instants as RFC 3339 UTC; retain date-only and ambiguous source values distinctly. Never infer UTC/IST from an unqualified localized string. Avoid raw authenticated HTML retention; sanitize any released feedback before presentation.
- Each student/course/domain has its own first-success baseline and deduplicated subsequent changes. Failed/partial coverage must not consume a baseline or overwrite a valid snapshot with empty truth. Committed internal changes refresh the relevant domain; this specification adds no detailed academic notifications or generic History/Inbox feed of private values.
- Keep private grades, feedback, attendance values, and submission details out of general diagnostics, generic notifications, Telegram, and metadata/content search. Preserve existing deadline reminders under the assignment-specific rules below. No academic export or encryption-at-rest claim is introduced.
- Add purpose-aware response interpretation around the existing HTTP transport. Distinguish optional report denial from confirmed login expiry using verified responses. Preserve existing material expiry behavior until regression fixtures justify a specific change. A report 403 alone must not mark every domain expired.
- Bound response bytes, decoded bodies, redirects, timeout, concurrency, traversal, and detail requests. Validate academic routes and final origin. Do not globally break legitimate existing material download redirects. Avoid buffering binary downloads through the HTML detail path.
- Permit only verified current-student report reads. Omit other-student parameters on HTML self reports; when a verified structured service requires an explicit self ID, use the verified owner. Do not treat every `userid=0` as self: its meaning differs between routes/functions.
- Authenticated HTML is the initial candidate transport. Cookie-session AJAX is allowed only for functions explicitly supported by the installed service and student permissions. Mobile/token service membership and a `read` declaration are not AJAX eligibility or a guarantee of no effects. Calendar action events can supplement discovery but never prove complete assignment absence or submission state.

### Assignment behavior and presentation

- Extend existing assignment discovery with a dedicated student assignment observation. Preserve source assignment/resource relationships; do not infer assignments from a PDF title, quiz, external tool, or spreadsheet.
- Collect supported description/reference attachments, base/effective dates, extension, submission status, team/attempt context, grading status, and released feedback. Opening, due, cut-off, grading due, and time limit are separate optional facts. Missing or unsupported fields remain unknown; an explicit no-date setting is distinct.
- Prefer the source's effective personal deadline and visible extension handling. Preserve provenance and label a base-only date accordingly. Do not implement a blanket maximum-across-groups rule or infer a cut-off that student HTML does not expose.
- Normalize explicit unknown, unsubmitted, draft, submitted, and reopened states; support not-required/not-yet-open only when exposed. Preserve team submission, pending member confirmations, and attempt context without retaining unnecessary roster identities. `graded` alone is not permission to expose feedback or proof of final submission.
- Enrich existing Agenda rows by stable assignment/resource identity, replacing their deadline projection rather than appending a duplicate. Keep nonassignment deadlines and baseline deadlines visible. Updating assignment metadata must not automatically mark an Inbox item read or rewrite historical events.
- Suppress routine action reminders only for a current, confirmed final submission with no outstanding team confirmation. Draft, reopened, unknown, or stale submission status does not suppress existing reminders. New attempts/deadline changes use stable deduplication so stale reminder keys neither suppress new required action nor cause repeated alerts each scan.
- Show submission/deadline facts in Agenda details and the assignment inspector. Keep the canonical Quanta source action available. Attachments retain ordinary material behavior; the assignment status record does not become a downloadable file. Opening/submitting/editing work remains in Quanta.

### Grades behavior and presentation

- Collect the current student's course user report when available. Use semantic headers and stable grade-item/source identity, not fixed column offsets or title joins. Include visible manual items, categories, feedback, and reported course/category totals even when no assignment resource exists.
- Preserve numeric, scale, letter, and text display values, optional range/weight/percentage, and source hierarchy. Assignment feedback and gradebook values remain related but separate observations. Do not calculate totals, SGPA, CGPA, or hidden contributions from visible marks.
- Distinguish visible zero from blank/ungraded, unreleased, hidden, denied, unsupported, and unknown only as far as evidence permits. An omitted row alone does not prove a mark was withdrawn or hidden. A confirmed restriction removes old values from the current presentation; transient failure can show the last permissible snapshot as stale. No private historical grade browser is added.
- Add a Grades tab within a course with a summary, visible hierarchy, details, freshness/coverage, and Open in Quanta action. Domain loading/failure is independent of Materials and Agenda. Create the tab only when the domain is implemented; unsupported courses explain the limit rather than showing a zero total.

### Attendance behavior and presentation

- Detect and validate the installed Attendance report per course/activity. Support only the student's own verified report, including its explicit filter range, group/course scope, and pagination. The default monthly page is never a complete term history.
- Keep multiple activities separate. Preserve source status labels, points/max points, remarks when appropriate, and the report's own summary, denominator, and scope. Future, unrecorded, enrollment-boundary, and explicitly absent states remain distinct. Do not assume a universal status alphabet, duration weighting, excused policy, or 75% eligibility threshold.
- Use stable session identity only when the read source exposes it reliably. If it does not, store scoped snapshots/summaries and display rows without promising stable per-session history or change alerts. Do not fabricate identities from mutable date/description text or fetch marking links to obtain IDs.
- Add an Attendance tab within a course with activity and source-supported date-range selection, session rows or snapshot summary, coverage/freshness, and Open in Quanta. An attendance-related grade without session data stays a grade, not reconstructed attendance history.
- Exclude self-marking, QR/password flows, attendance-taking/editing routes, staff session/roster APIs, and the Attendance mobile view callback from collector capabilities. Some of these can write on a view request. Ordinary views may still generate logs/completion used by automation; unresolved deployed behavior blocks unattended collection.

### Delivery phases and acceptance gates

| Phase | Depends on | Deliverable and completion condition |
| --- | --- | --- |
| P0: Current-state proof | None | Reconcile the older audit with the current revision; reproduce remaining persistence/completeness/session/backup cases and record already fixed findings. Establish fixture parity for existing materials/announcements and protect the pending sidebar work. |
| S1: Search grammar, scopes, and folder destinations | Existing sidebar tree | Implement shared query policy, quoted values, stable folder hits, and scope navigation. A folder with the same path in another course cannot be opened accidentally; queries produce explicit errors/empty states without network reads. |
| S2: Unified results and filters | S1 | Palette and Library share filtered file order, stable complete-query behavior, and preserved See all state. Pass keyboard, timezone, alias, duplicate-title, refresh-race, and large-inventory checks. S1/S2 can ship without academic work. |
| R1: Correctness repairs | P0 | Failure injection proves no false scan success, baseline consumption, absence, or effects after failed persistence. Session publication and migration backup/restore regressions pass. Keep repairs reviewable separately from extraction. |
| R2: Collection and reconciliation extraction | R1 | Concrete material/announcement collectors plus committed reconciliation preserve existing HTTP requests, identities, paths, diffs, baselines, History/read state, and material actions. Partial/cancelled collection cannot advance absence. |
| V1: Quanta source validation | Can proceed alongside R1/R2 with separately authorized access | Produce a sanitized capability/route matrix for actual version/theme/locale/timezone, student permissions, ID joins, paging, budgets, and polling effects. Unknown domains remain disabled; no credentials/raw student pages enter repository fixtures. |
| A0: Academic foundation | R2; R1 session/migration repairs | Owner-scoped storage, generation fencing, independent coverage/baselines/read contracts, domain query authority, backup/restore, and privacy exclusions pass. Synthetic collectors may be used before live access; unattended collection remains gated by V1. |
| A1: Assignments and Agenda | A0 plus V1 assignment evidence | Student-effective deadlines and supported submission/attempt/team states render once in Agenda/details. Quiet rollout, reminder rules, override/extension cases, unknown fields, and an authorized Pulse-versus-Quanta comparison pass. |
| G1: Student grades | A0, A1 integration stability, V1 grade evidence | Visible course user report renders with authoritative totals and independent errors; zero/blank/hidden/denied/manual/scale cases, baseline/restart/visibility loss, and authorized source comparison pass. |
| T1: Attendance | A0, G1 integration stability, V1 attendance evidence | Verified own report preserves activity/filter/denominator/status semantics; unsupported and weak-ID sources degrade honestly. All safety exclusions, partial pages, summary cases, and authorized source comparison pass. |
| S3: Local-content search | S2 measurements and supported extraction proof | Publish format/platform and benchmark results, prove replacement/removal/rebuild/fallback and bounded lock/extraction behavior, then enable the index. Not a blocker for A1/G1/T1. |

- This is a parent specification. After approval, implementation tickets should be bounded vertical slices with native sub-issue and blocker relationships, preserving the dependencies above. Do not label an unverified live integration as immediately shippable merely because its parent is ready for agent planning.
- Each slice stops at its acceptance condition. No whole-repository rewrite, unrelated audit hardening, wholesale UI redesign, or speculative domain scaffolding is required. Existing sidebar work is a dependency to preserve and verify, not a request to implement it again.
- Rollback first disables the new collector/view and retains compatible local data. Test old-binary tolerance before promising executable downgrade; restore the verified consistent backup when schema compatibility requires it. Baseline, ownership, and freshness must survive disable/re-enable and restart.

## Testing Decisions

Test externally observable requests, stored state, emitted outcomes, query results, and student interactions. Do not assert private helper call order, new file structure, or snapshots that merely mirror implementation. Use the highest existing behavior boundary that can prove a requirement; two existing boundaries are necessary because mocked UI bridge tests cannot prove real HTTP/transaction behavior.

1. **Desktop boundary: real App with the existing fake Tauri bridge.** Extend the established App keyboard, Library interaction, sidebar-tree, material-action, Agenda, and session-refresh tests. Drive search, scope changes, See all results, folder selection, inspection, and focus return through visible controls. Resolve deferred responses out of order and interleave sync/account changes. Assert the selected stable destination, visible rows/order, scoped filters, truthful errors, and independent material/academic publication. No new frontend adapter is needed.
2. **Backend boundary: production collection/reconciliation driven by loopback HTTP and real temporary SQLite.** Reuse the discovery/session-expiry fixture technique, attention database tests, baseline-generation regressions, database upgrade tests, and local mirror fixtures. Assert received routes, returned observations, committed rows, baseline/miss state, scan outcome, and effects eligible for dispatch. Introduce only a small callable collection-to-commit entry boundary if the Tauri adapter currently prevents this; do not build a fake repository framework. Use real SQLite constraints/triggers or narrow transaction fault injection for write/commit failure.
3. **Focused pure tests supplement those integration boundaries.** Extend parser/query/date/diff tests for quoted phrases/escapes, aliases, diacritics, literal punctuation, conflicting/unknown filters, ranking ties, date-only and DST/midnight boundaries, and explicit unknown/visible-zero domain semantics. Parser tests do not replace evidence that the collector calls the parser in production.
4. **Persistence and lifecycle matrix.** Force resource/event/commit failure, late reset, partial/truncated discovery, cancellation, task failure, complete empty scope, restart, and repeat scans. Observe no false absence or flood and no post-failure success/effects. Test A-login → logout → B-login with delayed A collection and frontend responses; reject old writes/publication and prevent B reading A's records. Reconnect the same owner without losing its baseline.
5. **Request-policy matrix.** Distinguish optional-report denial, real login redirects/expiry, unsupported layouts, server/offline failures, oversized/decompressed bodies, redirect escapes, and accidental binary HTML fetches. Preserve ordinary material expiry fixtures. Assert no submission/marking/mobile callback/staff route is requested, including when malicious or irrelevant links appear in report HTML.
6. **Academic fixture matrix.** Cover personal/group override precedence, extension, absent/zero/ambiguous dates, hidden cut-off, draft/submitted/reopened attempts, team confirmations, released feedback, manual/scale/hidden/zero grades, totals with hidden components, multiple attendance instances, custom status sets, partial time ranges/pages, no stable IDs, zero denominators, future/unrecorded sessions, and explicit restriction after previous visibility. Compare outputs to sanitized source facts, not invented arithmetic.
7. **Search completeness and performance.** Verify palette/Library parity against one inventory revision; interleave writes between backend pages and delayed frontend responses. Require a complete unique result or a bounded truthful restart/error. Benchmark metadata at 5k/25k/100k before S3; content tests use local files, replacement/removal/eviction, extraction failure, cancellation, and index rebuild. Observe that queries perform no downloads and private academic values never match.
8. **Migration and rollback.** Test populated legacy stores, 0.9-to-0.10 semantic version transitions, same-version startup, prereleases, unknown prior version, failed backup, failed migration, unsupported newer schema, restart idempotence, collector disable/re-enable, and restore from a consistent backup. Preserve resource IDs, read/dismissed state, saved files, versions, and reset markers.
9. **Integration gates.** Run frontend lint and tests after frontend changes, plus production build for the assembled slice. Run Rust check and relevant library tests after Rust changes, using the documented native Windows test runner where required. Add serialization and frontend bridge contract tests for changed wire payloads. Baseline green tests are not proof that the failure cases above passed.
10. **Live and native evidence.** Each enabled academic domain requires a separately authorized current-student comparison with Quanta and evidence for its polling policy, budgets, locale, coverage, and freshness. Use development/native smoke for the affected interactions; do not run a packaged app during development. Record unavailable platform/source coverage honestly. No live login, token acquisition, report access, or academic side-effect probe is authorized merely by publishing this spec.

Confirmed test boundaries: the user approved the existing real-App/fake-bridge boundary for desktop workflows and loopback-HTTP/temporary-SQLite boundary for backend behavior on 2026-11-21, with a narrowly extracted collection-to-commit entry point only where necessary.

## Out of Scope

- Reimplementing the completed sidebar tree, redesigning the entire shell, or changing established appearance/material interactions.
- Assignment submission/editing, attendance marking or QR/password automation, instructor tools, rosters, other students' reports, or privileged service access.
- Guaranteed attendance support in every course, custom institutional portals, spreadsheet/PDF personal-row extraction, quizzes, LTI/Turnitin adapters, eligibility predictions, SGPA/CGPA calculation, or reconstruction of hidden marks.
- New detailed academic notifications, Telegram academic forwarding, private academic search, and academic export. Existing material alerts and submission-aware deadline reminders remain in scope.
- Full multi-account workspace management, cloud storage/sync, new authentication services, at-rest encryption, or an OS keychain migration.
- A general event outbox/exactly-once delivery project, updater/release overhaul, complete audit remediation, global frontend state framework, generic plugin system, or new network process.
- OCR, automatic query-time downloads, indexing every preview automatically, and a commitment to ship local-content search before measurements and extraction proof.

## Further Notes

### Evidence and current-state limits

The architecture and academic research use repository baseline `1bd0e8b5a24b05733295b5751a7bc42de7b90b43`. Current source inspection for this specification uses commit [`26c7b5cefe82f6d75d0da802c1349a9cda4a801b`](https://github.com/Akshay-VK/quanta-pulse/commit/26c7b5cefe82f6d75d0da802c1349a9cda4a801b), plus the uncommitted sidebar-tree work in this checkout. The source check confirms whitespace-only palette tokenization, separate course filtering and Telegram search, the lexical backup comparison, verified facts applied to a session copy after client construction, and discovery-based finalization paths despite persistence errors. These are source observations, not newly executed failure reproductions.

Later code/wiki evidence already supplies generation-aware course/global reset handling, complete History query work, and the five-minute monitoring floor. Preserve those rather than applying the audit's historical proposals blindly. The sidebar thread reports 877 passing tests for its UI work; this planning task does not claim a fresh application test run or native acceptance.

Upstream research is pinned to Moodle commit `69ef83ad2948db19595106671f03a1429679c870` and Attendance commit `d4095c8a4613a3812246590c7db871404b91fd3b`. These establish candidate source semantics, not Quanta's deployed version. The source-validation milestone must explicitly record installed behavior before choosing production parsers/endpoints. If a source or polling effect remains unresolved, finish the synthetic/local work and keep that collector disabled; do not weaken the gate to claim completion.

### Research and durable contracts

- [Search and academic expansion outline](../research/2026-11-21-search-and-academic-expansion-plan.md).
- [Architecture audit and phased recommendation](../research/2026-11-15-codebase-architecture-audit.md), [backend audit](../research/2026-11-15-architecture/backend-audit.md), [frontend audit](../research/2026-11-15-architecture/frontend-audit.md), and [safety/operations audit](../research/2026-11-15-architecture/safety-audit.md).
- [Academic scraping feasibility](../research/2026-11-15-academic-scraping-expansion.md) and [pinned Moodle/Attendance source inventory](../research/2026-11-15-moodle-academic-data-sources.md).
- [Collection/refactor boundaries](../research/2026-11-15-architecture/refactor.mmd) and [academic collection boundaries](../research/2026-11-15-architecture/academic-expansion.mmd).
- [Attention and Agenda data contracts](../wiki/2026-11-14-attention-data-contracts.md), [baseline/reset acceptance](../wiki/2026-11-16-baseline-and-history-acceptance.md), [History read contract](../wiki/2026-11-16-history-read-contract.md), [version-retention compatibility](../wiki/2026-11-16-version-retention-compatibility.md), and [appearance/interval decisions](../wiki/2026-11-15-redesign-appearance-and-interval-approvals.md).
- [Redesign alignment evidence and native limits](../wiki/2026-11-20-redesign-reference-alignment.md) and [Windows native test command](../wiki/2026-11-16-windows-native-test-command.md).

Publication destination: GitHub Issues in `Akshay-VK/quanta-pulse`, as a parent specification labeled `ready-for-agent`, with test boundaries confirmed. Search matching issues before creating it, preserve existing labels if updating, and read back the published body and label. Implementation ticket creation and application changes are separate follow-up work.

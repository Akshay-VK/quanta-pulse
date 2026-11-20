# Expanding Quanta Pulse: assignments, grades, and attendance

Research date: 2026-11-15. Repository baseline: `1bd0e8b5a24b05733295b5751a7bc42de7b90b43`. This is feasibility research and a proposed direction, not an accepted implementation specification. No authenticated student pages were accessed, and no application behavior was changed.

## Findings

**Assignments are the lowest-risk expansion; grades are feasible when the student can see them; attendance is feasible when Quanta exposes a supported attendance activity or report.** All three can potentially use the existing Moodle session. A server-side integration or a browser automation runtime is not a prerequisite for the HTML approach.

This conclusion combines the current code with upstream Moodle behavior. It does **not** establish that every Quanta course publishes these records. The [public Quanta login page](https://quanta.bits-pilani.ac.in/login/index.php) identifies Moodle and offers password and BITS Gmail login, but does not establish the deployed Moodle version, installed attendance plugin version, mobile-service configuration, or student report permissions.

The recommended sequence is: validate a small set of signed-in pages; finish assignment collection; add student grades; add attendance behind capability detection. Keep assignments, grades, and attendance as separate observations, with independent freshness and successful-first-scan baselines.

## 1. What the app actually collects today

The following claims refer to the baseline commit above; links pin code to that commit.

- [Course parsing](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/quanta/parse.rs) already recognizes activity links. Assignment modules become `assignment` resources, and course-card date blocks can supply `due_at`. A fixture includes `/mod/attendance/view.php?id=1479`; this proves parser coverage of that link shape, **not** live attendance access or the provenance of the fixture.
- [Discovery](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/quanta/discover.rs) traverses courses and nested organization pages. Its detail pass fetches announcements and material types, excluding assignment, quiz, and attendance details. Assignment links survive as inventory items, without submission or feedback enrichment.
- `parse_activity_page` exists, with assignment/quiz date tests, but has no production caller. It expects machine-readable time attributes. Its classifier also puts due and cut-off dates into one slot. Wiring this function alone would not supply a correct complete assignment model; plain-text dates, extensions, submission status, and separate cut-offs still need handling. See [parser and tests](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/quanta/parse.rs).
- [URL normalization](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/quanta/urlnorm.rs) explicitly ignores `/grade/report` navigation. Add a targeted grade collector; simply removing that exclusion would mix reports into the file inventory.
- [Discovered resources](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/quanta/mod.rs) contain titles, dates, type, URL, placement, size, and availability. They have no grade items, submission attempts, attendance sessions, or individual academic status fields. The [SQLite schema](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/migrations/0001_init.sql) likewise has no dedicated academic-record tables.
- [Session state](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/quanta/client.rs) already carries the Moodle cookie, optional user ID, and optional `sesskey`. The production client has GET/download methods; a structured session-AJAX method would be new work.
- The [scheduler](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/sync/scheduler.rs) wakes roughly every 30 seconds to check whether a scan is due. It does **not** scrape every 30 seconds: [settings](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/settings.rs) default to 60-minute scans, with a 15-minute minimum.

There is already useful infrastructure to reuse: authenticated requests, bounded concurrency, cancellation, local storage, deadline collections, history, and notification delivery. The existing [Agenda contract](../wiki/2026-11-14-attention-data-contracts.md) deliberately makes no submission/completion inference; enriching assignments must preserve that distinction.

## 2. Collection strategy

### Primary path: authenticated HTML

Use the current Rust HTTP client and cookie jar to request known student-facing pages. Parse server-rendered content with `scraper`. Keep an allowlist of academic read routes rather than recursively following every link. Start with page fixtures from the actual Quanta theme and language.

Upstream sources establish these route shapes:

- Assignment: `/mod/assign/view.php?id=<course-module-id>`. [Moodle assignment entry point](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/assign/view.php).
- Course grades: `/grade/report/user/index.php?id=<course-id>`, with the current student's identity implicit when `userid` is omitted. [User report entry point](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/grade/report/user/index.php).
- Attendance plugin: `/mod/attendance/view.php?id=<course-module-id>`. The plugin resolves the current student when no other student is requested, subject to its capabilities. [Attendance entry point](https://github.com/danmarsden/moodle-mod_attendance/blob/MOODLE_405_STABLE/view.php).

These are upstream route contracts, not evidence of successful authenticated requests to Quanta. Course-module IDs, assignment instance IDs, grade-item IDs, and attendance instance/session IDs are different identifiers. Do not interchange them when joining records or calling APIs.

### Optional path: structured Moodle functions

Moodle's session AJAX endpoint and token web services are different access paths. A function existing in source does not imply that the current session can call it. For session AJAX, its service registration must explicitly permit AJAX, and the request still needs the appropriate authentication and capabilities. [Moodle AJAX developer guide](https://moodledev.io/docs/4.5/guides/javascript/ajax).

Use a structured function only after checking its registration and access behavior against Quanta's deployed version. Token-based REST/mobile services additionally depend on site configuration and a suitable service/token; an SSO session is not automatically a web-service token. See the [upstream academic data source inventory](2026-11-15-moodle-academic-data-sources.md) for exact functions and source evidence.

Concretely, Moodle 4.5 registers `mod_assign_get_assignments`, `mod_assign_get_submission_status`, `gradereport_user_get_grade_items`, and `gradereport_user_get_grades_table` as read functions in the official mobile service, **without** `ajax => true` on those entries. They are promising token-service interfaces, not cookie-only AJAX shortcuts. The corresponding `view_*` functions include explicit event/completion writes and must not be confused with getters. [Assignment registrations](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/assign/db/services.php), [grade registrations](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/grade/report/user/db/services.php), [web-service configuration](https://docs.moodle.org/405/en/Using_web_services).

**Recommendation:** ship HTML support first unless a short live probe proves a usable structured interface. Do not make the feature depend on obtaining administrator access or introducing a persistent browser automation process.

One useful adjunct is the calendar: the inspected Moodle branch enables `core_calendar_get_action_events_by_timesort` and the course-scoped action-event functions for session AJAX. Their results are filtered actionable events, not a complete assignment inventory. Pagination, course limits, and completed/non-actionable events mean they can supplement deadline discovery but cannot replace assignment detail collection. Exact declarations and response fields are in the [source inventory](2026-11-15-moodle-academic-data-sources.md#calendar-session-ajax-useful-adjunct-incomplete-source).

## 3. Assignments

### Student-facing value

Collect the assignment title, course/section, description and reference attachments, opening time, base due date, individual effective due date where exposed, cut-off, submission state, grading state, last submission modification, and released feedback. Let students open the authoritative Moodle page for submission.

Moodle distinguishes the due date, after which a submission can be late, from the cut-off, after which ordinary submission is closed. Assignment settings also permit drafts, explicit submission confirmation, group submissions, and marking workflows. Preserve these distinctions rather than treating a file upload or a passed deadline as proof of completion. [Assignment settings](https://docs.moodle.org/405/en/Assignment_settings).

### Proposed approach

1. Discover assignment module IDs using existing course parsing.
2. Fetch the student assignment view under a bounded detail budget.
3. Parse the description, distinct schedule fields, submission-status region, and released feedback region. Retain source text alongside normalized status codes where needed.
4. Resolve the effective student deadline from available override/extension information. If only the base date is visible, label it as such; do not claim a personalized deadline.
5. Attach a dedicated assignment record to the existing resource and project its effective due date into Agenda. Preserve unknown submission state instead of assuming “not submitted.”

Group submission can be made by a teammate, attempts can reopen, and drafts can remain unsubmitted. Store the displayed state and group/attempt context when available. Distinguish “not required,” “not yet open,” “draft,” “submitted,” “reopened,” and “unknown” only when the source supports those meanings. The detailed upstream source inventory covers submission response fields and permissions.

Submission-aware reminders need an explicit rule: a confirmed current final submission can suppress an action reminder, while a draft or reopened attempt may still need one. Do not derive “overdue work” solely from a past due date when submission state is unknown. The current scan engine generates approaching-deadline events from resource dates without submission context, so this rule belongs in the enrichment/reminder integration, not merely in the new screen. [Current reminder logic](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/sync/engine.rs).

**Important behavior to validate:** fetching the ordinary assignment page is not free of LMS side effects. In Moodle 4.5, its entry point calls `set_module_viewed()` before rendering and applies user overrides. Background reads can therefore affect activity-view/completion tracking. Keep collection separate from submit/edit actions, and establish whether a suitable structured read avoids the page-view effect before choosing the production path. [Assignment entry point](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/assign/view.php).

The deeper source review also confirms that student HTML does not universally expose a cut-off row: the inspected assignment renderer places that row in the grader summary. Record cut-off only when actually exposed; do not infer it from the due date. The course assignment index (`/mod/assign/index.php?id=<course-id>`) may supplement discovery. [Pinned renderer](https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/classes/output/renderer.php#L647).

### Limits

This covers Moodle's native Assignment activity. A PDF describing homework, an external LTI/Turnitin tool, a quiz, or an instructor-maintained spreadsheet needs its own adapter or remains an ordinary material/link. Do not promise universal assignment detection through text guessing. Date extraction must support the actual rendered locale and user timezone; never infer UTC or IST from an unqualified display string.

## 4. Grades

### Student-facing value

Show the student's visible grade items by course, with the exact displayed grade, range, percentage/weight when exposed, teacher feedback, category hierarchy, and course total. The [Moodle user report](https://docs.moodle.org/405/en/User_report) is designed to show these, although several columns are configurable.

### Proposed approach

Fetch the current student's user report once per monitored course. Identify columns by semantic headers and row identity, not fixed positions. Preserve grade item IDs and module links when available; never join items solely by title. Store displayed grade text even when numeric parsing succeeds: Moodle supports formats that do not reduce safely to a number.

Use the gradebook value as the authoritative displayed course-grade observation. Keep assignment feedback as a related but separate observation; do not overwrite one with the other if their sources differ. Do not average displayed item percentages to invent a course total, SGPA, or CGPA. Course aggregation, exclusions, and hidden contributions need the LMS's own rules. [User report fields](https://docs.moodle.org/405/en/User_report), [grade aggregation](https://docs.moodle.org/405/en/Grade_aggregation).

### Availability and change semantics

The report checks course grade visibility and student capabilities. A forbidden report does not prove that the login session expired. [User-report access checks](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/grade/report/user/index.php).

Represent unavailable, hidden/withheld when explicitly known, ungraded when explicitly known, visible, and unknown without converting any of them to zero. An absent row is not proof of a withdrawn mark. Only emit “grade published” or “grade changed” from reliable observations after a successful baseline; preserve an older observation as stale if collection fails.

Grades entered manually in Moodle can be collected if visible in the report, even without a matching assignment activity. Grades that live only in an inaccessible spreadsheet, another portal, or an unreleased assessment cannot be recovered by expanding this scraper.

## 5. Attendance

### Feasibility

Attendance is conditional on **where instructors record it**. Moodle's common Attendance activity is an additional plugin, with configurable statuses and points. It is not a guarantee that every Moodle course provides session-level attendance. [Attendance documentation](https://docs.moodle.org/405/en/Attendance_activity), [plugin source](https://github.com/danmarsden/moodle-mod_attendance/tree/MOODLE_405_STABLE).

The existing attendance-link fixture makes this adapter worth investigating first. It does not justify marking attendance support as verified for Quanta.

### Proposed approach

Detect attendance activities per course and fetch only the student's report. Collect activity identity, session identity where exposed, session date/time, description, raw status, points/max points, and source-reported summary. Handle the report's time filters and pagination explicitly: a weekly/monthly view must not be mistaken for a complete term history. Separate multiple attendance activities, such as lecture and tutorial attendance, until their meaning is known.

The plugin builds the student's report from a filtered session log and a summary bounded by the selected start/end dates. That makes filter scope a data-integrity requirement, not merely a UI concern. [Attendance user-report data](https://github.com/danmarsden/moodle-mod_attendance/blob/MOODLE_405_STABLE/classes/output/user_data.php).

Display the plugin's percentage with its label and scope. Configurable weighted statuses mean a points percentage may differ from the fraction of sessions attended. Do not count future or unmarked sessions as absences, assume `P/A/L/E` is universal, assume a 75% institutional threshold, or combine activities into a course-wide rate without evidence. [Attendance configuration and reports](https://docs.moodle.org/405/en/Attendance_activity).

If a student-visible attendance grade is the only record available, expose it as an attendance-related grade, not as a reconstructed session history. If attendance is maintained in a PDF/Excel sheet, the app can surface that document; extracting personal rows reliably is a separate project. If it lives in another portal, treat that as a separate integration and authentication boundary.

Keep this feature observational. Do not follow self-mark, QR, password, take-attendance, or edit actions. The plugin's student report and attendance-taking flows are distinct; see the [source inventory](2026-11-15-moodle-academic-data-sources.md).

The detailed review establishes three additional constraints:

- The plugin's `get_session`/`get_sessions` web services require staff marking/management capabilities. They are not a normal student-own-record API. Historical student HTML rows may also lack stable session IDs, limiting reliable per-session change detection. Start with source snapshots/summaries if identity cannot be established; do not fabricate stable IDs from mutable labels. [Pinned API checks](https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/externallib.php#L439), [student row renderer](https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/output/renderer.php#L1337).
- The self-marking `attendance.php` route and the plugin's mobile view callback can record attendance automatically under certain settings. The mobile callback is therefore unsuitable as a passive scraping shortcut, even if its outer service is described as a read. [Self-marking controller](https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/attendance.php#L110), [mobile callback](https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/output/mobile.php#L128).
- Automatic attendance can be configured to use course log activity or another activity's completion. Ordinary background reads that generate logs/completion can consequently influence attendance indirectly. **This setting is unverified on Quanta.** Avoid claiming zero attendance effects merely because the scraper never submits a form; establish the deployed policy before enabling background academic collection. [Automarking implementation](https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/local/automark.php#L89).

## 6. Architectural changes the expansion actually needs

These are research recommendations, not committed schema or API decisions.

- **Focused collectors:** separate assignment, grade, and attendance parsers/collectors under `quanta/`; retain `discover.rs` as bounded orchestration. A grade or attendance failure should not invalidate a successfully collected upload inventory.
- **Typed local records:** assignment details linked to resources; grade items linked to course/student/source identities; attendance activities, sessions, and observations. Store `observed_at`, last successful fetch, source URL, raw display values, and parse/capability status. Keep a student/account ownership boundary for personal records; verify account switching cannot mix two students' data.
- **Per-domain scan results:** distinguish unsupported, permission denied, authenticated-but-empty, parse failure, partial, stale, and session expired. Current `fetch()` maps both HTTP 401 and 403 to `AuthExpired`; that is too coarse for optional academic reports. A Moodle error page can also return HTML successfully, so positive page recognition matters. [Current client](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/quanta/client.rs).
- **Independent baselines:** the existing global baseline predates these domains. First successful collection of grades/attendance/assignment personal state must establish a quiet baseline even on an old installation. A failed first attempt must not consume that baseline. [Current scan engine](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/sync/engine.rs).
- **Domain-specific reconciliation:** material `MISS_THRESHOLD = 2` is not a rule for erasing a grade or declaring a student absent. Retain old academic observations with explicit staleness. Compare normalized facts, excluding transient UI text, “time remaining,” fetched-at timestamps, and session tokens.
- **Notifications and collections:** new event types need deliberate updates through Rust/TS models, Inbox validation/query filters, notification settings, and display labels. They will not appear automatically: [attention](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/attention.rs) and [notification delivery](https://github.com/Akshay-VK/quanta-pulse/blob/1bd0e8b5a24b05733295b5751a7bc42de7b90b43/src-tauri/src/notify.rs) enumerate existing categories.
- **Sensitive content:** keep marks and personal attendance local by default; use generic notification text unless the user explicitly enables details. Existing Telegram forwarding shares event text with native notifications, so academic events need an explicit transport/content policy before joining that pipeline. Exclude raw student HTML, cookies, `sesskey`, and signed file URLs from committed fixtures and logs.

Keep commands registered in `src-tauri/src/lib.rs`, frontend invocation in `src/lib/api.ts`, and matching camelCase models. Perform HTTP work without holding the SQLite connection lock. These are existing project conventions, not a reason to introduce another server or state framework.

## 7. Request budget and refresh behavior

Start with the current hourly schedule and manual refresh, preserving configured concurrency and backoff. Refresh active/upcoming assignments preferentially; cache unsupported/forbidden capabilities and retry deliberately rather than hammering them. Recheck after login, enrollment/configuration changes, or explicit refresh. Do not permanently cache a temporary network error as unsupported.

Planning formula for the HTML path: additional requests per full pass are approximately `C + A + T`, where `C` is courses whose grade report is fetched, `A` is assignment detail pages, and `T` is attendance activities. Pagination and auxiliary report requests add to this count; redirects/retries also cost requests. This is a request-budget formula, **not a measured performance estimate**. Set separate domain budgets so the existing material-detail cap cannot silently starve grades or attendance. Avoid minute-level polling until measured source load and user benefit justify it.

## 8. Validation needed before implementation commitments

Use an already authenticated, local student session; do not request passwords or session cookies in chat. Capture only sanitized structural fixtures or build synthetic equivalents. The minimum evidence set is:

1. An assignment with a deadline and submission status; ideally also draft/submitted, individual extension, and group/reopened examples where available.
2. A course user-grade report with numeric and nonnumeric/empty marks, a category, feedback, and course total; a hidden/disabled gradebook example if available.
3. An attendance activity showing the student's sessions, filter controls, status definitions, and summary, or confirmation that attendance lives elsewhere.
4. The deployed Moodle/theme/plugin version when exposed through legitimate UI or administrator documentation, plus whether any relevant AJAX/token service is actually available.

Compare parsed values with what that student sees. Exercise permission-denied, expired-login, partial/paginated, localized-date, changed-layout, and offline responses. Verify assignment collection's activity-view side effect before deciding whether it should run unattended.

Implementation acceptance should include quiet first-domain baselines on existing installations, no false zero grades/absences, stale-data retention, correct personalized deadlines, no false unsubmission on missing markup, repeated-event deduplication, account isolation, and no academic values leaking into Telegram by default. Add parser/diff/database tests and frontend workflow tests before UI wiring; run the project's required Cargo and frontend checks when those code paths change.

## 9. Recommended delivery order

**First: a bounded feasibility probe.** Establish real Quanta page shapes, permissions, identities, and side effects. The deliverable is a capability statement and sanitized fixtures for each domain, not a production scraper based on assumed Moodle HTML.

**Second: assignment details.** Extend the existing resource/Agenda foundation with effective deadlines and explicit submission state. Open Moodle for submission. This closes a concrete collection gap without requiring a new grade or attendance screen first.

**Third: student grades.** Add the course user-report collector, local grade records, a read-only course view, freshness labels, and baseline-safe change detection. Include numeric and scale/text grades from the start.

**Fourth: attendance.** Ship a detected-plugin adapter only after confirming student report access and summary semantics. Show unsupported/unavailable honestly; retain links to source records. Defer custom portals, spreadsheet interpretation, and attendance predictions until there is separate evidence and scope.

No reliable calendar estimate follows from upstream research alone. Assignment parsing is the smallest extension, grades require a new data domain, and attendance has the largest deployment uncertainty. The live-page probe is what makes implementation sizing credible.

## Evidence boundary and companion research

Verified locally: the code paths and omissions described at the pinned repository commit. Verified externally: public Quanta login identity and upstream Moodle/plugin documentation and source behavior. Not verified: actual signed-in Quanta report content, deployed versions, installed services, course-specific visibility, or institution attendance policy.

The completed companion [upstream source inventory](2026-11-15-moodle-academic-data-sources.md) contains deeper function-level research with 67 pinned source references and version qualifications. Its inspected revisions are Moodle `69ef83ad2948db19595106671f03a1429679c870` and Attendance `d4095c8a4613a3812246590c7db871404b91fd3b`, both from their `MOODLE_405_STABLE` branches; neither identifies Quanta's installed version. Its findings have been reconciled into this report. This report proposes a direction; it creates no GitHub issues, changes no historical wiki decisions, and implements no feature.

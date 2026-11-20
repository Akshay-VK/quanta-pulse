# Moodle academic data sources: assignments, grades, attendance

Research date: 2026-11-15. Scope: upstream feasibility for a student desktop tracker, not an audit of Quanta Pulse implementation or a claim about Quanta's deployed configuration. Read `AGENTS.md`, `docs/agents/domain.md`, and `docs/wiki/index.md`. No Quanta requests, accounts, credentials, or student records were used. No application changes, branches, issues, or PRs were created.

## Finding

**All three areas have upstream student-facing HTML sources. Structured assignment and grade services exist, but most relevant functions are not enabled for session AJAX. Attendance needs particular care: its ordinary session-read web services are staff-facing, and both a self-marking page and its mobile view callback can record attendance merely when requested.** This is feasibility evidence, not proof that Quanta exposes these sources. The endpoint and permission evidence follows below.

Practical recommendation, inferred from that evidence: start with narrowly allowlisted student report pages; optionally use the calendar's session AJAX functions for deadline discovery; treat token services as a separate, server-configured integration. Never crawl action links or use Attendance mobile content as a passive read source. Preserve Moodle's visible values and uncertainty instead of reconstructing unpublished grades or assuming attendance policies.

## Inspected versions and evidence boundaries

| Upstream | Exact inspected revision | Version evidence / limits |
| --- | --- | --- |
| `moodle/moodle`, `MOODLE_405_STABLE` | [`69ef83ad2948db19595106671f03a1429679c870`](https://github.com/moodle/moodle/commit/69ef83ad2948db19595106671f03a1429679c870), committed 2026-11-12 | `version.php`: Moodle **4.5.16**, build `20261112`, internal `2024100716.00`, branch `405`. [Version source][m-version] |
| `danmarsden/moodle-mod_attendance`, `MOODLE_405_STABLE` | [`d4095c8a4613a3812246590c7db871404b91fd3b`](https://github.com/danmarsden/moodle-mod_attendance/commit/d4095c8a4613a3812246590c7db871404b91fd3b), committed 2026-11-12 | `version.php`: plugin version/release **2024082405**, requires Moodle `2024092700`, supported `[405,405]`. A plugin's date-like release number does not identify the deployed source commit. [Version source][a-version] |

All code links below are pinned to those revisions. Official Moodle **4.5** documentation supplements the source. Other branches, older releases, local patches, themes, custom grade reports, and other attendance plugins were not behaviorally inspected. Source `@since` annotations identify introduction dates of functions, **not** a promise that all listed fields or permission checks existed then. Attendance's [maintainer README][a-readme] identifies version-specific branches; match the site's installed plugin before relying on these contracts.

## 1. Three different access mechanisms

| Mechanism | Exact entry point | What it establishes |
| --- | --- | --- |
| HTML session scraping | Student pages such as `/mod/assign/view.php?id=<cmid>`, `/grade/report/user/index.php?id=<courseid>`, `/mod/attendance/view.php?id=<cmid>` | Uses the ordinary current user's page permissions. No external-service setup is inherent in these page controllers. Returned HTML is theme-, language-, settings-, and version-dependent. Controllers can also log views or update state. [Assignment controller][m-assign-view], [grade controller][m-user-index], [Attendance controller][a-view] |
| Session AJAX | `/lib/ajax/service.php`; JSON request array with `index`, `methodname`, `args` | Only registered functions allowed for AJAX may run. For a function requiring login, core checks the logged-in session and the session's `sesskey`. `loginrequired` defaults to `true`; it is **not** the switch granting AJAX access. `ajax => true` is that switch. [Dispatcher][m-ajax], [external API checks][m-external], [official AJAX guide](https://moodledev.io/docs/4.5/guides/javascript/ajax) |
| Token web services | `/webservice/rest/server.php`; REST dispatcher arguments include `wsfunction` and `moodlewsrestformat=json` | Separate protocol/service access. Administrator must enable web services and REST, enable/select a service containing the functions, and authorize access as configured. Function-level capabilities/context checks still apply. A normal page session does not make every external function AJAX-callable. [REST controller][m-rest], [server access enforcement][m-ws-lib], [official setup](https://docs.moodle.org/405/en/Using_web_services) |

No login/token acquisition flow is proposed here. The service distinction matters even when Moodle's official mobile service already contains a function: membership in that service does **not** imply `ajax => true`. The service declarations are authoritative for upstream defaults; an installation's stored declarations and customizations can differ. [Function declaration documentation](https://moodledev.io/docs/4.5/apis/subsystems/external/description)

### Relevant function availability in the inspected branch

| Function(s) | Session AJAX? | Student usefulness / restrictions |
| --- | --- | --- |
| `mod_assign_get_assignments`, `mod_assign_get_submission_status` | **No** `ajax` declaration | Useful structured student assignment sources through an authorized token service. Both belong to the official mobile service. [Assignment declarations][m-assign-services] |
| `mod_assign_get_grades`, `mod_assign_get_submissions`, `mod_assign_get_user_flags` | **No** | Do not use as student-own-data substitutes: bulk grades/submissions call `require_view_grades()`; flags require `mod/assign:grade`. [Bulk grade check][m-assign-ext-grades], [bulk submissions check][m-assign-ext-submissions], [flags check][m-assign-ext-flags] |
| `mod_assign_list_participants`, `mod_assign_get_participant` | **Yes** | Grading/participant interfaces; their existence does not grant a normal student bulk grade access. Inspect implementation capabilities, not just the `read` label. [Declarations][m-assign-services] |
| `gradereport_user_get_grade_items`, `gradereport_user_get_grades_table`, `gradereport_user_get_access_information`, `gradereport_overview_get_course_grades` | **No** `ajax` declaration | Useful grade sources through authorized token services; official mobile service membership. [User declarations][m-user-services], [overview declarations][m-overview-services] |
| `core_calendar_get_action_events_by_timesort`, `core_calendar_get_action_events_by_course`, `core_calendar_get_action_events_by_courses`, `core_calendar_get_calendar_event_by_id` | **Yes** | Session-accessible discovery of the user's actionable calendar events, subject to method access checks and filtering. Not a complete assignment/status/grade inventory. [Core declarations][m-core-services], [calendar methods][m-calendar] |
| `mod_attendance_get_session`, `mod_attendance_get_sessions`, `mod_attendance_get_courses_with_today_sessions` | **No** | Attendance service exists, but session reads require staff capabilities; “today sessions” is described as a teacher-oriented function. [Declarations][a-services], [implementation][a-external] |
| `tool_mobile_get_content` with `component=mod_attendance`, `method=mobile_view_activity` | **No** | Mobile service callback exists; **not a passive read**, despite the outer function's `type=read`. [Mobile service declaration][m-mobile-services], [callback dispatch][m-mobile-external], [Attendance callback][a-mobile] |

`type=read`, `readonlysession`, `loginrequired`, AJAX eligibility, service membership, and capability checks are separate concepts. None is a general guarantee that a request has no server-side effects. Core external execution defaults to logged-in access and independently rejects a function not allowed from AJAX. [External API][m-external]

## 2. Assignments

### Student HTML routes and fields

* `/mod/assign/index.php?id=<courseid>` is the course assignment index. Its rendering supplies assignment links and due/submission/grade summary columns, subject to visibility and role. It is useful discovery, not an authoritative replacement for each student's full detail. [Index controller][m-assign-index], [index renderer][m-assign-render-index]
* `/mod/assign/view.php?id=<cmid>` is the assignment detail route: `id` is the **course-module ID**, not the assignment-instance ID. It requires course/module access and `mod/assign:view`, applies effective overrides, and invokes the assignment view. [Controller][m-assign-view]
* The student status renderable/renderer supports submission status, team information, attempt number, grading status, submission lock state, extension date, time remaining, modification time and submission-plugin output. Classes include `.submissionstatustable`, `.submissionsummarytable`, `submissionstatus<status>`, `submissiongraded`, and `submissionnotgraded`. Labels use Moodle language strings, not fixed English keys. Fields are conditional, and the student summary does **not** expose a universal cutoff-date row: the inspected renderer puts that row in grader view. [Status builder][m-assign-status], [status renderer][m-assign-render-status]
* Opening/due dates can also appear through the activity-date machinery, outside the submission table. Its assignment implementation emits `dataid=allowsubmissionsfromdate` / `duedate` and timestamps. Do not assume every theme renders the same surrounding HTML or every assignment shows both dates. [Assignment dates][m-assign-dates]

Inference for a scraper: parse structural classes and explicitly supported locale/date markup; do not use one fixed table column index or infer status from the presence of an upload link. Keep an unsupported/missing field distinct from an explicit “no due date.” Resolve discovered links only against the expected origin and approved read routes; do not follow `action=editsubmission`, submit, start, or grading actions during polling.

### Structured functions and useful fields

`mod_assign_get_assignments(courseids=[], capabilities=[], includenotenrolledcourses=false)` is marked `@since Moodle 2.4`. Empty course IDs mean the caller's active enrolled courses; explicit IDs normally undergo enrollment checks. Each included assignment requires module context validation and `mod/assign:view`. The implementation calls `update_effective_access($USER->id)` before returning dates. [Implementation and schema][m-assign-ext-list]

Important returned fields, subject to the schema and settings:

| Category | Fields |
| --- | --- |
| Identity/content | `id` (assignment instance), `cmid`, `course`, `name`, optional `intro`, `introformat`, `introfiles`, `introattachments`, activity instructions/attachments |
| Dates/configuration | `duedate`, `allowsubmissionsfromdate`, `cutoffdate`, `gradingduedate`, `timemodified`, `timelimit`, `nosubmissions`, `submissiondrafts`, `grade` (configured maximum/scale, **not student's earned grade**) |
| Teams/attempts/release | `teamsubmission`, `requireallteammemberssubmit`, `teamsubmissiongroupingid`, `preventsubmissionnotingroup`, `attemptreopenmethod`, `maxattempts`, `blindmarking`, `revealidentities`, `markingworkflow`, plugin `configs` |

`mod_assign_get_submission_status(assignid, userid=0, groupid=0)` is marked `@since Moodle 3.1`; here `assignid` is the assignment **instance**, and `userid=0` defaults to self. It validates the assignment, active target user, submission visibility, and group visibility where applicable; the student's summary depends on `mod/assign:viewownsubmissionsummary`. It applies effective access and reuses the same student status/feedback renderables as the UI. [Implementation][m-assign-ext-status]

| Returned area | Relevant fields and limits |
| --- | --- |
| `lastattempt` | Optional `submission`, `teamsubmission`, `submissiongroup`, `submissiongroupmemberswhoneedtosubmit`, `usergroups`; `submissionsenabled`, `locked`, `graded`, `canedit`, `caneditowner`, `cansubmit`, `extensionduedate`, `blindmarking`, `gradingstatus`, optional `timelimit` |
| Submission object | `id`, `userid`, `groupid`, `status`, `attemptnumber`, `timecreated`, `timemodified`, `latest`, optional `timestarted`, plugin data. Individual and team records are distinct. [Submission schema][m-assign-submission-schema] |
| `feedback` | Optional grade object and feedback plugins, `gradefordisplay`, `gradeddate`. Its presence/value depends on grade/feedback visibility, not just the submission's `graded` flag. |
| Other | Optional previous attempts and permitted `assignmentdata` attachments/instructions; warnings; `gradingsummary` is suitable for users allowed to view grading summaries, not something a student tracker should require. |

Return definitions: [status schema][m-assign-status-schema]. The status response is not itself a general due/cutoff-date response: pair the effective assignment dates with `lastattempt.extensionduedate` and status permissions. File/plugin bodies and group-member identifiers are not needed for a minimal tracker.

### Deadline and submission semantics that must survive normalization

1. **Due, cutoff, opening, grading due, and time limit differ.** Moodle's [assignment settings](https://docs.moodle.org/405/en/Assignment_settings) describe due date as the lateness boundary and cutoff as the normal submission boundary. `gradingduedate` is the expected marking date, not a student deadline. Zero/unset values must retain their “not configured” meaning. A submitted item can be late; an overdue item need not be closed.
2. **Overrides and extensions are separate.** In the inspected code, effective access merges a user override over a selected group override for `duedate`, `cutoffdate`, `allowsubmissionsfromdate`, `timelimit`. The group query chooses the override with lowest `sortorder`; do **not** implement a blanket “maximum of all groups” rule based on an older explanatory comment. A granted extension is separately held in user flags and exposed in the student's status. [Actual override algorithm][m-assign-overrides], [extension validation/storage][m-assign-extension]
3. **Use the effective student deadline.** The renderer substitutes an extension in the display and its time-remaining calculation uses the later of effective due date and extension. Preserve both source values and the applied deadline. Submission openness also considers cutoff/extension and other state; `cansubmit` / `canedit` are more reliable than a client-only date test. [Renderer][m-assign-render-status], [time-remaining logic][m-assign-time], [submission openness][m-assign-open]
4. **Group submission is not an individual upload.** Prefer the team submission state when enabled; absence of an individual's submission record does not prove missing work. Moodle can require every team member to confirm submission, and can reject users with no valid submission group. Group feedback/grades can be common or individualized. Keep team draft, team submitted, and members still needing to submit distinct. [Status construction][m-assign-status], [team rendering][m-assign-render-status], [official group settings](https://docs.moodle.org/405/en/Assignment_settings)
5. **Attempt and release are distinct from completion.** Preserve `new`/`draft`/`submitted`/`reopened` states and attempt number; an uploaded draft is not necessarily submitted for grading. `gradingstatus=graded` is not permission to reveal a mark. Feedback generation consults the gradebook's hidden flag and marking workflow. [Submission schema][m-assign-submission-schema], [grading status][m-assign-grading-status], [feedback visibility][m-assign-feedback]

### Calendar session AJAX: useful adjunct, incomplete source

The `core_calendar_get_action_events_by_timesort` parameters include `timesortfrom`, `timesortto`, `aftereventid`, `limitnum` (default 20), `limittononsuspendedevents`, optional `userid`, and optional `searchvalue`. `…_by_courses` takes `courseids`, time bounds, `limitnum` (default 10 **per course**), optional search. Methods are marked `@since Moodle 3.3`, but current optional parameters must not be assumed on older sites. [Methods and parameters][m-calendar], [AJAX declarations][m-core-services]

The returned event exports provide event metadata and activity links; action exports include `name`, `url`, `itemcount`, `actionable`, and `showitemcount`. The response includes paging information for the timesort path. Follow pagination and preserve distinction between calendar event identity and assignment `cmid`/instance identity. Action URLs are navigation hints, not requests to execute during scanning. [Event exporter][m-calendar-event], [action exporter][m-calendar-action], [events exporter][m-calendar-events]

Inference: use this to discover actionable due work; absence from a filtered/time-bounded/action-based feed does not prove an assignment was removed, submitted, or has no deadline. It does not provide complete grade release, extension, team, or submission history semantics.

## 3. Grades

### Routes and permissions

* `/grade/report/user/index.php?id=<courseid>` displays the current student's course report when `userid` is omitted. It checks `gradereport/user:view`, own-grade permission `moodle/grade:view`, and course `showgrades`. `userid=0` means an all-user request and requires `moodle/grade:viewall`; it is **not** a safe self default for this route. [Controller][m-user-index]
* `/grade/report/overview/index.php` provides a cross-course overview of the user's course totals. Report data honors course visibility, `showgrades`, relevant capabilities, and hidden-total policy; a missing total does not mean zero or a nonexistent course. [Overview controller][m-overview-index], [overview data/visibility][m-overview-lib]
* Assignment detail can expose released assignment feedback, but is not the complete gradebook: grade items may be manual, other modules, categories, or course totals. Use the user grade report for comprehensive student-visible course grades. [Grade-item schema][m-user-external-schema], [assignment feedback][m-assign-feedback]

### Structured grade functions

`gradereport_user_get_grade_items(courseid, userid=0, groupid=0)` and `gradereport_user_get_grades_table(courseid, userid=0, groupid=0)` are marked `@since Moodle 3.2`. **Pass the current user's explicit ID**: in these methods `userid=0` requires `moodle/grade:viewall`, unlike assignment status's self default. Both share `check_report_access`, require `gradereport/user:view`, and allow ordinary own access only with `moodle/grade:view` and `course.showgrades`. They also enforce other-user/group restrictions. They are token-service functions, not AJAX-enabled in the inspected branch. [Access checks and methods][m-user-external], [declarations][m-user-services]

`get_grade_items` returns `usergrades[].gradeitems[]`. Useful fields are:

| Purpose | Fields / caveats |
| --- | --- |
| Identity | `id` (grade-item ID), `itemname`, `itemtype`, `itemmodule`, `iteminstance`, `itemnumber`, `categoryid`, `outcomeid`, `scaleid`, optional `cmid`; do not conflate grade-item ID with course-module or activity-instance ID |
| Value | Optional `graderaw`, `gradeformatted`, `grademin`, `grademax`, `rangeformatted`, `percentageformatted`, `lettergradeformatted`; formatted grades can contain HTML and scale/letter values |
| Aggregation | Optional `weightraw`, `weightformatted`, `status`; weights and totals come from Moodle's report calculations and settings |
| Visibility/state | Optional `gradeishidden`, `gradehiddenbydate`, `gradeneedsupdate`, `gradeislocked`, `gradeisoverridden`, `locked`; optional does not imply student entitlement to every flag |
| Feedback/dates | Optional `feedback`, `feedbackformat`, `gradedatesubmitted`, `gradedategraded`; no universal grade-change timestamp is promised here |

Full [return schema][m-user-external-schema]. `get_grades_table` instead returns report rows/columns with formatted content, attributes/spans/headers, including optional weight, grade, range, percentage, letter grade, rank, average, feedback, contribution-to-total columns. It is closer to the rendered report than a stable flat numeric ledger. [Table schema][m-user-table-schema]

`gradereport_overview_get_course_grades(userid=0)` **does** default to the current user. It returns `grades[]` with `courseid`, formatted `grade`, `rawgrade`, optional `rank`, plus warnings. Other-user access requires `moodle/grade:viewall` at system context. It constructs the overview report, which applies hidden/course visibility policies. It is marked `@since Moodle 3.2` and lacks AJAX enablement. [Implementation/schema][m-overview-external], [report data][m-overview-lib], [declaration][m-overview-services]

### Hidden grades, totals and changes

* Hidden items/categories may disappear completely, or remain as rows without a visible mark, according to `report_user_showhiddenitems` and date-hidden policy. A hidden row can contain `-` or a submission date in place of the grade. The `gradehiddenbydate` flag is set by the latter display branch; do not interpret its name alone as a grade publication deadline. Core initializes `graderaw=null` and only supplies hidden marks to users with `moodle/grade:viewhidden`. [Report implementation][m-user-report-hidden]
* A missing/null/dash grade is **not zero**. Preserve unavailable/hidden/ungraded/unsupported distinctions when the source supports them. Optional feedback is suppressed for hidden grades in the normal student report. [Grade and feedback rendering][m-user-report]
* Totals involving hidden items can be blanked or adjusted according to report settings. Display the authoritative reported course/category total rather than summing the visible marks. Weights, scales, categories, overridden grades, exclusions, and aggregate bounds make a local arithmetic total unreliable. [User total adjustment][m-user-report], [overview total adjustment][m-overview-lib], [user report settings][m-user-settings]
* Activity visibility and grade visibility are separate. Hiding an assignment on the course page does not itself hide its grade; a tracker must not drop a visible grade merely because it cannot see the corresponding activity. Conversely, a visible assignment does not imply a released grade. [Official grade hiding documentation](https://docs.moodle.org/405/en/Grade_hiding)
* Assignment feedback generation checks gradebook visibility and suppresses feedback plugins until workflow release. Anonymous/blind grading adds release conditions in Moodle's workflow; rely on the student's returned visibility, not raw assignment grade records or staff-oriented bulk endpoints. [Feedback builder][m-assign-feedback], [official assignment settings](https://docs.moodle.org/405/en/Assignment_settings)

Inference for future tracking: snapshot only the student's returned visible grade state; baseline without alerts; distinguish first release from a changed visible value and later loss of visibility. `gradedategraded` is not a guaranteed edit cursor; core notes that grade-record `timemodified` is a general record-change date. A failure/unsupported report should not overwrite a previous observation with a zero. [Date/rendering evidence][m-user-report-hidden]

## 4. Attendance

### Student HTML is the clearest ordinary student record source

`/mod/attendance/view.php?id=<cmid>` requires course/module access and `mod/attendance:view`. Omit `studentid` to request self; a different student's report requires `mod/attendance:viewreports`. Staff capabilities can redirect this route to management/report pages, so role-dependent redirects must be distinguished from empty student data. [Controller][a-view], [capability defaults][a-access]

This source is specifically the optional `mod_attendance` plugin, not a Moodle-core guarantee. A course can have several Attendance instances (for example lecture and lab), each with its own sessions/configuration. [Official Attendance activity documentation](https://docs.moodle.org/405/en/Attendance_activity)

The view defaults to a month filter. In this inspected plugin `view=5` means all dates (`ATT_VIEW_ALL`) and `mode=0` means this course; `mode=1` is all courses and `mode=2` all sessions. A narrow request candidate is `/mod/attendance/view.php?id=<cmid>&view=5`, but validate it against the installed version and actual report/filter controls. Do not silently treat the default month as complete history. [View constants/default][a-view-params], [filter constants][a-local]

HTML output has date/time, description, optional custom-field columns, status, points, remarks, and summaries. Own-report layout omits some columns. Marked-session points render as `configured status grade / maximum for that status set`. A missing record can instead display not-recorded, enrollment boundary, future/self-marking, or other conditional content. Preserve these states rather than classifying every empty row as absent. Current renderer classes include `datecol`, `desccol`, `statuscol`, `pointscol`, `remarkscol`; custom fields and colspans make fixed-position parsing fragile. [Student renderer][a-renderer-user], [student data assembly][a-user-data]

**ID limitation:** the rendered read-only student's row need not carry a stable session ID. Some rows expose `sessid` only through action links; marked rows without an update action can lack that link. The DOM therefore does not guarantee a stable numeric session key or raw timestamp for every historical row. Date/description matching would be a weaker inferred identity with collision/change risks. Do not visit a self-marking link just to obtain data. [Row construction][a-renderer-user]

### Attendance service limits and fields

The plugin declares a prebuilt enabled service named `Attendance`, shortname `mod_attendance`, containing its eight declared functions. That does not enable REST globally, grant a service token, or bypass capabilities. None of these declarations includes `ajax => true`. [Service definitions][a-services], [Moodle service setup](https://docs.moodle.org/405/en/Using_web_services)

`mod_attendance_get_session(sessionid)` and `mod_attendance_get_sessions(attendanceid)` validate module context and require **at least one** of `mod/attendance:manageattendances`, `mod/attendance:takeattendances`, `mod/attendance:changeattendances`. Normal students do not receive those defaults. `attendanceid` is the plugin **instance ID**, not `cmid`; `sessionid` identifies a scheduled session. These are not student-own-attendance APIs. [External checks/schema][a-external], [default roles][a-access]

The return schema exposes the following exact fields. This breadth explains the staff restriction. A student tracker should not request a roster, even if an unusually broad role technically permits it. [Session return schema][a-external-session-schema]

| Area | Fields |
| --- | --- |
| Session | `id`, `attendanceid`, `groupid`, `sessdate`, `duration`, `lasttaken`, `lasttakenby`, `timemodified`, `description`, `descriptionformat`, `courseid` |
| Configuration | `studentscanmark`, `absenteereport`, `autoassignstatus`, `preventsharedip`, `preventsharediptime`, `statusset`, `includeqrcode`, `studentsearlyopentime` |
| `statuses[]` | `id`, `attendanceid`, `acronym`, `description`, `grade`, `visible`, `deleted`, `setnumber` |
| `attendance_log[]` | `studentid`, `statusid`, `remarks`, `id`; this external schema is narrower than the database log schema |
| `users[]` | User identity/name fields; excluded from the proposed student-tracker scope |

`mod_attendance_update_user_status(sessionid, studentid, takenbyid, statusid, statusset)` is a **write**, not a status read. The inspected revision permits a constrained self-marking path as well as staff marking, with checks for own IDs, allowed self-marking conditions and status set/status validity. Do not infer that an older installation has identical checks. [Implementation][a-external-update]

### Status sets, points, denominators and course weighting

Status acronyms/descriptions and points are configurable; Present/Absent/Late/Excused are defaults, not a fixed universal enumeration. Each session chooses a `statusset`, status records use `setnumber`, and statuses also have visibility/deletion and student-availability controls. The plugin stores a session's `duration`, but the inspected point summary does **not** weight sessions by duration. [Schema][a-schema], [summary SQL][a-summary], [official configuration](https://docs.moodle.org/405/en/Attendance_activity)

The inspected summary computes:

* **Completed/taken-session fraction:** sum of recorded visible/non-deleted status points divided by the sum of each relevant session status set's maximum visible/non-deleted points. It joins student logs and sessions whose `lasttaken != 0`, and applies course/start/date/group logic. This is not necessarily `present count / classes held`.
* **All-session fraction:** earned taken-session points divided by the applicable all-session maximum; it may include scheduled sessions beyond those already taken. Group membership affects which group sessions contribute.
* **Maximum possible fraction:** earned points plus the difference between all-session maximum and taken-session maximum, divided by all-session maximum. It is the plugin's configured points projection, not an institutional eligibility promise.

These are distinct outputs in [summary calculation][a-summary]. Zero-denominator handling is explicit in `attendance_calc_fraction`, so “no marked sessions” must stay distinguishable from an observed zero score. [Fraction helper][a-fraction]

For example, **hypothetically**, one session with max 2 and another status set with max 4 contributes a denominator of 6, not 2 classes or their combined duration. An “Excused” status can be assigned points; its name alone does not prove exclusion from the denominator. Display the plugin's reported meaning and points rather than assuming attendance policy. This example is an inference from the summary formula, not a Quanta observation.

The activity's configured grade is another layer: zero disables grade updates; a positive maximum scales the taken-session fraction, while a negative configured value denotes a Moodle scale. The resulting gradebook item can then have its own category/course aggregation and visibility. Do not confuse status points, Attendance percentage, activity maximum grade, or gradebook weight. [Grade update implementation][a-grade-update], [grade-item/report fields][m-user-external-schema]

### Requests that can mark attendance or otherwise change state

1. **`/mod/attendance/attendance.php?sessid=<sessionid>` can write on GET.** After eligibility/group/time/network checks, `autoassignstatus` with no required student password can call `take_from_student()` directly. QR-based paths can also lead directly to marking. Do not prefetch, preview, crawl, or poll this route. [Self-marking controller][a-mark]
2. **`tool_mobile_get_content` is not a safe workaround.** Its Attendance `mobile_view_activity` callback assembles a configurable recent/upcoming session window and a summary, but also calls `take_from_student()` for eligible unrecorded sessions with automatic status assignment and no password. This can happen during the initial view callback, without an explicit status argument. Its rendered templates/other data are not a clean own-record JSON API. [Callback, especially automatic branch][a-mobile], [plugin handler registration][a-mobile-declarations], [core callback dispatch][m-mobile-external]
3. **The marking write is substantive.** `take_from_student()` inserts/updates the attendance log, records time/current user/IP, changes session `lasttaken`/`lasttakenby`, updates the student's grade and emits `attendance_taken_by_student`. It is not merely recording that a page was visited. [Write implementation][a-take]
4. **Self-marking availability is configurable.** Site/session switches, listing capability, time windows/early opening, status availability, group membership, subnet restrictions, shared-IP controls, optional password/QR settings and update-after-marking settings can matter. A link's presence is not durable proof that marking is currently allowed. [Eligibility checks][a-can-mark], [controller][a-mark], [status eligibility][a-structure-status]
5. **Even ordinary views have indirect effects.** Attendance `view.php` emits `session_report_viewed`; assignment detail updates module-view completion. Attendance's automatic-marking task can derive attendance from course log activity, or from another activity's completion. Thus background page reads can potentially influence auto-marking policy even when no explicit marking endpoint is invoked. This is a source-supported risk, **not evidence that Quanta enables it**. Verify that policy before describing polling as side-effect-free. [Attendance view event][a-view], [assignment completion call][m-assign-view], [automark task][a-automark]

Inference: if automatic attendance is based on any course access, a strict guarantee that background scans never affect attendance may be impossible using ordinary logged student pages alone. Product scope must distinguish “does not submit forms or call marking routes” from “cannot affect Moodle logs/completion or server automation.” This report does not recommend implementing self marking.

## 5. Unverified Quanta assumptions and validation boundary

No claim below has been verified on `quanta.bits-pilani.ac.in`:

* Installed Moodle version/patch level, theme, locale, relative-date settings, custom reports and external-service declarations; the 4.5 baseline is a research choice, not fingerprinting of Quanta.
* Whether relevant student accounts can see own grade reports, courses expose `showgrades`, assignment extensions/overrides/team submission are used, and grades are maintained in Moodle rather than another institutional system.
* Whether Attendance is installed at all, whether it is this plugin/branch or a fork, whether all teaching groups use it, and whether a displayed percentage means institutional eligibility.
* Whether web services, REST, official mobile service/custom service and the required student functions are enabled; no token or API availability is assumed.
* Whether session AJAX calendar functions are available on Quanta and what their visible event coverage is.
* Whether ordinary report views or completion updates can influence configured automatic attendance; which Attendance filter/denominator/status-set and grade-weight settings apply.

Follow-up validation should first establish version/plugin/configuration evidence and privacy-safe synthetic fixtures. Required fixture cases include: absent/zero dates; user override versus prioritized group override; extension; individual/team draft/submitted/reopened attempts; all-team-confirmation pending; manual/scale/hidden/released/overridden grades; totals with hidden items; multiple attendance instances/status sets; configurable excused/late points; unrecorded/future/enrollment-boundary sessions; all-date versus month filters; and the auto-marking risks above. This is a suggested evidence checklist, not authorization to access live student data or alter server settings.

A defensible upstream-only conclusion is **conditional feasibility**: assignment and grade tracking have strong student read sources; attendance read tracking is feasible through the student's report when available, with weaker HTML identity and policy-dependent side effects. Exact Quanta coverage and a zero-write/zero-attendance-effect polling guarantee remain unproven.

## Pinned source index

References link to the inspected upstream revisions; line anchors identify the relevant implementation entry points. Official docs above are versioned URLs but remain editable pages.

[m-version]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/version.php
[m-ajax]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/lib/ajax/service.php#L57
[m-external]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/lib/external/classes/external_api.php#L107
[m-rest]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/webservice/rest/server.php
[m-ws-lib]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/webservice/lib.php
[m-core-services]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/lib/db/services.php#L270
[m-assign-services]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/db/services.php
[m-assign-view]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/view.php#L28
[m-assign-index]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/index.php
[m-assign-render-index]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/classes/output/renderer.php#L1230
[m-assign-render-status]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/classes/output/renderer.php#L647
[m-assign-time]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/classes/output/renderer.php#L1303
[m-assign-dates]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/classes/dates.php#L43
[m-assign-ext-list]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/externallib.php#L235
[m-assign-ext-status]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/externallib.php#L2322
[m-assign-status-schema]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/externallib.php#L2546
[m-assign-submission-schema]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/externallib.php#L870
[m-assign-ext-grades]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/externallib.php#L73
[m-assign-ext-submissions]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/externallib.php#L726
[m-assign-ext-flags]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/externallib.php#L1089
[m-assign-status]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/locallib.php#L5399
[m-assign-feedback]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/locallib.php#L5487
[m-assign-overrides]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/locallib.php#L996
[m-assign-extension]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/locallib.php#L6998
[m-assign-open]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/locallib.php#L6270
[m-assign-grading-status]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/mod/assign/locallib.php#L9432
[m-calendar]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/calendar/externallib.php#L405
[m-calendar-event]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/calendar/classes/external/event_exporter.php
[m-calendar-action]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/calendar/classes/external/event_action_exporter.php#L65
[m-calendar-events]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/calendar/classes/external/events_exporter.php
[m-user-services]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/db/services.php
[m-user-index]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/index.php#L29
[m-user-external]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/classes/external/user.php#L56
[m-user-external-schema]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/classes/external/user.php#L495
[m-user-table-schema]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/classes/external/user.php#L291
[m-user-report]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/classes/report/user.php#L488
[m-user-report-hidden]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/classes/report/user.php#L663
[m-user-settings]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/user/settings.php
[m-overview-services]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/overview/db/services.php
[m-overview-index]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/overview/index.php
[m-overview-lib]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/overview/lib.php#L184
[m-overview-external]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/grade/report/overview/classes/external.php#L52
[m-mobile-services]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/admin/tool/mobile/db/services.php#L66
[m-mobile-external]: https://github.com/moodle/moodle/blob/69ef83ad2948db19595106671f03a1429679c870/admin/tool/mobile/classes/external.php#L368
[a-version]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/version.php
[a-readme]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/README.md
[a-services]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/db/services.php
[a-external]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/externallib.php#L439
[a-external-session-schema]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/externallib.php#L378
[a-external-update]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/externallib.php#L525
[a-view]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/view.php
[a-view-params]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/view_page_params.php
[a-access]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/db/access.php
[a-user-data]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/output/user_data.php#L70
[a-renderer-user]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/output/renderer.php#L1337
[a-schema]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/db/install.xml
[a-summary]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/summary.php#L99
[a-local]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/locallib.php#L30
[a-fraction]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/locallib.php#L248
[a-grade-update]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/locallib.php#L342
[a-can-mark]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/locallib.php#L656
[a-mark]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/attendance.php#L110
[a-mobile]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/output/mobile.php#L128
[a-mobile-declarations]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/db/mobile.php
[a-take]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/structure.php#L708
[a-structure-status]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/structure.php#L1107
[a-automark]: https://github.com/danmarsden/moodle-mod_attendance/blob/d4095c8a4613a3812246590c7db871404b91fd3b/classes/local/automark.php#L96

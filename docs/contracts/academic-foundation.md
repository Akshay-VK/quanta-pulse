# Academic foundation (A0, contract version 1)

This is a local/synthetic foundation for [#65](https://github.com/Akshay-VK/quanta-pulse/issues/65) under the [approved specification](../specs/2026-11-21-search-and-academic-expansion.md). No deployed academic source, parser, domain UI, or unattended collection is enabled. V1 source/permission/polling evidence remains required. `collectorsEnabled` is always false; the scheduler does not call the new transport.

## Read authority

`academic_context`, `academic_assignments`, `academic_grades`, and `academic_attendance` are registered Tauri commands; only `src/lib/api.ts` invokes them. The three reads take `{ generation, courseId }`, where courseId is the existing local course identity. Route IDs remain distinct source facts: course-module, activity-instance, grade-item, calendar-event and stable attendance-session identities are never interchangeable. A weak-ID attendance report uses a source-supported scoped snapshot identity and null sessionId.

Each response includes `context: { contractVersion: 1, generation, owner, collectorsEnabled: false }`, courseId, records of the concrete domain type, and optional coverage. The owner is official origin plus positive Moodle user ID parsed by the production authentication verification operation from the final official self dashboard. Labels, candidate session metadata and saved account settings confer no ownership. Missing verified identity permits existing material authentication but leaves academics locked.

Only the active owner is readable. Every client installation, logout, account-change admission and session reset advances an opaque process-specific generation and cancels old academic reads. A failed account change remains locked. Restart starts locked until verification. Successful same-owner reconnect restores its retained partition and successful baselines. No migration adopts unowned legacy rows.

Commit and read hold the authority before SQLite, without awaiting under either lock. The commit checks generation and active authentication in the same critical section as its transaction; `publish_if_current` independently fences a synchronous private refresh publication. Its metadata contains domain/course/generation/change eligibility, never academic values. No academic event is routed into generic History, Inbox, notifications, Telegram, mirror or search.

Frontend API reads check the captured local epoch, response generation, owner, and a fresh backend context before returning. Account-change commands and the real App's auth-change handler synchronously invalidate the local authority. Consumers must use `useAcademicPage` (or `currentAcademicPage` for a synchronous application boundary), including for an already-resolved response: a Promise result alone is not continuing permission to display private data. No current view requests or renders these records.

## Persistence and coverage

Schema revision 9 adds separate assignment, grade and attendance tables plus per-origin/owner/course/domain coverage and baselines. Assignment observations have separate source and local material relationships, typed due values and source display values. Grades preserve source values, optional normalized numeric values, hierarchy and reported totals; no aggregate is calculated. Attendance preserves activity, optional session identity, explicit report scope and source status/points/summary strings. No universal Resource or untyped JSON entity is introduced.

Instants normalize to RFC3339 UTC. Date-only values stay calendar dates; ambiguous localized text stays ambiguous. ObservedAt, scope LastSuccessfulAt, current attempt coverage/reason, permission, visibility and stale state remain distinct. Unsupported/partial/denied/offline/cancelled/failed attempts do not consume first success. Complete committed first success is quiet; repeated identical values and reordered reports do not produce a change merely because observation time advanced.

Incomplete attempts do not replace a permissible snapshot with empty success. Complete assignment inventories replace their snapshot; grade omission is not withdrawal, and attendance observations upsert distinct source scopes. Confirmed domain denial scrubs private values and retains baseline/identity. Failures after denial cannot resurrect them. Explicit non-visible grade/attendance observations retain their visibility state with values scrubbed. A later explicit visible observation can restore the current value. There is no private historical browser. Coverage freshness describes the last attempt, alongside the actual success timestamp; it is not a promise about source completeness or a universal age threshold.

## Internal report operation

The explicit `academic::read_student_report` operation accepts only a typed candidate assignment/own grade/own attendance read and a generation; there is no arbitrary URL, action parameter, other-student selector, AJAX/mobile/staff endpoint or recursive traversal. IDs must be positive. HTML self reports omit userid/studentid, including zero. The shared cookie jar is retained, but a separate transport validates each redirect before requesting it. Only the exact original self-report target may be followed, at most three redirects; official login/auth destinations report expiry without fetching them. Off-origin, staff, submit, self-mark and mobile destinations are rejected before transmission.

A response is bounded to 1 MiB decoded bytes and ten seconds total across headers, body and redirects. Non-HTML, unsupported statuses and transport failures are typed failures. HTTP 403 without verified login evidence is optional denial; 401, official login redirect, or recognized Moodle login markup is expiry. Existing material HTTP/403/download semantics are unchanged. This operation returns transport facts, not parsed academic success, and cannot establish a baseline. Its callers must interpret and reconcile domain coverage when V1-backed collectors exist.

The operation reuses reset admission and in-flight preview draining, and checks generation again after HTTP. Logout/reset cancellation drops a delayed read before it can be returned or persisted. No credentials or raw report pages are stored as fixtures or logs; all fixtures are synthetic.

## Migration and rollback

Populated revision-8 and unversioned stores are consistently backed up with SQLite's backup API before migration, including same-app-version schema expansion. All migration steps and version/revision recording are atomic. Backup failure aborts before migration. Unreadable/unsupported/newer revision markers are rejected; known aliases cannot conceal a newer marker. Successful same-version/current-schema reopen is idempotent.

Rollback disables new consumers/collection and retains owner partitions. A revision-8 executable with the revision gate refuses revision 9; executable downgrade is not promised. Restore a verified consistent pre-migration backup when reverting the schema. Database backups preserve database indexes and state, not a second copy of externally retained mirror bytes. The migration never rewrites/deletes those files.

Verification and exact implementation SHAs are reported in the A0 handoff, including real temporary SQLite failures/restore and production HTTP/auth fixtures, frontend bridge/App fences, and the remaining live/native platform limits.

# B04A storage/query contract for B04B

**Status:** B04A implementation handoff. Base: `3b1a67ebd33a37966d4a88026d761c778e770d4a`.

## Public DTO and query

Rust and TypeScript use camelCase. `ScanCourseStatus` is exactly `success | partial | failed | cancelled`. `ScanDetails` is `{ scanId:number, courses:ScanCourseDetail[] }`; course detail has `courseId:number|null`, `courseName:string`, `status:ScanCourseStatus`, `startedAt:string`, `completedAt:string|null`, `steps:ScanStep[]`, `error:string|null`; step has `label:string`, same status union, `startedAt:string`, `completedAt:string|null`, `error:string|null`. Frontend: `api.scanDetails(scanId:number): Promise<ScanDetails|null>`.

`null` means no stored observation exists (legacy scans included). The query does not synthesize data. Missing scan IDs also return null. Stored courses and steps preserve the order supplied by the engine.

## Storage lifecycle

Migration 0007 creates a small per-scan JSON payload table linked to `scan_runs` with cascade deletion. It is additive, safe on populated databases, and idempotent. B04B calls `db::save_scan_details(conn, &details)` only after it has observed terminal details. The helper replaces the payload atomically for that scan and returns a database error if the scan does not exist or persistence fails. It does not mutate aggregate scan fields or fabricate observations. Existing scan-row deletion automatically removes details.

Errors and free-text fields are sanitized before storage; query sanitizes again before decoding/returning. URL-bearing strings and known credential/session markers are redacted. Raw JSON and returned DTO must not retain credentials, session tokens, or sensitive URL query values. Safe ordinary error text remains useful.

## B04B observation obligations

Provide only actually observed course/step starts and terminal results. Preserve failed, partial and cancelled observations. Do not infer course-level values from aggregate scan counts. Save terminal scan details with the helper; do not call it when there are no observed course results. Baseline material discovery stays silent as before. DB write failure is explicit `Err`; do not overwrite aggregate scan status/counts to hide it.

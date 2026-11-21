-- Private, owner-partitioned domain observations. No links into material events,
-- mirror jobs, search or generic notification records.
CREATE TABLE IF NOT EXISTS academic_coverage (
 origin TEXT NOT NULL, owner_id INTEGER NOT NULL CHECK(owner_id > 0),
 course_id INTEGER NOT NULL, domain TEXT NOT NULL CHECK(domain IN ('assignments','grades','attendance')),
 coverage TEXT NOT NULL, observed_at TEXT NOT NULL, last_successful_at TEXT,
 baseline INTEGER NOT NULL DEFAULT 0, fingerprint TEXT, permission TEXT NOT NULL DEFAULT 'unknown',
 PRIMARY KEY(origin, owner_id, course_id, domain)
);
CREATE TABLE IF NOT EXISTS academic_assignments (
 origin TEXT NOT NULL, owner_id INTEGER NOT NULL, course_id INTEGER NOT NULL,
 source_id TEXT NOT NULL, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, visibility TEXT NOT NULL,
 title TEXT NOT NULL, course_module_id INTEGER, activity_instance_id INTEGER, resource_id INTEGER,
 due_value TEXT NOT NULL, submission_status TEXT NOT NULL, attempt_number INTEGER,
 due_display TEXT, submission_display TEXT, calendar_event_id INTEGER,
 PRIMARY KEY(origin, owner_id, course_id, source_id)
);
CREATE TABLE IF NOT EXISTS academic_grades (
 origin TEXT NOT NULL, owner_id INTEGER NOT NULL, course_id INTEGER NOT NULL,
 source_id TEXT NOT NULL, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, visibility TEXT NOT NULL,
 title TEXT NOT NULL, grade_item_id INTEGER, parent_source_id TEXT, item_kind TEXT NOT NULL,
 display_value TEXT, numeric_value REAL, range_display TEXT, weight_display TEXT, feedback TEXT,
 PRIMARY KEY(origin, owner_id, course_id, source_id)
);
CREATE TABLE IF NOT EXISTS academic_attendance (
 origin TEXT NOT NULL, owner_id INTEGER NOT NULL, course_id INTEGER NOT NULL,
 source_id TEXT NOT NULL, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, visibility TEXT NOT NULL,
 activity_instance_id INTEGER NOT NULL, session_id INTEGER, scope_display TEXT NOT NULL,
 status_display TEXT, points_display TEXT, maximum_display TEXT, summary_display TEXT, course_module_id INTEGER,
 PRIMARY KEY(origin, owner_id, course_id, source_id)
);

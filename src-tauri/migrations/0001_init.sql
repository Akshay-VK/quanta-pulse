-- Quanta Pulse schema, migration 0001.
-- All timestamps are stored as RFC 3339 UTC strings.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Dashboard Clear All hides the current deadline/unavailable snapshot without
-- deleting the underlying resource rows. New change events remain eligible.
CREATE TABLE IF NOT EXISTS dashboard_cleared_resources (
  resource_id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS courses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  external_course_id TEXT    NOT NULL UNIQUE,
  name               TEXT    NOT NULL,
  short_name         TEXT,
  url                TEXT    NOT NULL,
  first_seen_at      TEXT    NOT NULL,
  last_scanned_at    TEXT,
  last_scan_status   TEXT,
  monitoring_status  TEXT    NOT NULL DEFAULT 'monitored'
);

CREATE TABLE IF NOT EXISTS resources (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  external_resource_id TEXT    NOT NULL UNIQUE,
  course_id            INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  title                TEXT    NOT NULL,
  url                  TEXT    NOT NULL,
  source_page_url      TEXT,
  resource_type        TEXT    NOT NULL,
  uploaded_at          TEXT,
  published_at         TEXT,
  modified_at          TEXT,
  due_at               TEXT,
  first_seen_at        TEXT    NOT NULL,
  last_seen_at         TEXT,
  last_checked_at      TEXT,
  content_fingerprint  TEXT,
  availability_status  TEXT    NOT NULL DEFAULT 'available',
  size_bytes           INTEGER,
  section              TEXT,
  section_path         TEXT,
  miss_streak          INTEGER NOT NULL DEFAULT 0,
  is_external          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS change_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id       INTEGER REFERENCES resources(id) ON DELETE CASCADE,
  course_id         INTEGER,
  change_type       TEXT    NOT NULL,
  title             TEXT    NOT NULL,
  description       TEXT,
  detected_at       TEXT    NOT NULL,
  read_at           TEXT,
  notified_at       TEXT,
  deduplication_key TEXT    NOT NULL UNIQUE,
  calendar_suppressed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT    NOT NULL,
  completed_at      TEXT,
  status            TEXT    NOT NULL,
  discovered_count  INTEGER NOT NULL DEFAULT 0,
  new_count         INTEGER NOT NULL DEFAULT 0,
  updated_count     INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  courses_scanned   INTEGER NOT NULL DEFAULT 0,
  courses_failed    INTEGER NOT NULL DEFAULT 0,
  error_summary     TEXT,
  is_baseline       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_resources_course   ON resources(course_id);
CREATE INDEX IF NOT EXISTS idx_resources_avail    ON resources(availability_status);
CREATE INDEX IF NOT EXISTS idx_resources_lastseen ON resources(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_events_detected    ON change_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_unread      ON change_events(read_at);
CREATE INDEX IF NOT EXISTS idx_scans_started      ON scan_runs(started_at DESC);

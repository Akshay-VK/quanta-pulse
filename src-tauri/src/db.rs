//! SQLite persistence.
//!
//! The database lives in the macOS Application Support directory, never in the
//! repository or a build directory. All writes that mutate several rows happen
//! inside a transaction so an interrupted scan cannot leave a half-updated
//! inventory.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{
    ChangeEvent, Course, Digest, HistoryFilter, HistoryPage, Resource, ScanDetails, ScanFilter,
    ScanPage, ScanRun,
};
use crate::settings::Settings;

/// Current UTC time as an RFC 3339 string.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// The settings key that records the last app version that ran against this
/// database. Written after every successful migration.
pub const LAST_APP_VERSION_KEY: &str = "last_app_version";

/// Settings key recording the schema revision this database has been migrated to.
pub const SCHEMA_REVISION_KEY: &str = "schema_revision";

/// The schema revision produced by the current `migrate` implementation.
pub const CURRENT_SCHEMA_REVISION: i64 = 8;

/// How many pre-migration backups to keep.
const BACKUP_KEEP: usize = 3;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    upgrade(&conn, path, env!("CARGO_PKG_VERSION"))
        .map_err(|e| rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(1), Some(e)))?;
    Ok(conn)
}

/// Prepare a database for the running app version: back up before migrating an
/// upgrade, run the migration, then record the version.
///
/// The backup is taken with the SQLite backup API, so it is consistent even
/// though the source is an open WAL database. When the backup fails the
/// migration is aborted and the error says why — an un-migrated, unmodified
/// database is safer than a migrated one nobody can roll back to.
pub fn upgrade(conn: &Connection, db_path: &Path, app_version: &str) -> Result<(), String> {
    let recorded_version = get_kv(conn, LAST_APP_VERSION_KEY);
    let recorded_schema = recorded_schema_revision(conn);
    let has_tables = has_user_tables(conn);

    // A database created by a newer, unsupported build must not be migrated
    // backward. Refuse before touching it or taking a backup.
    if let Some(schema) = recorded_schema {
        if schema > CURRENT_SCHEMA_REVISION {
            return Err(format!(
                "database schema revision {schema} is newer than this app supports ({CURRENT_SCHEMA_REVISION})"
            ));
        }
    }

    // A missing revision is treated as "already current" for backup purposes:
    // existing stores migrated by older code lack the key, and forcing a backup
    // on every same-version startup would violate the no-unnecessary-backup rule.
    // An explicitly lower revision (a pending migration) does require a backup.
    let schema_pending = match recorded_schema {
        Some(revision) => revision < CURRENT_SCHEMA_REVISION,
        None => false,
    };
    let version_older = match &recorded_version {
        None => has_tables,
        Some(v) if v == app_version => false,
        Some(v) => version_is_older(v, app_version),
    };

    // Back up a populated store before any pending migration. A matching
    // version with the current schema needs nothing; a fresh database has
    // nothing to lose.
    let needs_backup = has_tables && (schema_pending || version_older);
    let old_version = if needs_backup {
        Some(recorded_version.clone().unwrap_or_else(|| "unknown".to_string()))
    } else {
        None
    };

    if let Some(old) = old_version {
        backup_database(conn, db_path, &old)?;
    }

    migrate(conn).map_err(|e| e.to_string())?;
    set_kv(conn, LAST_APP_VERSION_KEY, app_version).map_err(|e| e.to_string())?;
    set_kv(conn, SCHEMA_REVISION_KEY, &CURRENT_SCHEMA_REVISION.to_string())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the recorded schema revision, accepting the documented key spellings.
fn recorded_schema_revision(conn: &Connection) -> Option<i64> {
    for key in [SCHEMA_REVISION_KEY, "db_schema_revision", "schema_version"] {
        if let Some(value) = get_kv(conn, key) {
            if let Ok(revision) = value.trim().parse::<i64>() {
                return Some(revision);
            }
        }
    }
    None
}

/// Whether `recorded` is semantically older than `running`. Unknown or
/// unparseable recorded versions are treated as older so a legacy store is
/// protected before migration.
fn version_is_older(recorded: &str, running: &str) -> bool {
    if recorded.trim().eq_ignore_ascii_case("unknown") {
        return true;
    }
    let Some((recorded_main, recorded_pre)) = parse_semver(recorded) else {
        return true;
    };
    let Some((running_main, running_pre)) = parse_semver(running) else {
        // Fall back to lexical comparison only when the running label is not
        // parseable, preserving a conservative backup.
        return recorded < running;
    };
    if recorded_main != running_main {
        return recorded_main < running_main;
    }
    // A release is newer than any of its pre-releases.
    match (recorded_pre, running_pre) {
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (Some(a), Some(b)) => compare_prerelease(&a, &b).is_lt(),
        (None, None) => false,
    }
}

/// Compare dotted prerelease identifiers using numeric precedence, with
/// numeric identifiers ordered before text and a shorter equal prefix first.
fn compare_prerelease(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let mut left = left.split('.');
    let mut right = right.split('.');
    loop {
        let (left, right) = match (left.next(), right.next()) {
            (Some(left), Some(right)) => (left, right),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (None, None) => return Ordering::Equal,
        };
        let numeric = |value: &str| !value.is_empty() && value.bytes().all(|c| c.is_ascii_digit());
        let order = match (numeric(left), numeric(right)) {
            (true, true) => {
                // Compare by digit count to avoid overflowing on a legal large identifier.
                let left = left.trim_start_matches('0');
                let right = right.trim_start_matches('0');
                left.len().cmp(&right.len()).then_with(|| left.cmp(right))
            }
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            (false, false) => left.cmp(right),
        };
        if order != Ordering::Equal {
            return order;
        }
    }
}

fn parse_semver(value: &str) -> Option<(Vec<u64>, Option<String>)> {
    let value = value.trim().split('+').next()?;
    if value.is_empty() {
        return None;
    }
    let (main, pre) = match value.split_once('-') {
        Some((m, p)) => (m, Some(p.to_string())),
        None => (value, None),
    };
    let mut parts = Vec::new();
    for part in main.split('.') {
        // Allow a leading 'v'.
        let part = part.trim_start_matches('v');
        if part.is_empty() {
            parts.push(0);
            continue;
        }
        // Stop at the first non-digit so "1.2.3-rc" style without dash still works.
        let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            return None;
        }
        parts.push(digits.parse::<u64>().ok()?);
    }
    if parts.is_empty() {
        return None;
    }
    Some((parts, pre))
}

/// Whether the database holds any user tables (i.e. it is not freshly created).
fn has_user_tables(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .unwrap_or(false)
}

/// Write a consistent copy of the database to `<app data>/backups/` and keep the
/// newest `BACKUP_KEEP` backups.
fn backup_database(conn: &Connection, db_path: &Path, old_version: &str) -> Result<(), String> {
    let parent = db_path
        .parent()
        .ok_or_else(|| "the database path has no parent".to_string())?;
    let backups = parent.join("backups");
    std::fs::create_dir_all(&backups)
        .map_err(|e| format!("cannot create backups directory {}: {e}", backups.display()))?;

    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let dest = backups.join(format!("quanta-pulse-{old_version}-{stamp}.db"));
    conn.backup(rusqlite::DatabaseName::Main, &dest, None)
        .map_err(|e| {
            format!(
                "backup before migration failed: {e}. Free up space in {} and try again.",
                backups.display()
            )
        })?;

    prune_backups(&backups)?;
    Ok(())
}

/// Remove all but the newest `BACKUP_KEEP` backups in `dir`.
fn prune_backups(dir: &Path) -> Result<(), String> {
    let mut entries: Vec<(std::path::PathBuf, std::time::SystemTime)> = std::fs::read_dir(dir)
        .map_err(|e| format!("cannot read backups directory: {e}"))?
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let meta = path.metadata().ok()?;
            Some((path, meta.modified().ok()?))
        })
        .filter(|(path, _)| path.extension().is_some_and(|ext| ext == "db"))
        .collect();
    entries.sort_by_key(|(_, modified)| *modified);
    while entries.len() > BACKUP_KEEP {
        let (oldest, _) = entries.remove(0);
        std::fs::remove_file(&oldest).map_err(|e| {
            format!("cannot remove old backup {}: {e}", oldest.display())
        })?;
    }
    Ok(())
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    const MIGRATION: &str = include_str!("../migrations/0001_init.sql");
    conn.execute_batch(MIGRATION)?;

    // 0002: the listing page where each resource's link was discovered. Fresh
    // databases get the column from the updated 0001 migration; databases
    // created before it need it added idempotently.
    let has_source_page: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('resources') WHERE name = 'source_page_url'",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0;
    if !has_source_page {
        conn.execute_batch("ALTER TABLE resources ADD COLUMN source_page_url TEXT")?;
    }
    let has_section_path: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('resources') WHERE name = 'section_path'",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0;
    if !has_section_path {
        conn.execute_batch("ALTER TABLE resources ADD COLUMN section_path TEXT")?;
    }
    let has_calendar_suppressed: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('change_events') WHERE name = 'calendar_suppressed'",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0;
    if !has_calendar_suppressed {
        conn.execute_batch(
            "ALTER TABLE change_events ADD COLUMN calendar_suppressed INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    // Backfill only where the legacy row has a known section. Rows without
    // one stay null and are exposed as an unknown/pending location.
    let legacy_sections = {
        let mut stmt = conn.prepare(
            "SELECT id, section FROM resources WHERE section_path IS NULL AND section IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, section) in legacy_sections {
        let path = serde_json::to_string(&[section]).unwrap_or_else(|_| "[]".into());
        conn.execute("UPDATE resources SET section_path = ?1 WHERE id = ?2", params![path, id])?;
    }

    // 0003: folder/section placement is mutable presentation metadata, not a
    // resource-content change. Re-hash stored rows once to the v2 fingerprint
    // before the next sync so changing the fingerprint inputs cannot generate
    // a one-time wave of false "updated" events.
    upgrade_resource_fingerprints(conn)?;

    // 0004: suppress only the known course-tree refresh event batch. The
    // persisted marker makes this one-time; normal future event queries use
    // the event flag, with no rolling timestamp rule.
    apply_course_tree_incident_cleanup(conn, &now_rfc3339())?;
    conn.execute_batch(include_str!("../migrations/0005_inbox_dismissals.sql"))?;
    // 0006: add the durable local presentation override to existing databases.
    let has_display_name: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('courses') WHERE name = 'display_name'",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0;
    if !has_display_name {
        conn.execute_batch(include_str!("../migrations/0006_course_display_name.sql"))?;
    }
    // 0007: old scan rows intentionally have no synthesized course details.
    conn.execute_batch(include_str!("../migrations/0007_scan_details.sql"))?;
    // 0008: scan failure notifications are claimed on the durable scan row.
    let has_failure_notification_claim: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('scan_runs') WHERE name = 'failure_notified_at'",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0;
    if !has_failure_notification_claim {
        conn.execute_batch(include_str!("../migrations/0008_scan_failure_notifications.sql"))?;
    }
    Ok(())
}

const RESOURCE_FINGERPRINT_V2_KEY: &str = "migration_resource_fingerprint_v2";
const COURSE_TREE_CALENDAR_CLEANUP_KEY: &str = "migration_calendar_course_tree_incident_2026_10_12";
const COURSE_TREE_INCIDENT_COMPLETED_AT: &str = "2026-10-12T12:12:13Z";
const DASHBOARD_CLEAR_EVENT_ID_KEY: &str = "dashboard_clear_event_id";
const HISTORY_CLEAR_EVENT_ID_KEY: &str = "history_clear_event_id";
const HISTORY_CLEAR_SCAN_ID_KEY: &str = "history_clear_scan_id";

fn upgrade_resource_fingerprints(conn: &Connection) -> rusqlite::Result<()> {
    if get_kv(conn, RESOURCE_FINGERPRINT_V2_KEY).is_some() {
        return Ok(());
    }
    let has_fingerprint: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('resources') WHERE name = 'content_fingerprint'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !has_fingerprint {
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)",
            params![RESOURCE_FINGERPRINT_V2_KEY, "completed"],
        )?;
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    let rows = {
        let mut stmt = tx.prepare(
            "SELECT id, title, resource_type, uploaded_at, published_at,
                    modified_at, due_at, size_bytes, content_fingerprint
             FROM resources",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    {
        let mut stmt = tx.prepare("UPDATE resources SET content_fingerprint = ?1 WHERE id = ?2")?;
        for (id, title, resource_type, uploaded, published, modified, due, size, old_fingerprint) in rows {
            // Null means the resource was deliberately stored without a
            // fingerprint. Keep that lack of evidence unchanged.
            if old_fingerprint.is_none() {
                continue;
            }
            let fingerprint = crate::quanta::content_fingerprint(
                &title,
                &resource_type,
                uploaded.as_deref(),
                published.as_deref(),
                modified.as_deref(),
                due.as_deref(),
                size,
            );
            stmt.execute(params![fingerprint, id])?;
        }
    }
    tx.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)",
        params![RESOURCE_FINGERPRINT_V2_KEY, "completed"],
    )?;
    tx.commit()
}

fn apply_course_tree_incident_cleanup(conn: &Connection, now: &str) -> rusqlite::Result<()> {
    if get_kv(conn, COURSE_TREE_CALENDAR_CLEANUP_KEY).is_some() {
        return Ok(());
    }
    let current = chrono::DateTime::parse_from_rfc3339(now)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?
        .with_timezone(&chrono::Utc);
    let cutoff = (current - chrono::Duration::hours(12))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE change_events
         SET calendar_suppressed = 1
         WHERE detected_at = ?1
           AND change_type IN ('new', 'updated', 'announcement')
           AND resource_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM scan_runs s
             WHERE s.completed_at = ?1 AND s.status = 'ok'
           )
           AND EXISTS (
             SELECT 1 FROM resources r
             WHERE r.id = change_events.resource_id AND r.first_seen_at < ?2
           )",
        params![COURSE_TREE_INCIDENT_COMPLETED_AT, cutoff],
    )? as i64;
    let suppressed_new = count_suppressed_incident_events(&tx, "new")?
        + count_suppressed_incident_events(&tx, "announcement")?;
    let suppressed_updated = count_suppressed_incident_events(&tx, "updated")?;
    let retained: i64 = tx.query_row(
        "SELECT COUNT(*) FROM change_events e
         JOIN resources r ON r.id = e.resource_id
         WHERE e.detected_at = ?1
           AND e.change_type IN ('new', 'updated', 'announcement')
           AND r.first_seen_at >= ?2
           AND EXISTS (
             SELECT 1 FROM scan_runs s
             WHERE s.completed_at = ?1 AND s.status = 'ok'
           )",
        params![COURSE_TREE_INCIDENT_COMPLETED_AT, cutoff],
        |row| row.get(0),
    )?;
    tx.execute(
        "UPDATE scan_runs
         SET new_count = MAX(0, new_count - ?1),
             updated_count = MAX(0, updated_count - ?2)
         WHERE completed_at = ?3",
        params![suppressed_new, suppressed_updated, COURSE_TREE_INCIDENT_COMPLETED_AT],
    )?;

    let marker = serde_json::json!({
        "completedAt": now,
        "cutoff": cutoff,
        "incidentCompletedAt": COURSE_TREE_INCIDENT_COMPLETED_AT,
        "suppressedEvents": changed,
        "retainedEvents": retained,
    })
    .to_string();
    tx.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)",
        params![COURSE_TREE_CALENDAR_CLEANUP_KEY, marker],
    )?;
    tx.commit()
}

fn count_suppressed_incident_events(conn: &Connection, change_type: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM change_events
         WHERE detected_at = ?1 AND change_type = ?2 AND calendar_suppressed = 1",
        params![COURSE_TREE_INCIDENT_COMPLETED_AT, change_type],
        |row| row.get(0),
    )
}

/* ------------------------------------------------------------------ settings */

pub fn load_settings(conn: &Connection) -> Settings {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| r.get(0))
        .optional()
        .ok()
        .flatten();
    raw.and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(conn: &Connection, settings: &Settings) -> rusqlite::Result<()> {
    let json = serde_json::to_string(settings).unwrap_or_else(|_| "{}".into());
    conn.execute(
        "INSERT INTO settings(key, value) VALUES('app', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )?;
    Ok(())
}

pub fn get_kv(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

pub fn set_kv(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn del_kv(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

/// Persist a baseline reset request and its generation as one operation.
/// Missing generations are treated as zero for databases created before this
/// request identity was added.
pub fn request_baseline_reset(
    conn: &mut Connection,
    course_id: Option<i64>,
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;
    let generation = get_kv(&tx, "baseline_reset_generation")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| rusqlite::Error::InvalidQuery)?;

    if let Some(id) = course_id {
        let existing = get_kv(&tx, "rebaseline_courses").unwrap_or_else(|| "[]".into());
        let mut list: Vec<i64> = serde_json::from_str(&existing).unwrap_or_default();
        if !list.contains(&id) {
            list.push(id);
        }
        set_kv(
            &tx,
            "rebaseline_courses",
            &serde_json::to_string(&list).expect("course IDs always serialize"),
        )?;
    } else {
        del_kv(&tx, "baseline_established")?;
        set_kv(
            &tx,
            "baseline_global_reset_generation",
            &generation.to_string(),
        )?;
    }
    set_kv(&tx, "baseline_reset_generation", &generation.to_string())?;
    tx.commit()?;
    Ok(generation)
}

/// Establish the global baseline only if no newer global reset was requested.
pub fn establish_baseline_if_generation(
    conn: &mut Connection,
    captured_generation: i64,
    established_at: &str,
) -> rusqlite::Result<bool> {
    let tx = conn.transaction()?;
    let current_generation = get_kv(&tx, "baseline_global_reset_generation")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    if current_generation != captured_generation {
        tx.rollback()?;
        return Ok(false);
    }
    set_kv(&tx, "baseline_established", established_at)?;
    tx.commit()?;
    Ok(true)
}

/* ------------------------------------------------------------------- courses */

pub fn upsert_course(
    conn: &Connection,
    external_id: &str,
    name: &str,
    short_name: Option<&str>,
    url: &str,
    now: &str,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO courses(external_course_id, name, short_name, url, first_seen_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(external_course_id) DO UPDATE SET
            name = excluded.name,
            short_name = COALESCE(excluded.short_name, courses.short_name),
            url = excluded.url",
        params![external_id, name, short_name, url, now],
    )?;
    conn.query_row(
        "SELECT id FROM courses WHERE external_course_id = ?1",
        params![external_id],
        |r| r.get(0),
    )
}

pub fn mark_course_scanned(
    conn: &Connection,
    course_id: i64,
    at: &str,
    status: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE courses SET last_scanned_at = ?1, last_scan_status = ?2 WHERE id = ?3",
        params![at, status, course_id],
    )?;
    Ok(())
}

pub fn set_monitoring(conn: &Connection, course_id: i64, status: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE courses SET monitoring_status = ?1 WHERE id = ?2",
        params![status, course_id],
    )?;
    Ok(())
}

/// Set or reset a local display-name override without changing source identity.
pub fn set_course_display_name(
    conn: &Connection,
    course_id: i64,
    display_name: Option<&str>,
) -> Result<Course, String> {
    let display_name = match display_name {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err("Course display name cannot be empty.".to_string());
            }
            if trimmed.chars().count() > 120 {
                return Err("Course display name cannot exceed 120 characters.".to_string());
            }
            Some(trimmed)
        }
        None => None,
    };
    let changed = conn
        .execute(
            "UPDATE courses SET display_name = ?1 WHERE id = ?2",
            params![display_name, course_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Course not found.".to_string());
    }
    list_courses(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|course| course.id == course_id)
        .ok_or_else(|| "Course not found.".to_string())
}

pub fn course_id_for_external(conn: &Connection, external_id: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM courses WHERE external_course_id = ?1",
        params![external_id],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn list_courses(conn: &Connection) -> rusqlite::Result<Vec<Course>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.external_course_id, c.name, c.short_name, c.display_name, c.url, c.first_seen_at,
                c.last_scanned_at, c.last_scan_status, c.monitoring_status,
                (SELECT COUNT(*) FROM resources r WHERE r.course_id = c.id) AS resource_count
         FROM courses c
         ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Course {
            id: r.get(0)?,
            external_course_id: r.get(1)?,
            name: r.get(2)?,
            short_name: r.get(3)?,
            display_name: r.get(4)?,
            url: r.get(5)?,
            first_seen_at: r.get(6)?,
            last_scanned_at: r.get(7)?,
            last_scan_status: r.get(8)?,
            monitoring_status: r.get(9)?,
            resource_count: r.get(10)?,
        })
    })?;
    rows.collect()
}

pub fn count_courses(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM courses", [], |r| r.get(0))
        .unwrap_or(0)
}

/// Row ids of courses whose monitoring is paused. Change events are suppressed
/// for these courses while their history is retained.
pub fn paused_course_ids(conn: &Connection) -> Vec<i64> {
    let Ok(mut stmt) = conn.prepare("SELECT id FROM courses WHERE monitoring_status = 'paused'") else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |r| r.get(0)) else {
        return Vec::new();
    };
    rows.filter_map(|r| r.ok()).collect()
}

/* ----------------------------------------------------------------- resources */

pub struct ResourceWrite<'a> {
    pub external_id: &'a str,
    pub course_id: Option<i64>,
    pub title: &'a str,
    pub url: &'a str,
    /// Page where the resource's link was listed during discovery. Null when
    /// discovery could not attribute a listing page.
    pub source_page_url: Option<&'a str>,
    pub resource_type: &'a str,
    pub uploaded_at: Option<&'a str>,
    pub published_at: Option<&'a str>,
    pub modified_at: Option<&'a str>,
    pub due_at: Option<&'a str>,
    pub fingerprint: &'a str,
    pub size_bytes: Option<i64>,
    pub section: Option<&'a str>,
    pub section_path: Option<&'a str>,
    pub is_external: bool,
    pub availability: &'a str,
}

/// Insert or refresh a resource, returning its row id.
///
/// `uploaded_at`/`published_at` are only overwritten when the new value is
/// non-null, so a temporarily missing timestamp never erases known history.
pub fn upsert_resource(
    conn: &Connection,
    w: &ResourceWrite<'_>,
    now: &str,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO resources(
            external_resource_id, course_id, title, url, resource_type,
            uploaded_at, published_at, modified_at, due_at,
            first_seen_at, last_seen_at, last_checked_at, content_fingerprint,
            availability_status, size_bytes, section, miss_streak, is_external,
            source_page_url, section_path)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?10, ?11, ?12, ?13, ?14, 0, ?15, ?16, ?17)
         ON CONFLICT(external_resource_id) DO UPDATE SET
            course_id = excluded.course_id,
            title = excluded.title,
            url = excluded.url,
            resource_type = excluded.resource_type,
            source_page_url = COALESCE(excluded.source_page_url, resources.source_page_url),
            uploaded_at = COALESCE(excluded.uploaded_at, resources.uploaded_at),
            published_at = COALESCE(excluded.published_at, resources.published_at),
            modified_at = excluded.modified_at,
            due_at = excluded.due_at,
            last_seen_at = excluded.last_seen_at,
            last_checked_at = excluded.last_checked_at,
            content_fingerprint = excluded.content_fingerprint,
            availability_status = excluded.availability_status,
            size_bytes = COALESCE(excluded.size_bytes, resources.size_bytes),
            section = excluded.section,
            section_path = COALESCE(excluded.section_path, resources.section_path),
            miss_streak = 0",
        params![
            w.external_id,
            w.course_id,
            w.title,
            w.url,
            w.resource_type,
            w.uploaded_at,
            w.published_at,
            w.modified_at,
            w.due_at,
            now,
            w.fingerprint,
            w.availability,
            w.size_bytes,
            w.section,
            w.is_external as i64,
            w.source_page_url,
            w.section_path,
        ],
    )?;
    conn.query_row(
        "SELECT id FROM resources WHERE external_resource_id = ?1",
        params![w.external_id],
        |r| r.get(0),
    )
}

pub fn get_resource(conn: &Connection, external_id: &str) -> Option<Resource> {
    conn.query_row(
        "SELECT r.id, r.external_resource_id, r.course_id, c.name, r.title, r.url, r.resource_type,
                r.uploaded_at, r.published_at, r.modified_at, r.due_at, r.first_seen_at,
                r.last_seen_at, r.last_checked_at, r.content_fingerprint, r.availability_status,
                r.size_bytes, r.section, r.is_external, r.source_page_url, r.section_path
         FROM resources r LEFT JOIN courses c ON c.id = r.course_id
         WHERE r.external_resource_id = ?1",
        params![external_id],
        map_resource,
    )
    .optional()
    .ok()
    .flatten()
}

/// Look up a single resource by its local row id. Used by the on-demand
/// preview command, which needs the stored metadata (type + URLs) but nothing
/// that a full listing would provide.
pub fn get_resource_by_id(conn: &Connection, id: i64) -> Option<Resource> {
    conn.query_row(
        "SELECT r.id, r.external_resource_id, r.course_id, c.name, r.title, r.url, r.resource_type,
                r.uploaded_at, r.published_at, r.modified_at, r.due_at, r.first_seen_at,
                r.last_seen_at, r.last_checked_at, r.content_fingerprint, r.availability_status,
                r.size_bytes, r.section, r.is_external, r.source_page_url, r.section_path
         FROM resources r LEFT JOIN courses c ON c.id = r.course_id
         WHERE r.id = ?1",
        params![id],
        map_resource,
    )
    .optional()
    .ok()
    .flatten()
}

fn map_resource(r: &rusqlite::Row<'_>) -> rusqlite::Result<Resource> {
    Ok(Resource {
        id: r.get(0)?,
        external_resource_id: r.get(1)?,
        course_id: r.get(2)?,
        course_name: r.get(3)?,
        title: r.get(4)?,
        url: r.get(5)?,
        resource_type: r.get(6)?,
        uploaded_at: r.get(7)?,
        published_at: r.get(8)?,
        modified_at: r.get(9)?,
        due_at: r.get(10)?,
        first_seen_at: r.get(11)?,
        last_seen_at: r.get(12)?,
        last_checked_at: r.get(13)?,
        content_fingerprint: r.get(14)?,
        availability_status: r.get(15)?,
        size_bytes: r.get(16)?,
        section: r.get(17)?,
        is_external: r.get::<_, i64>(18)? != 0,
        source_page_url: r.get(19)?,
        section_path: r
            .get::<_, Option<String>>(20)?
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_else(|| r.get::<_, Option<String>>(17).ok().flatten().into_iter().collect()),
    })
}

#[derive(Debug, Clone, Default)]
pub struct ResourceFilter {
    pub course_id: Option<i64>,
    pub search: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub fn list_resources(conn: &Connection, f: &ResourceFilter) -> rusqlite::Result<Vec<Resource>> {
    let mut sql = String::from(
        "SELECT r.id, r.external_resource_id, r.course_id, c.name, r.title, r.url, r.resource_type,
                r.uploaded_at, r.published_at, r.modified_at, r.due_at, r.first_seen_at,
                r.last_seen_at, r.last_checked_at, r.content_fingerprint, r.availability_status,
                r.size_bytes, r.section, r.is_external, r.source_page_url, r.section_path
         FROM resources r LEFT JOIN courses c ON c.id = r.course_id WHERE 1=1",
    );

    // A named placeholder must only appear in the SQL when it is also bound:
    // rusqlite rejects binding a parameter the statement does not declare with
    // `Invalid parameter name: :course`. So the condition and the binding below
    // are added together, and never independently.
    let course_param = f.course_id;
    let search_param = f
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    if course_param.is_some() {
        sql.push_str(" AND r.course_id = :course");
    }
    if search_param.is_some() {
        sql.push_str(" AND (r.title LIKE :search OR c.name LIKE :search)");
    }
    match f.kind.as_deref() {
        Some("unavailable") => sql.push_str(" AND r.availability_status <> 'available'"),
        Some("deadlines") => sql.push_str(" AND r.due_at IS NOT NULL"),
        Some("new") => sql.push_str(
            " AND EXISTS(SELECT 1 FROM change_events e WHERE e.resource_id = r.id AND e.change_type IN ('new','announcement') AND e.calendar_suppressed = 0)",
        ),
        Some("updated") => sql.push_str(
            " AND EXISTS(SELECT 1 FROM change_events e WHERE e.resource_id = r.id AND e.change_type = 'updated' AND e.calendar_suppressed = 0)",
        ),
        _ => {}
    }
    // Source timestamps first (upload > published > modified), then the local
    // detection timestamp. `last_seen_at` is a scan time — never a sort key.
    sql.push_str(
        " ORDER BY COALESCE(r.uploaded_at, r.published_at, r.modified_at, r.first_seen_at) DESC, r.title COLLATE NOCASE, r.id",
    );
    sql.push_str(" LIMIT :limit OFFSET :offset");

    let limit = f.limit.unwrap_or(500);
    let offset = f.offset.unwrap_or(0);

    // Bind only what the statement actually references, in the same order the
    // placeholders were appended above.
    let mut binds: Vec<(&str, &dyn rusqlite::ToSql)> = Vec::new();
    if let Some(course) = &course_param {
        binds.push((":course", course));
    }
    if let Some(search) = &search_param {
        binds.push((":search", search));
    }
    binds.push((":limit", &limit));
    binds.push((":offset", &offset));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(binds.as_slice(), map_resource)?;
    rows.collect()
}

pub fn count_resources(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM resources", [], |r| r.get(0))
        .unwrap_or(0)
}

pub fn count_events(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM change_events", [], |r| r.get(0))
        .unwrap_or(0)
}

fn clear_watermark(conn: &Connection, key: &str) -> i64 {
    get_kv(conn, key)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
}

/// Persist a Dashboard-specific clear point. Old events stay in the canonical
/// event log, while current deadline/unavailable rows are snapshotted by ID so
/// they do not reappear just because the resource itself still exists.
pub fn clear_dashboard_activity(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let watermark: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM change_events",
        [],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![DASHBOARD_CLEAR_EVENT_ID_KEY, watermark.to_string()],
    )?;
    tx.execute("DELETE FROM dashboard_cleared_resources", [])?;
    tx.execute(
        "INSERT INTO dashboard_cleared_resources(resource_id)
         SELECT id FROM resources
         WHERE due_at IS NOT NULL OR availability_status <> 'available'",
        [],
    )?;
    tx.commit()
}

/// Clear the History view with independent event and scan watermarks. The
/// corresponding rows remain available to Calendar, digests and diagnostics.
pub fn clear_history_activity(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let event_watermark: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM change_events",
        [],
        |row| row.get(0),
    )?;
    let scan_watermark: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM scan_runs",
        [],
        |row| row.get(0),
    )?;
    for (key, value) in [
        (HISTORY_CLEAR_EVENT_ID_KEY, event_watermark),
        (HISTORY_CLEAR_SCAN_ID_KEY, scan_watermark),
    ] {
        tx.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value.to_string()],
        )?;
    }
    tx.commit()
}

pub fn list_dashboard_events(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<ChangeEvent>> {
    list_events_after_id(conn, clear_watermark(conn, DASHBOARD_CLEAR_EVENT_ID_KEY), limit)
}

pub fn list_history_events(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<ChangeEvent>> {
    list_events_after_id(conn, clear_watermark(conn, HISTORY_CLEAR_EVENT_ID_KEY), limit)
}

fn history_page_bounds(offset: usize, limit: usize) -> Result<(i64, i64), String> {
    if !(1..=1000).contains(&limit) {
        return Err("limit must be between 1 and 1000".into());
    }
    let offset = i64::try_from(offset).map_err(|_| "offset is too large".to_string())?;
    let limit = i64::try_from(limit).map_err(|_| "limit is too large".to_string())?;
    Ok((offset, limit))
}

fn history_bound(raw: &Option<String>, label: &str) -> Result<Option<chrono::DateTime<chrono::Utc>>, String> {
    raw.as_ref()
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value)
                .map(|date| date.with_timezone(&chrono::Utc))
                .map_err(|_| format!("{label} must be an RFC 3339 timestamp"))
        })
        .transpose()
}

/// Query complete History activity before slicing a page. History's clear
/// watermark and calendar suppression remain view-specific visibility rules.
pub fn query_history_events(
    conn: &Connection,
    filter: &HistoryFilter,
) -> Result<HistoryPage, String> {
    let (offset, limit) = history_page_bounds(filter.offset, filter.limit)?;
    if filter.course_id.is_some_and(|id| id <= 0) {
        return Err("courseId must be positive".into());
    }
    if filter.change_type.as_deref().is_some_and(|kind| {
        !matches!(
            kind,
            "new" | "updated" | "announcement" | "deadline" | "unavailable" | "restored" | "baseline"
        )
    }) {
        return Err("Unknown History changeType".into());
    }
    let since = history_bound(&filter.since, "since")?;
    let until = history_bound(&filter.until, "until")?;
    if since
        .as_ref()
        .zip(until.as_ref())
        .is_some_and(|(a, b)| a >= b)
    {
        return Err("since must precede until".into());
    }
    let course_id = filter.course_id;
    let change_type = filter.change_type.as_deref();
    let watermark = clear_watermark(conn, HISTORY_CLEAR_EVENT_ID_KEY);
    let mut statement = conn
        .prepare("SELECT e.id, e.resource_id, e.course_id, c.name, r.title, r.url, r.resource_type,
                r.uploaded_at, e.change_type, e.title, e.description, e.detected_at, e.read_at, r.source_page_url,
                r.section_path, r.section
         FROM change_events e LEFT JOIN resources r ON r.id=e.resource_id LEFT JOIN courses c ON c.id=e.course_id
         WHERE e.id > ?1 AND e.calendar_suppressed=0
           AND (?2 IS NULL OR e.course_id=?2) AND (?3 IS NULL OR e.change_type=?3)
         ORDER BY e.detected_at DESC, e.id DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![watermark, course_id, change_type], map_event)
        .map_err(|error| error.to_string())?;
    let search = filter.search.as_deref().unwrap_or("").trim().to_lowercase();
    // RFC 3339 strings can use different precision and offsets; compare actual
    // instants so a whole-second suffix cannot sort after a later fraction.
    let mut timed = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|event| {
            chrono::DateTime::parse_from_rfc3339(&event.detected_at)
                .map(|at| (event, at.with_timezone(&chrono::Utc)))
                .map_err(|_| "Invalid History event timestamp".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    timed.retain(|(event, at)| {
        if since.as_ref().is_some_and(|bound| at < bound)
            || until.as_ref().is_some_and(|bound| at >= bound) {
            return false;
        }
            search.is_empty()
                || [
                    event.title.as_str(),
                    event.description.as_deref().unwrap_or(""),
                    event.course_name.as_deref().unwrap_or(""),
                    event.resource_title.as_deref().unwrap_or(""),
                ]
                .iter()
                .any(|field| field.to_lowercase().contains(&search))
    });
    timed.sort_by(|(a, at), (b, bt)| bt.cmp(at).then_with(|| b.id.cmp(&a.id)));
    let total = timed.len();
    let items = timed.into_iter().skip(offset as usize).take(limit as usize)
        .map(|(event, _)| event).collect();
    Ok(HistoryPage { items, total })
}

fn list_events_after_id(conn: &Connection, watermark: i64, limit: i64) -> rusqlite::Result<Vec<ChangeEvent>> {
    let query = format!(
        "{EVENT_SELECT} WHERE e.id > ?1 AND e.calendar_suppressed = 0
         ORDER BY e.detected_at DESC, e.id DESC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map(params![watermark, limit.clamp(1, 5000)], map_event)?;
    rows.collect()
}

pub fn list_dashboard_resources(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<Resource>> {
    let Some(value) = get_kv(conn, DASHBOARD_CLEAR_EVENT_ID_KEY) else {
        return list_resources(conn, &ResourceFilter { limit: Some(limit), ..ResourceFilter::default() });
    };
    let watermark = value.parse::<i64>().unwrap_or(0);
    let mut stmt = conn.prepare(
        "SELECT r.id, r.external_resource_id, r.course_id, c.name, r.title, r.url, r.resource_type,
                r.uploaded_at, r.published_at, r.modified_at, r.due_at, r.first_seen_at,
                r.last_seen_at, r.last_checked_at, r.content_fingerprint, r.availability_status,
                r.size_bytes, r.section, r.is_external, r.source_page_url, r.section_path
         FROM resources r LEFT JOIN courses c ON c.id = r.course_id
         WHERE EXISTS (
             SELECT 1 FROM change_events e WHERE e.resource_id = r.id AND e.id > ?1
               AND e.calendar_suppressed = 0
               AND e.change_type IN ('new','announcement','updated','deadline','unavailable','restored')
         ) OR (
             (r.due_at IS NOT NULL OR r.availability_status <> 'available')
             AND NOT EXISTS (
                 SELECT 1 FROM dashboard_cleared_resources d WHERE d.resource_id = r.id
             )
         )
         ORDER BY COALESCE(r.uploaded_at, r.published_at, r.modified_at, r.first_seen_at) DESC,
                  r.title COLLATE NOCASE, r.id
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![watermark, limit.clamp(1, 5000)], map_resource)?;
    rows.collect()
}

/// Mark resources that were not seen in this scan. They are never deleted; after
/// `threshold` consecutive misses they become unavailable.
pub fn bump_miss_streak(conn: &Connection, seen_ids: &[String], threshold: i64) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE resources SET miss_streak = miss_streak + 1 WHERE external_resource_id = ?1")?;
        for id in seen_ids {
            stmt.execute(params![id])?;
        }
    }
    // Promote long-missing, previously available resources to unavailable.
    tx.execute(
        "UPDATE resources SET availability_status = 'unavailable'
         WHERE miss_streak >= ?1 AND availability_status = 'available'",
        params![threshold],
    )?;
    tx.commit()?;
    Ok(0)
}

pub fn all_resource_external_ids(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT external_resource_id FROM resources")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn set_availability(conn: &Connection, resource_id: i64, status: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE resources SET availability_status = ?1 WHERE id = ?2",
        params![status, resource_id],
    )?;
    Ok(())
}

/* -------------------------------------------------------------------- events */

/// Insert a change event. Returns false if an identical event already exists
/// (deduplicated by `deduplication_key`).
pub fn insert_event(
    conn: &Connection,
    resource_id: Option<i64>,
    course_id: Option<i64>,
    change_type: &str,
    title: &str,
    description: Option<&str>,
    dedup_key: &str,
    now: &str,
) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO change_events(
            resource_id, course_id, change_type, title, description, detected_at, deduplication_key)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![resource_id, course_id, change_type, title, description, now, dedup_key],
    )?;
    Ok(changed > 0)
}

pub(crate) const EVENT_SELECT: &str = "SELECT e.id, e.resource_id, e.course_id, c.name, r.title, r.url, r.resource_type,
        r.uploaded_at, e.change_type, e.title, e.description, e.detected_at, e.read_at, r.source_page_url,
        r.section_path, r.section
 FROM change_events e
 LEFT JOIN resources r ON r.id = e.resource_id
 LEFT JOIN courses c ON c.id = e.course_id";

pub(crate) fn map_event(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChangeEvent> {
    let read_at: Option<String> = r.get(12)?;
    Ok(ChangeEvent {
        id: r.get(0)?,
        resource_id: r.get(1)?,
        course_id: r.get(2)?,
        course_name: r.get(3)?,
        resource_title: r.get(4)?,
        resource_url: r.get(5)?,
        source_page_url: r.get(13)?,
        section_path: r
            .get::<_, Option<String>>(14)?
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_else(|| r.get::<_, Option<String>>(15).ok().flatten().into_iter().collect()),
        resource_type: r.get(6)?,
        uploaded_at: r.get(7)?,
        change_type: r.get(8)?,
        title: r.get(9)?,
        description: r.get(10)?,
        detected_at: r.get(11)?,
        read: read_at.is_some(),
    })
}

/// Filter shared by every view that reads the canonical `change_events` log.
///
/// `since`/`until` are RFC 3339 UTC bounds (`until` exclusive) so a caller can
/// translate a local calendar day into an unambiguous instant window and every
/// view groups events the same way.
#[derive(Debug, Clone, Default)]
pub struct EventFilter {
    pub course_id: Option<i64>,
    pub change_type: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub unread_only: bool,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// The one query used by the Dashboard, History and the calendar. Filtering
/// only ever happens here so the three views can never disagree about which
/// events belong to a period.
pub fn list_events_filtered(
    conn: &Connection,
    f: &EventFilter,
) -> rusqlite::Result<Vec<ChangeEvent>> {
    // Own every bound value first so the `&dyn ToSql` references below outlive
    // the prepared statement (matching the pattern in `list_resources`).
    let course = f.course_id;
    let change_type = f
        .change_type
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_string);
    let since = f.since.clone();
    let until = f.until.clone();
    let limit = f.limit.unwrap_or(500).clamp(1, 5000);
    let offset = f.offset.unwrap_or(0).max(0);

    let mut sql = String::from(" WHERE e.calendar_suppressed = 0");
    let mut binds: Vec<(&str, &dyn rusqlite::ToSql)> = Vec::new();
    if let Some(course) = &course {
        sql.push_str(" AND e.course_id = :course");
        binds.push((":course", course));
    }
    if let Some(kind) = &change_type {
        sql.push_str(" AND e.change_type = :kind");
        binds.push((":kind", kind));
    }
    if let Some(since) = &since {
        sql.push_str(" AND e.detected_at >= :since");
        binds.push((":since", since));
    }
    if let Some(until) = &until {
        sql.push_str(" AND e.detected_at < :until");
        binds.push((":until", until));
    }
    if f.unread_only {
        sql.push_str(" AND e.read_at IS NULL");
    }
    sql.push_str(" ORDER BY e.detected_at DESC, e.id DESC LIMIT :limit OFFSET :offset");
    binds.push((":limit", &limit));
    binds.push((":offset", &offset));

    let query = format!("{EVENT_SELECT}{sql}");
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map(binds.as_slice(), map_event)?;
    rows.collect()
}

pub fn list_events(
    conn: &Connection,
    unread_only: bool,
    limit: i64,
) -> rusqlite::Result<Vec<ChangeEvent>> {
    list_events_filtered(
        conn,
        &EventFilter {
            unread_only,
            limit: Some(limit),
            ..EventFilter::default()
        },
    )
}

pub fn unread_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM change_events WHERE id > ?1 AND read_at IS NULL
         AND change_type <> 'baseline' AND calendar_suppressed = 0",
        params![clear_watermark(conn, HISTORY_CLEAR_EVENT_ID_KEY)],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// Unread newly-detected resources (uploads and announcements). This is the
/// canonical "new" figure — unlike a "since the last scan" window it does not
/// reset every time a scan runs, so the menu bar, the History badge and the
/// Dashboard stay in agreement.
pub fn unread_new_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM change_events
         WHERE id > ?1 AND read_at IS NULL
           AND change_type IN ('new','announcement') AND calendar_suppressed = 0",
        params![clear_watermark(conn, HISTORY_CLEAR_EVENT_ID_KEY)],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

pub fn mark_read(conn: &Connection, ids: &[i64], now: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE change_events SET read_at = ?1 WHERE id = ?2 AND read_at IS NULL")?;
        for id in ids {
            stmt.execute(params![now, id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn mark_all_read(conn: &Connection, now: &str) -> rusqlite::Result<()> {
    // The History action applies to the current History feed. Rows hidden by
    // its clear watermark may still be present in the shared event log for the
    // Dashboard and Calendar, so don't change their shared read state here.
    conn.execute(
        "UPDATE change_events SET read_at = ?1
         WHERE id > ?2 AND read_at IS NULL",
        params![now, clear_watermark(conn, HISTORY_CLEAR_EVENT_ID_KEY)],
    )?;
    Ok(())
}

pub fn mark_notified(conn: &Connection, ids: &[i64], now: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE change_events SET notified_at = ?1 WHERE id = ?2")?;
        for id in ids {
            stmt.execute(params![now, id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Unnotified, non-baseline events, newest first.
pub fn unnotified_events(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<ChangeEvent>> {
    let sql = format!(
        "{EVENT_SELECT} WHERE e.notified_at IS NULL AND e.change_type <> 'baseline' AND e.calendar_suppressed = 0
         ORDER BY e.detected_at ASC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit], map_event)?;
    rows.collect()
}

pub fn event_exists(conn: &Connection, dedup_key: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM change_events WHERE deduplication_key = ?1",
        params![dedup_key],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

/* --------------------------------------------------------------- scan runs */

pub fn start_scan(conn: &Connection, now: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO scan_runs(started_at, status) VALUES(?1, 'running')",
        params![now],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(clippy::too_many_arguments)]
pub fn finish_scan(
    conn: &Connection,
    id: i64,
    status: &str,
    discovered: i64,
    new: i64,
    updated: i64,
    unavailable: i64,
    courses_scanned: i64,
    courses_failed: i64,
    error_summary: Option<&str>,
    is_baseline: bool,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE scan_runs SET completed_at = ?1, status = ?2, discovered_count = ?3,
            new_count = ?4, updated_count = ?5, unavailable_count = ?6,
            courses_scanned = ?7, courses_failed = ?8, error_summary = ?9, is_baseline = ?10
         WHERE id = ?11",
        params![
            now,
            status,
            discovered,
            new,
            updated,
            unavailable,
            courses_scanned,
            courses_failed,
            error_summary,
            is_baseline as i64,
            id
        ],
    )?;
    Ok(())
}

/// Atomically claim the one native failure-notification attempt for an eligible finalized scan.
/// Returns false for missing, unfinished, cancelled, authentication-expired, successful, or already
/// claimed scans. The marker is part of scan History and is deleted with its scan row.
pub fn claim_scan_failure_notification(
    conn: &Connection,
    id: i64,
    notified_at: &str,
) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "UPDATE scan_runs SET failure_notified_at = ?1
         WHERE id = ?2 AND completed_at IS NOT NULL AND failure_notified_at IS NULL
           AND status NOT IN ('running', 'cancelled', 'auth_expired')
           AND (status IN ('partial', 'failed') OR courses_failed > 0)",
        params![notified_at, id],
    )?;
    Ok(changed == 1)
}

pub fn list_scans(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<ScanRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, completed_at, status, discovered_count, new_count, updated_count,
                unavailable_count, courses_scanned, courses_failed, error_summary, is_baseline
         FROM scan_runs ORDER BY started_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], map_scan)?;
    rows.collect()
}

pub fn list_history_scans(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<ScanRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, completed_at, status, discovered_count, new_count, updated_count,
                unavailable_count, courses_scanned, courses_failed, error_summary, is_baseline
         FROM scan_runs WHERE id > ?1 ORDER BY started_at DESC, id DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(
        params![clear_watermark(conn, HISTORY_CLEAR_SCAN_ID_KEY), limit.clamp(1, 500)],
        map_scan,
    )?;
    rows.collect()
}

/// Query the complete visible History scan set, then apply explicit paging.
pub fn query_history_scans(conn: &Connection, filter: &ScanFilter) -> Result<ScanPage, String> {
    let (offset, limit) = history_page_bounds(filter.offset, filter.limit)?;
    let watermark = clear_watermark(conn, HISTORY_CLEAR_SCAN_ID_KEY);
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM scan_runs WHERE id>?1",
            [watermark],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare("SELECT id, started_at, completed_at, status, discovered_count, new_count, updated_count,
                unavailable_count, courses_scanned, courses_failed, error_summary, is_baseline
         FROM scan_runs WHERE id>?1 ORDER BY started_at DESC, id DESC LIMIT ?2 OFFSET ?3")
        .map_err(|error| error.to_string())?;
    let items = statement
        .query_map(params![watermark, limit, offset], map_scan)
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok(ScanPage {
        items,
        total: total as usize,
    })
}

/// Save the exact terminal observations supplied by the scan worker.
///
/// The existing scan row must be present; replacement and insertion are atomic.
pub fn save_scan_details(conn: &Connection, details: &ScanDetails) -> rusqlite::Result<()> {
    let details = sanitize_scan_details(details.clone());
    let payload = serde_json::to_string(&details)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let changed = conn.execute(
        "INSERT INTO scan_details(scan_id, payload) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM scan_runs WHERE id = ?1)\n         ON CONFLICT(scan_id) DO UPDATE SET payload = excluded.payload",
        params![details.scan_id, payload],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Return saved observations, or `None` for legacy/missing scan rows.
pub fn scan_details(conn: &Connection, scan_id: i64) -> rusqlite::Result<Option<ScanDetails>> {
    let payload = conn
        .query_row(
            "SELECT payload FROM scan_details WHERE scan_id = ?1",
            [scan_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    payload
        .map(|payload| {
            let details: ScanDetails = serde_json::from_str(&payload)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?;
            Ok(sanitize_scan_details(details))
        })
        .transpose()
}

fn sanitize_diagnostic_text(value: &str) -> String {
    let redacted = crate::logging::redact(value);
    let lower = redacted.to_ascii_lowercase();
    if lower.contains("http://") || lower.contains("https://")
        || lower.contains("token=") || lower.contains("token:")
        || lower.contains("secret=") || lower.contains("cookie=")
        || lower.contains("session=") || lower.contains("sessiontoken=")
        || lower.contains("session_token=") || lower.contains("access_token=")
        || lower.contains("api_key=") || lower.contains("authorization=")
    {
        "[redacted: sensitive diagnostic content]".to_string()
    } else {
        redacted
    }
}

fn sanitize_scan_details(mut details: ScanDetails) -> ScanDetails {
    for course in &mut details.courses {
        course.course_name = sanitize_diagnostic_text(&course.course_name);
        course.error = course.error.as_deref().map(sanitize_diagnostic_text);
        for step in &mut course.steps {
            step.label = sanitize_diagnostic_text(&step.label);
            step.error = step.error.as_deref().map(sanitize_diagnostic_text);
        }
    }
    details
}

fn map_scan(r: &rusqlite::Row<'_>) -> rusqlite::Result<ScanRun> {
    Ok(ScanRun {
        id: r.get(0)?,
        started_at: r.get(1)?,
        completed_at: r.get(2)?,
        status: r.get(3)?,
        discovered_count: r.get(4)?,
        new_count: r.get(5)?,
        updated_count: r.get(6)?,
        unavailable_count: r.get(7)?,
        courses_scanned: r.get(8)?,
        courses_failed: r.get(9)?,
        error_summary: r.get(10)?,
        is_baseline: r.get::<_, i64>(11)? != 0,
    })
}

pub fn last_successful_scan(conn: &Connection) -> Option<ScanRun> {
    conn.query_row(
        "SELECT id, started_at, completed_at, status, discovered_count, new_count, updated_count,
                unavailable_count, courses_scanned, courses_failed, error_summary, is_baseline
         FROM scan_runs WHERE status = 'ok' ORDER BY completed_at DESC LIMIT 1",
        [],
        map_scan,
    )
    .optional()
    .ok()
    .flatten()
}

/// The most recent successful scan that completed inside `[since, until)`.
/// Used to scope a day's "last successful sync" and failed-course count to that
/// local day instead of returning the global latest scan.
pub fn last_successful_scan_between(
    conn: &Connection,
    since: &str,
    until: &str,
) -> Option<ScanRun> {
    conn.query_row(
        "SELECT id, started_at, completed_at, status, discovered_count, new_count, updated_count,
                unavailable_count, courses_scanned, courses_failed, error_summary, is_baseline
         FROM scan_runs WHERE status = 'ok' AND completed_at >= ?1 AND completed_at < ?2
         ORDER BY completed_at DESC LIMIT 1",
        params![since, until],
        map_scan,
    )
    .optional()
    .ok()
    .flatten()
}

/* ------------------------------------------------------------------- digest */

pub fn digest(conn: &Connection, since: &str, until: &str, date_label: &str) -> rusqlite::Result<Digest> {
    let items = {
        let sql = format!("{EVENT_SELECT} WHERE e.detected_at >= ?1 AND e.detected_at < ?2 AND e.calendar_suppressed = 0 ORDER BY e.detected_at DESC");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![since, until], map_event)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let count = |kind: &str| items.iter().filter(|e| e.change_type == kind).count() as i64;
    // Scope the sync metadata to the selected local day; the global latest scan
    // would otherwise attribute another day's sync (or failures) to this one.
    let last = last_successful_scan_between(conn, since, until);

    Ok(Digest {
        date: date_label.to_string(),
        new_count: count("new"),
        updated_count: count("updated"),
        announcement_count: count("announcement"),
        deadline_count: count("deadline"),
        unavailable_count: count("unavailable"),
        courses_failed: last.as_ref().map(|s| s.courses_failed).unwrap_or(0),
        last_success_at: last.and_then(|s| s.completed_at),
        items,
    })
}

/// A row of the local byte cache. The filesystem holds the payload; this is the
/// index that lets eviction and lookup run without walking the directory.
#[derive(Debug, Clone)]
pub struct CachedFile {
    pub resource_id: i64,
    pub content_hash: String,
    pub path: String,
    pub size_bytes: i64,
    pub last_used_at: String,
}

fn map_cached_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedFile> {
    Ok(CachedFile {
        resource_id: row.get(0)?,
        content_hash: row.get(1)?,
        path: row.get(2)?,
        size_bytes: row.get(3)?,
        last_used_at: row.get(4)?,
    })
}

const CACHED_FILE_SELECT: &str =
    "SELECT resource_id, content_hash, path, size_bytes, last_used_at FROM file_cache";

pub fn cache_upsert(
    conn: &Connection,
    resource_id: i64,
    content_hash: &str,
    path: &str,
    size_bytes: i64,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO file_cache(resource_id, content_hash, path, size_bytes, last_used_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(resource_id, content_hash)
         DO UPDATE SET path = excluded.path, size_bytes = excluded.size_bytes, last_used_at = excluded.last_used_at",
        params![resource_id, content_hash, path, size_bytes, now],
    )?;
    Ok(())
}

pub fn cache_touch(
    conn: &Connection,
    resource_id: i64,
    content_hash: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE file_cache SET last_used_at = ?3 WHERE resource_id = ?1 AND content_hash = ?2",
        params![resource_id, content_hash, now],
    )?;
    Ok(())
}

pub fn cache_get(
    conn: &Connection,
    resource_id: i64,
    content_hash: &str,
) -> rusqlite::Result<Option<CachedFile>> {
    let sql = format!("{CACHED_FILE_SELECT} WHERE resource_id = ?1 AND content_hash = ?2");
    conn.query_row(&sql, params![resource_id, content_hash], map_cached_file)
        .optional()
}

/// Every cached variant of one resource, newest use first. A resource can hold
/// more than one entry when its bytes changed after an update.
pub fn cache_for_resource(
    conn: &Connection,
    resource_id: i64,
) -> rusqlite::Result<Vec<CachedFile>> {
    let sql = format!("{CACHED_FILE_SELECT} WHERE resource_id = ?1 ORDER BY last_used_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![resource_id], map_cached_file)?;
    rows.collect()
}

/// Total cached bytes and file count.
pub fn cache_stats(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT COALESCE(SUM(size_bytes), 0), COUNT(*) FROM file_cache",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

/// Least-recently-used rows, oldest first, capped at `limit`.
pub fn cache_lru(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<CachedFile>> {
    let sql = format!("{CACHED_FILE_SELECT} ORDER BY last_used_at ASC LIMIT ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit], map_cached_file)?;
    rows.collect()
}

pub fn cache_delete(
    conn: &Connection,
    resource_id: i64,
    content_hash: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM file_cache WHERE resource_id = ?1 AND content_hash = ?2",
        params![resource_id, content_hash],
    )?;
    Ok(())
}

/// Drop the whole index and return the rows that were removed, so the caller can
/// unlink the files they name.
pub fn cache_clear(conn: &Connection) -> rusqlite::Result<Vec<CachedFile>> {
    let rows = {
        let mut stmt = conn.prepare(CACHED_FILE_SELECT)?;
        let mapped = stmt.query_map([], map_cached_file)?;
        mapped.collect::<rusqlite::Result<Vec<_>>>()?
    };
    conn.execute("DELETE FROM file_cache", [])?;
    Ok(rows)
}

/* ------------------------------------------------------------- local mirror */

/// One row of `local_files`: the mirror's index. The payload lives on disk at
/// `<root>/<rel_path>`, which is what the UI opens.
#[derive(Debug, Clone)]
pub struct MirrorRow {
    pub resource_id: i64,
    pub rel_path: String,
    pub sha256: Option<String>,
    pub size_bytes: i64,
    pub mime: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub attempts: i64,
    pub source_etag: Option<String>,
    pub source_modified: Option<String>,
    pub downloaded_at: Option<String>,
    pub last_checked: Option<String>,
}

fn map_mirror_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MirrorRow> {
    Ok(MirrorRow {
        resource_id: row.get(0)?,
        rel_path: row.get(1)?,
        sha256: row.get(2)?,
        size_bytes: row.get(3)?,
        mime: row.get(4)?,
        status: row.get(5)?,
        error: row.get(6)?,
        attempts: row.get(7)?,
        source_etag: row.get(8)?,
        source_modified: row.get(9)?,
        downloaded_at: row.get(10)?,
        last_checked: row.get(11)?,
    })
}

const MIRROR_SELECT: &str = "SELECT resource_id, rel_path, sha256, size_bytes, mime, status, \
     error, attempts, source_etag, source_modified, downloaded_at, last_checked FROM local_files";

pub fn mirror_get(conn: &Connection, resource_id: i64) -> rusqlite::Result<Option<MirrorRow>> {
    let sql = format!("{MIRROR_SELECT} WHERE resource_id = ?1");
    conn.query_row(&sql, params![resource_id], map_mirror_row)
        .optional()
}

/// Insert or replace one resource's mirror index row.
pub fn mirror_upsert(conn: &Connection, row: &MirrorRow) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO local_files(resource_id, rel_path, sha256, size_bytes, mime, status, error,
             attempts, source_etag, source_modified, downloaded_at, last_checked)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(resource_id) DO UPDATE SET
             rel_path = excluded.rel_path, sha256 = excluded.sha256,
             size_bytes = excluded.size_bytes, mime = excluded.mime,
             status = excluded.status, error = excluded.error,
             attempts = excluded.attempts, source_etag = excluded.source_etag,
             source_modified = excluded.source_modified,
             downloaded_at = excluded.downloaded_at, last_checked = excluded.last_checked",
        params![
            row.resource_id,
            row.rel_path,
            row.sha256,
            row.size_bytes,
            row.mime,
            row.status,
            row.error,
            row.attempts,
            row.source_etag,
            row.source_modified,
            row.downloaded_at,
            row.last_checked,
        ],
    )?;
    Ok(())
}

/// Record an attempt's outcome without touching the rest of the row.
pub fn mirror_set_status(
    conn: &Connection,
    resource_id: i64,
    status: &str,
    error: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE local_files SET status = ?2, error = ?3, last_checked = ?4 WHERE resource_id = ?1",
        params![resource_id, status, error, now],
    )?;
    Ok(())
}

pub fn mirror_list_status(conn: &Connection, status: &str) -> rusqlite::Result<Vec<MirrorRow>> {
    let sql = format!("{MIRROR_SELECT} WHERE status = ?1 ORDER BY resource_id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![status], map_mirror_row)?;
    rows.collect()
}

/// Counts per status, so the caller can tally without one query per status.
pub fn mirror_counts(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM local_files GROUP BY status")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    rows.collect()
}

/// (bytes on disk, indexed files) for the copies that are actually usable.
pub fn mirror_bytes(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT COALESCE(SUM(size_bytes), 0), COUNT(*) FROM local_files \
         WHERE status IN ('ok', 'kept')",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

/// Every resource that could have a local copy: advertised bytes and count.
pub fn mirror_totals(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT COALESCE(SUM(size_bytes), 0), COUNT(*) FROM resources WHERE is_external = 0",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

pub fn mirror_delete(conn: &Connection, resource_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM local_files WHERE resource_id = ?1", params![resource_id])?;
    Ok(())
}

/// Every indexed local copy, for the UI's per-resource status map.
pub fn mirror_all(conn: &Connection) -> rusqlite::Result<Vec<MirrorRow>> {
    let sql = format!("{MIRROR_SELECT} ORDER BY resource_id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_mirror_row)?;
    rows.collect()
}

/// 'Delete all local copies': only reached from an explicit user action.
pub fn mirror_clear_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM local_files", [])?;
    conn.execute("DELETE FROM local_file_versions", [])?;
    conn.execute("DELETE FROM download_queue", [])?;
    Ok(())
}

/// One superseded copy, moved under `<root>/.history`.
#[derive(Debug, Clone)]
pub struct MirrorVersion {
    pub resource_id: i64,
    pub rel_path: String,
    pub sha256: Option<String>,
    pub size_bytes: i64,
    pub replaced_at: String,
}

/// An exact saved-copy or retained-version index entry captured for explicit
/// deletion. Version row IDs distinguish duplicate paths/replacement times.
#[derive(Debug, Clone)]
pub struct MirrorDeleteFile {
    pub resource_id: i64,
    pub rel_path: String,
    pub sha256: Option<String>,
    pub size_bytes: i64,
    /// B02 attempt counter: distinguishes a later publication even when path,
    /// bytes, and second-precision timestamps happen to repeat.
    pub attempts: i64,
    pub downloaded_at: Option<String>,
    pub version_rowid: Option<i64>,
    pub replaced_at: Option<String>,
}

/// Capture only confirmed copies and retained versions; queue state is excluded.
pub fn mirror_delete_files(conn: &Connection) -> rusqlite::Result<Vec<MirrorDeleteFile>> {
    let mut out = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT resource_id, rel_path, sha256, size_bytes, attempts, downloaded_at
             FROM local_files WHERE status IN ('ok', 'kept') ORDER BY resource_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(MirrorDeleteFile {
                resource_id: row.get(0)?,
                rel_path: row.get(1)?,
                sha256: row.get(2)?,
                size_bytes: row.get(3)?,
                attempts: row.get(4)?,
                downloaded_at: row.get(5)?,
                version_rowid: None,
                replaced_at: None,
            })
        })?;
        out.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);
    }
    {
        let mut stmt = conn.prepare(
            "SELECT rowid, resource_id, rel_path, sha256, size_bytes, replaced_at
             FROM local_file_versions ORDER BY rowid",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(MirrorDeleteFile {
                resource_id: row.get(1)?,
                rel_path: row.get(2)?,
                sha256: row.get(3)?,
                size_bytes: row.get(4)?,
                attempts: 0,
                downloaded_at: None,
                version_rowid: Some(row.get(0)?),
                replaced_at: Some(row.get(5)?),
            })
        })?;
        out.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);
    }
    Ok(out)
}

/// Whether the current index still represents the captured publication.
pub fn mirror_delete_file_matches(
    conn: &Connection,
    file: &MirrorDeleteFile,
) -> rusqlite::Result<bool> {
    if let Some(rowid) = file.version_rowid {
        return conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM local_file_versions WHERE rowid = ?1 AND resource_id = ?2
             AND rel_path = ?3 AND sha256 IS ?4 AND size_bytes = ?5 AND replaced_at = ?6)",
            params![
                rowid,
                file.resource_id,
                file.rel_path,
                file.sha256,
                file.size_bytes,
                file.replaced_at
            ],
            |row| row.get(0),
        );
    }
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM local_files WHERE resource_id = ?1 AND rel_path = ?2
         AND sha256 IS ?3 AND size_bytes = ?4 AND attempts = ?5 AND downloaded_at IS ?6
         AND status IN ('ok', 'kept'))",
        params![
            file.resource_id,
            file.rel_path,
            file.sha256,
            file.size_bytes,
            file.attempts,
            file.downloaded_at
        ],
        |row| row.get(0),
    )
}

/// Delete only the still-matching captured index entry.
pub fn mirror_delete_captured_file(
    conn: &Connection,
    file: &MirrorDeleteFile,
) -> rusqlite::Result<usize> {
    if let Some(rowid) = file.version_rowid {
        return conn.execute(
            "DELETE FROM local_file_versions WHERE rowid = ?1 AND resource_id = ?2
             AND rel_path = ?3 AND sha256 IS ?4 AND size_bytes = ?5 AND replaced_at = ?6",
            params![
                rowid,
                file.resource_id,
                file.rel_path,
                file.sha256,
                file.size_bytes,
                file.replaced_at
            ],
        );
    }
    conn.execute(
        "DELETE FROM local_files WHERE resource_id = ?1 AND rel_path = ?2 AND sha256 IS ?3
         AND size_bytes = ?4 AND attempts = ?5 AND downloaded_at IS ?6
         AND status IN ('ok', 'kept')",
        params![
            file.resource_id,
            file.rel_path,
            file.sha256,
            file.size_bytes,
            file.attempts,
            file.downloaded_at
        ],
    )
}

pub fn version_insert(conn: &Connection, v: &MirrorVersion) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO local_file_versions(resource_id, rel_path, sha256, size_bytes, replaced_at)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![v.resource_id, v.rel_path, v.sha256, v.size_bytes, v.replaced_at],
    )?;
    Ok(())
}

/// Newest first.
pub fn version_list(conn: &Connection, resource_id: i64) -> rusqlite::Result<Vec<MirrorVersion>> {
    let mut stmt = conn.prepare(
        "SELECT resource_id, rel_path, sha256, size_bytes, replaced_at
           FROM local_file_versions WHERE resource_id = ?1 ORDER BY replaced_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map(params![resource_id], |row| {
        Ok(MirrorVersion {
            resource_id: row.get(0)?,
            rel_path: row.get(1)?,
            sha256: row.get(2)?,
            size_bytes: row.get(3)?,
            replaced_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// Keep the newest `keep` versions and return the rows that fell off the end,
/// so the caller can delete their files.
pub fn version_prune(
    conn: &Connection,
    resource_id: i64,
    keep: usize,
) -> rusqlite::Result<Vec<MirrorVersion>> {
    let all = version_list(conn, resource_id)?;
    let dropped = all.into_iter().skip(keep).collect::<Vec<_>>();
    for v in &dropped {
        conn.execute(
            "DELETE FROM local_file_versions WHERE resource_id = ?1 AND rel_path = ?2 AND replaced_at = ?3",
            params![v.resource_id, v.rel_path, v.replaced_at],
        )?;
    }
    Ok(dropped)
}

/// One pending download. Priority 0 is an on-demand request, 1 a new or updated
/// resource from the latest scan, 2 backfill of everything else.
#[derive(Debug, Clone)]
pub struct QueueItem {
    pub resource_id: i64,
    pub priority: i64,
    pub enqueued_at: String,
}

pub fn queue_enqueue(
    conn: &Connection,
    resource_id: i64,
    priority: i64,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO download_queue(resource_id, priority, enqueued_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(resource_id) DO UPDATE SET priority = MIN(download_queue.priority, excluded.priority)",
        params![resource_id, priority, now],
    )?;
    Ok(())
}

/// The next items to work on, most urgent first and, within a tier, newest
/// upload first so a fresh semester is usable before last year's archive.
pub fn queue_next(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<QueueItem>> {
    let mut stmt = conn.prepare(
        "SELECT q.resource_id, q.priority, q.enqueued_at
           FROM download_queue q LEFT JOIN resources r ON r.id = q.resource_id
          ORDER BY q.priority ASC,
                   COALESCE(r.uploaded_at, r.first_seen_at) DESC,
                   q.enqueued_at ASC
          LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(QueueItem {
            resource_id: row.get(0)?,
            priority: row.get(1)?,
            enqueued_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn queue_remove(conn: &Connection, resource_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM download_queue WHERE resource_id = ?1", params![resource_id])?;
    Ok(())
}

pub fn queue_len(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM download_queue", [], |r| r.get(0))
        .unwrap_or(0)
}

/// Backfill every resource that has no mirror row yet.
pub fn queue_backfill(conn: &Connection, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO download_queue(resource_id, priority, enqueued_at)
         SELECT r.id, 2, ?1
           FROM resources r LEFT JOIN local_files lf ON lf.resource_id = r.id
          WHERE r.is_external = 0 AND lf.resource_id IS NULL
          ON CONFLICT(resource_id) DO NOTHING",
        params![now],
    )
}

/// Re-check a resource that is already mirrored when its metadata says it was
/// modified after our last look, plus anything we have never checked.
pub fn queue_recheck_modified(conn: &Connection, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO download_queue(resource_id, priority, enqueued_at)
         SELECT r.id, 1, ?1
           FROM resources r JOIN local_files lf ON lf.resource_id = r.id
          WHERE r.is_external = 0
            AND lf.status IN ('ok', 'kept')
            AND r.modified_at IS NOT NULL
            AND (lf.last_checked IS NULL OR r.modified_at > lf.last_checked)
          ON CONFLICT(resource_id) DO UPDATE SET priority = MIN(download_queue.priority, 1)",
        params![now],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn events_range_fixed_data_pages_have_no_gaps_and_stable_raw_ties() {
        // Exact multiples must request an empty terminal page, not stop early.
        for (count, page_size) in [(4000, 2000), (10000, 5000), (6001, 2000), (6001, 5000)] {
            let conn = mem();
            let tx = conn.unchecked_transaction().unwrap();
            for id in 1..=count {
                insert_event(
                    &tx,
                    None,
                    Some(7),
                    "new",
                    "tied",
                    None,
                    &format!("paging-{id}"),
                    "2026-11-16T10:00:00Z",
                )
                .unwrap();
            }
            tx.commit().unwrap();
            let mut ids = Vec::new();
            let mut lengths = Vec::new();
            loop {
                let page = list_events_filtered(
                    &conn,
                    &EventFilter {
                        course_id: Some(7),
                        limit: Some(page_size),
                        offset: Some(ids.len() as i64),
                        ..EventFilter::default()
                    },
                )
                .unwrap();
                lengths.push(page.len());
                ids.extend(page.iter().map(|event| event.id));
                if page.len() < page_size as usize {
                    break;
                }
            }
            assert_eq!(ids, (1..=count).rev().collect::<Vec<_>>());
            assert_eq!(
                ids.iter().collect::<std::collections::HashSet<_>>().len(),
                count as usize
            );
            assert_eq!(*lengths.last().unwrap(), (count % page_size) as usize);
            assert_eq!(lengths.len(), (count / page_size + 1) as usize);
        }
    }

    #[test]
    fn events_range_membership_and_shared_filters_remain_unchanged() {
        let conn = mem();
        let since = "2026-11-16T00:00:00Z";
        let until = "2026-11-17T00:00:00Z";
        for (id, course, kind, time) in [
            (1, 7, "baseline", since),
            (2, 7, "updated", since),
            (3, 7, "new", since),
            (4, 7, "new", since),
            (5, 7, "new", until),
            (6, 8, "new", since),
            (7, 7, "new", "2026-11-15T23:59:59Z"),
            (8, 7, "new", since),
        ] {
            insert_event(
                &conn,
                None,
                Some(course),
                kind,
                "orphan",
                None,
                &format!("member-{id}"),
                time,
            )
            .unwrap();
        }
        mark_read(&conn, &[2], since).unwrap();
        conn.execute("INSERT INTO inbox_dismissals VALUES (3, ?1)", [since])
            .unwrap();
        conn.execute(
            "UPDATE change_events SET calendar_suppressed=1 WHERE id=4",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM change_events WHERE id=8", [])
            .unwrap();
        clear_history_activity(&conn).unwrap();
        clear_dashboard_activity(&conn).unwrap();
        let filter = EventFilter {
            course_id: Some(7),
            since: Some(since.into()),
            until: Some(until.into()),
            ..EventFilter::default()
        };
        let ids = |rows: Vec<ChangeEvent>| rows.into_iter().map(|e| e.id).collect::<Vec<_>>();
        assert_eq!(
            ids(list_events_filtered(&conn, &filter).unwrap()),
            vec![3, 2, 1]
        );
        assert_eq!(
            ids(list_events_filtered(
                &conn,
                &EventFilter {
                    unread_only: true,
                    ..filter.clone()
                }
            )
            .unwrap()),
            vec![3, 1]
        );
        assert_eq!(
            ids(list_events_filtered(
                &conn,
                &EventFilter {
                    change_type: Some(" updated ".into()),
                    ..filter.clone()
                }
            )
            .unwrap()),
            vec![2]
        );
        assert_eq!(
            ids(list_events_filtered(
                &conn,
                &EventFilter {
                    offset: Some(1),
                    limit: Some(1),
                    ..filter.clone()
                }
            )
            .unwrap()),
            vec![2]
        );
        for offset in [None, Some(0), Some(-3)] {
            assert_eq!(
                ids(list_events_filtered(
                    &conn,
                    &EventFilter {
                        offset,
                        ..filter.clone()
                    }
                )
                .unwrap()),
                vec![3, 2, 1]
            );
        }
        assert_eq!(
            ids(list_events(&conn, true, 100).unwrap()),
            vec![5, 6, 3, 1, 7]
        );
        assert_eq!(list_events(&conn, false, 100).unwrap().len(), 6);
        // Keep raw lexical timestamp order, even when parsed-instant order differs.
        insert_event(
            &conn,
            None,
            Some(9),
            "new",
            "fractional",
            None,
            "fractional",
            "2026-11-16T10:00:00.900Z",
        )
        .unwrap();
        insert_event(
            &conn,
            None,
            Some(9),
            "new",
            "whole",
            None,
            "whole",
            "2026-11-16T10:00:00Z",
        )
        .unwrap();
        let raw = list_events_filtered(
            &conn,
            &EventFilter {
                course_id: Some(9),
                ..EventFilter::default()
            },
        )
        .unwrap();
        assert_eq!(
            raw.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(),
            vec!["whole", "fractional"]
        );
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = mem();
        migrate(&conn).unwrap();
        assert_eq!(count_courses(&conn), 0);
    }

    fn insert_test_scan(conn: &Connection) -> i64 {
        conn.execute(
            "INSERT INTO scan_runs (started_at, status) VALUES ('2026-11-16T10:00:00Z', 'ok')",
            [],
        ).unwrap();
        conn.last_insert_rowid()
    }

    fn test_scan_details(scan_id: i64) -> ScanDetails {
        use crate::models::{ScanCourseDetail, ScanCourseStatus as Status, ScanStep};
        ScanDetails {
            scan_id,
            courses: vec![
                ScanCourseDetail {
                    course_id: Some(7),
                    course_name: "Computer Science".into(),
                    status: Status::Partial,
                    started_at: "2026-11-16T10:00:01Z".into(),
                    completed_at: None,
                    steps: vec![ScanStep {
                        label: "Discover resources".into(),
                        status: Status::Failed,
                        started_at: "2026-11-16T10:00:02Z".into(),
                        completed_at: Some("2026-11-16T10:00:03Z".into()),
                        error: Some("safe failure detail".into()),
                    }],
                    error: Some("partial course result".into()),
                },
                ScanCourseDetail {
                    course_id: None,
                    course_name: "Unknown".into(),
                    status: Status::Failed,
                    started_at: "2026-11-16T10:01:00Z".into(),
                    completed_at: Some("2026-11-16T10:01:01Z".into()),
                    steps: vec![],
                    error: Some("course failed".into()),
                },
                ScanCourseDetail {
                    course_id: Some(9),
                    course_name: "Cancelled course".into(),
                    status: Status::Cancelled,
                    started_at: "2026-11-16T10:02:00Z".into(),
                    completed_at: None,
                    steps: vec![],
                    error: None,
                },
                ScanCourseDetail {
                    course_id: Some(10),
                    course_name: "Successful course".into(),
                    status: Status::Success,
                    started_at: "2026-11-16T10:03:00Z".into(),
                    completed_at: Some("2026-11-16T10:04:00Z".into()),
                    steps: vec![],
                    error: None,
                },
            ],
        }
    }

    #[test]
    fn legacy_scans_have_no_details_and_new_payload_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scan-details.sqlite");
        let conn = Connection::open(&path).unwrap();
        migrate(&conn).unwrap();
        let scan_id = insert_test_scan(&conn);
        assert_eq!(scan_details(&conn, scan_id).unwrap(), None);
        let details = test_scan_details(scan_id);
        save_scan_details(&conn, &details).unwrap();
        drop(conn);

        let reopened = Connection::open(path).unwrap();
        migrate(&reopened).unwrap();
        assert_eq!(scan_details(&reopened, scan_id).unwrap(), Some(details));
    }

    #[test]
    fn scan_details_serialize_camel_case_and_clean_up_with_history_rows() {
        let conn = mem();
        let scan_id = insert_test_scan(&conn);
        save_scan_details(&conn, &test_scan_details(scan_id)).unwrap();
        let raw: String = conn.query_row("SELECT payload FROM scan_details", [], |row| row.get(0)).unwrap();
        assert!(raw.contains("courseId") && raw.contains("startedAt") && raw.contains("completedAt"));
        assert!(!raw.contains("course_id") && !raw.contains("started_at"));
        for status in ["success", "partial", "failed", "cancelled"] {
            assert!(raw.contains(&format!("\"status\":\"{status}\"")));
        }

        conn.execute("DELETE FROM scan_runs WHERE id = ?1", [scan_id]).unwrap();
        let remaining: i64 = conn.query_row("SELECT COUNT(*) FROM scan_details", [], |row| row.get(0)).unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn scan_detail_sanitization_covers_stored_payload_and_returned_dto() {
        let conn = mem();
        let scan_id = insert_test_scan(&conn);
        let mut details = test_scan_details(scan_id);
        details.courses[0].error = Some("password=hunter2 MoodleSession=abc wstoken=def https://example.test/path?token=secret".into());
        details.courses[0].steps[0].error = Some("request failed: https://example.test/api?sid=private".into());
        save_scan_details(&conn, &details).unwrap();

        let raw: String = conn.query_row("SELECT payload FROM scan_details", [], |row| row.get(0)).unwrap();
        let returned = scan_details(&conn, scan_id).unwrap().unwrap();
        for secret in ["hunter2", "abc", "def", "secret", "private", "example.test"] {
            assert!(!raw.contains(secret), "raw stored payload leaked {secret}");
            assert!(!format!("{returned:?}").contains(secret), "returned DTO leaked {secret}");
        }
        assert!(returned.courses[0].error.as_deref().unwrap().contains("redacted"));
    }

    #[test]
    fn populated_legacy_database_gets_idempotent_scan_details_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0001_init.sql")).unwrap();
        let scan_id = insert_test_scan(&conn);
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(scan_details(&conn, scan_id).unwrap(), None);
        save_scan_details(&conn, &test_scan_details(scan_id)).unwrap();
        assert!(scan_details(&conn, scan_id).unwrap().is_some());
    }

    #[test]
    fn populated_scan_rows_get_idempotent_failure_claim_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0001_init.sql"))
            .unwrap();
        let scan_id = insert_test_scan(&conn);
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let status: String = conn
            .query_row(
                "SELECT status FROM scan_runs WHERE id=?1",
                [scan_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "ok");
        let marker: Option<String> = conn
            .query_row(
                "SELECT failure_notified_at FROM scan_runs WHERE id=?1",
                [scan_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(marker, None);
    }

    #[test]
    fn scan_failure_claim_requires_eligible_finalized_row_and_follows_history_deletion() {
        let conn = mem();
        let eligible = start_scan(&conn, "2026-11-16T10:00:00Z").unwrap();
        finish_scan(
            &conn,
            eligible,
            "partial",
            0,
            0,
            0,
            0,
            1,
            0,
            None,
            false,
            "2026-11-16T10:01:00Z",
        )
        .unwrap();
        let cancelled = start_scan(&conn, "2026-11-16T10:00:00Z").unwrap();
        finish_scan(
            &conn,
            cancelled,
            "cancelled",
            0,
            0,
            0,
            0,
            0,
            0,
            None,
            false,
            "2026-11-16T10:01:00Z",
        )
        .unwrap();
        let unfinished = start_scan(&conn, "2026-11-16T10:00:00Z").unwrap();

        assert!(
            claim_scan_failure_notification(&conn, eligible, "2026-11-16T10:02:00Z").unwrap()
        );
        assert!(
            !claim_scan_failure_notification(&conn, eligible, "2026-11-16T10:03:00Z").unwrap()
        );
        assert!(
            !claim_scan_failure_notification(&conn, cancelled, "2026-11-16T10:02:00Z").unwrap()
        );
        assert!(
            !claim_scan_failure_notification(&conn, unfinished, "2026-11-16T10:02:00Z").unwrap()
        );
        assert!(
            !claim_scan_failure_notification(&conn, i64::MAX, "2026-11-16T10:02:00Z").unwrap()
        );

        conn.execute("DELETE FROM scan_runs WHERE id=?1", [eligible]).unwrap();
        assert!(!claim_scan_failure_notification(&conn, eligible, "2026-11-16T10:04:00Z").unwrap());
    }

    #[test]
    fn scan_failure_claim_includes_failed_course_success_status_and_excludes_nonfailures() {
        let conn = mem();
        let failed_course = start_scan(&conn, "2026-11-16T10:00:00Z").unwrap();
        finish_scan(
            &conn,
            failed_course,
            "ok",
            0,
            0,
            0,
            0,
            1,
            1,
            None,
            false,
            "2026-11-16T10:01:00Z",
        )
        .unwrap();
        let success = start_scan(&conn, "2026-11-16T10:00:00Z").unwrap();
        finish_scan(
            &conn,
            success,
            "ok",
            0,
            0,
            0,
            0,
            1,
            0,
            None,
            true,
            "2026-11-16T10:01:00Z",
        )
        .unwrap();
        let auth = start_scan(&conn, "2026-11-16T10:00:00Z").unwrap();
        finish_scan(
            &conn,
            auth,
            "auth_expired",
            0,
            0,
            0,
            0,
            0,
            1,
            None,
            false,
            "2026-11-16T10:01:00Z",
        )
        .unwrap();

        assert!(claim_scan_failure_notification(&conn, failed_course, "now").unwrap());
        assert!(!claim_scan_failure_notification(&conn, success, "now").unwrap());
        assert!(!claim_scan_failure_notification(&conn, auth, "now").unwrap());
    }

    #[test]
    fn course_display_name_migrates_a_populated_legacy_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0001_init.sql"))
            .unwrap();
        conn.execute(
            "INSERT INTO courses (id, external_course_id, name, short_name, url, first_seen_at)
             VALUES (42, 'legacy-42', 'Original Quanta name', 'CS F111', 'https://quanta.bits-pilani.ac.in/course/42', '2026-11-15T00:00:00Z')",
            [],
        )
        .unwrap();
        assert!(conn.prepare("SELECT display_name FROM courses").is_err());

        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        let courses = list_courses(&conn).unwrap();
        assert_eq!(courses.len(), 1);
        let course = &courses[0];
        assert_eq!(course.id, 42);
        assert_eq!(course.external_course_id, "legacy-42");
        assert_eq!(course.name, "Original Quanta name");
        assert_eq!(course.short_name.as_deref(), Some("CS F111"));
        assert_eq!(course.display_name, None);
        assert_eq!(course.url, "https://quanta.bits-pilani.ac.in/course/42");
        assert_eq!(course.first_seen_at, "2026-11-15T00:00:00Z");
    }

    #[test]
    fn course_display_name_is_durable_and_discovery_preserves_source_identity() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("course-name.sqlite");
        let conn = Connection::open(&path).unwrap();
        migrate(&conn).unwrap();
        let id = upsert_course(
            &conn,
            "external-42",
            "Original Quanta name",
            Some("CS F111"),
            "https://quanta.bits-pilani.ac.in/course/42",
            "2026-11-15T00:00:00Z",
        )
        .unwrap();

        let updated = set_course_display_name(&conn, id, Some("  Álgebra 東京  ")).unwrap();
        assert_eq!(updated.display_name.as_deref(), Some("Álgebra 東京"));
        assert_eq!(updated.name, "Original Quanta name");
        assert_eq!(updated.short_name.as_deref(), Some("CS F111"));
        assert_eq!(updated.external_course_id, "external-42");
        upsert_course(
            &conn,
            "external-42",
            "Updated Quanta source name",
            Some("CS F111"),
            "https://quanta.bits-pilani.ac.in/course/42",
            "2026-11-16T00:00:00Z",
        )
        .unwrap();
        assert_eq!(list_courses(&conn).unwrap()[0].display_name.as_deref(), Some("Álgebra 東京"));
        drop(conn);

        let reopened = Connection::open(path).unwrap();
        migrate(&reopened).unwrap();
        let course = &list_courses(&reopened).unwrap()[0];
        assert_eq!(course.display_name.as_deref(), Some("Álgebra 東京"));
        assert_eq!(course.name, "Updated Quanta source name");

        let reset = set_course_display_name(&reopened, id, None).unwrap();
        assert_eq!(reset.display_name, None);
    }

    #[test]
    fn course_display_name_rejects_empty_overlong_and_unknown_without_mutation() {
        let conn = mem();
        let id = upsert_course(&conn, "external-7", "Original", None, "u", "t").unwrap();
        assert!(set_course_display_name(&conn, id, Some(" \u{2003} ")).is_err());
        assert!(set_course_display_name(&conn, id, Some(&"é".repeat(121))).is_err());
        assert!(set_course_display_name(&conn, id + 100, Some("No course")).is_err());
        assert_eq!(list_courses(&conn).unwrap()[0].display_name, None);
        let max_length = "é".repeat(120);
        assert_eq!(
            set_course_display_name(&conn, id, Some(&max_length))
                .unwrap()
                .display_name
                .as_deref(),
            Some(max_length.as_str())
        );
    }

    /// A file-backed database whose recorded version is older than the running
    /// one: `upgrade` must back up before migrating and record the new version.
    fn file_db() -> (tempfile::TempDir, std::path::PathBuf, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("quanta-pulse.sqlite");
        let conn = Connection::open(&path).unwrap();
        migrate(&conn).unwrap();
        (dir, path, conn)
    }

    fn backup_names(dir: &tempfile::TempDir) -> Vec<String> {
        let backups = dir.path().join("backups");
        if !backups.exists() {
            return Vec::new();
        }
        let mut names: Vec<String> = std::fs::read_dir(&backups)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn upgrade_backs_up_before_migrating_when_the_version_increases() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.1.0").unwrap();
        conn.execute_batch("CREATE TABLE legacy (id INTEGER); INSERT INTO legacy VALUES (1);")
            .unwrap();

        upgrade(&conn, &path, "0.2.0").unwrap();

        let names = backup_names(&dir);
        assert_eq!(names.len(), 1, "one backup expected: {names:?}");
        assert!(names[0].starts_with("quanta-pulse-0.1.0-"), "{}", names[0]);
        assert!(names[0].ends_with(".db"));

        // The backup is a consistent copy that holds the data.
        let backup = Connection::open(dir.path().join("backups").join(&names[0])).unwrap();
        let count: i64 = backup.query_row("SELECT COUNT(*) FROM legacy", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);

        // The running version is recorded.
        assert_eq!(get_kv(&conn, LAST_APP_VERSION_KEY).as_deref(), Some("0.2.0"));
    }

    #[test]
    fn upgrade_takes_no_backup_when_the_version_matches() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.2.0").unwrap();

        upgrade(&conn, &path, "0.2.0").unwrap();

        assert!(!dir.path().join("backups").exists());
        assert_eq!(get_kv(&conn, LAST_APP_VERSION_KEY).as_deref(), Some("0.2.0"));
    }

    #[test]
    fn upgrade_takes_no_backup_for_a_fresh_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("quanta-pulse.sqlite");
        // A truly fresh database: no schema, no recorded version, nothing to lose.
        let conn = Connection::open(&path).unwrap();
        upgrade(&conn, &path, "0.2.0").unwrap();
        assert!(!dir.path().join("backups").exists());
        assert_eq!(get_kv(&conn, LAST_APP_VERSION_KEY).as_deref(), Some("0.2.0"));
    }

    #[test]
    fn upgrade_backs_up_a_database_from_before_version_recording() {
        let (dir, path, conn) = file_db();
        // An existing database whose build predates version recording: no
        // recorded version, but user data worth protecting.
        upgrade(&conn, &path, "0.2.0").unwrap();
        let names = backup_names(&dir);
        assert_eq!(names.len(), 1, "one backup expected: {names:?}");
        assert!(names[0].starts_with("quanta-pulse-unknown-"), "{}", names[0]);
    }

    #[test]
    fn upgrade_keeps_the_newest_three_backups() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.1.0").unwrap();
        for version in ["0.2.0", "0.3.0", "0.4.0", "0.5.0"] {
            upgrade(&conn, &path, version).unwrap();
            // Keep modification times distinct so the prune order is deterministic.
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }

        let names = backup_names(&dir);
        assert_eq!(names.len(), 3, "newest three kept: {names:?}");
        // The newest backup (taken for the 0.4.0 -> 0.5.0 upgrade) survives.
        assert!(
            names.iter().any(|n| n.starts_with("quanta-pulse-0.4.0-")),
            "newest backup missing: {names:?}"
        );
    }

    #[test]
    fn upgrade_aborts_the_migration_when_the_backup_fails() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.1.0").unwrap();
        // A file where the backups directory should be makes the backup fail.
        std::fs::write(dir.path().join("backups"), "not a directory").unwrap();

        let result = upgrade(&conn, &path, "0.2.0");
        let err = result.expect_err("a failed backup must abort the upgrade");
        assert!(err.contains("backup"), "unexpected error: {err}");

        // The migration did not run and the version was not recorded.
        assert_eq!(get_kv(&conn, LAST_APP_VERSION_KEY).as_deref(), Some("0.1.0"));
    }

    #[test]
    fn migration_backfills_known_legacy_sections_without_touching_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE resources (
                id INTEGER PRIMARY KEY,
                course_id INTEGER,
                availability_status TEXT,
                last_seen_at TEXT,
                first_seen_at TEXT NOT NULL DEFAULT '2026-10-11T00:00:00Z',
                section TEXT
             );
             INSERT INTO resources(id, section) VALUES (41, 'Lecture Notes');",
        ).unwrap();
        migrate(&conn).unwrap();
        let (id, path): (i64, String) = conn.query_row(
            "SELECT id, section_path FROM resources WHERE id = 41",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(id, 41);
        assert_eq!(serde_json::from_str::<Vec<String>>(&path).unwrap(), vec!["Lecture Notes"]);
    }

    #[test]
    fn settings_round_trip() {
        let conn = mem();
        let mut s = Settings::default();
        s.sync_interval_minutes = 90;
        save_settings(&conn, &s).unwrap();
        assert_eq!(load_settings(&conn).sync_interval_minutes, 90);
    }

    #[test]
    fn upsert_never_erases_known_upload_time() {
        let conn = mem();
        let cid = upsert_course(&conn, "10", "CS F222", None, "https://x/10", "t0").unwrap();
        let w = ResourceWrite {
            external_id: "mod:resource:1",
            course_id: Some(cid),
            title: "Lecture 1",
            url: "https://x/1",
            source_page_url: None,
            section_path: None,
            resource_type: "pdf",
            uploaded_at: Some("2026-10-11T14:35:00+05:30"),
            published_at: None,
            modified_at: None,
            due_at: None,
            fingerprint: "fp1",
            size_bytes: Some(10),
            section: None,
            is_external: false,
            availability: "available",
        };
        upsert_resource(&conn, &w, "t1").unwrap();

        // Second write without an upload timestamp must not clear it.
        let w2 = ResourceWrite {
            uploaded_at: None,
            fingerprint: "fp2",
            ..w
        };
        upsert_resource(&conn, &w2, "t2").unwrap();
        let r = get_resource(&conn, "mod:resource:1").unwrap();
        assert_eq!(r.uploaded_at.as_deref(), Some("2026-10-11T14:35:00+05:30"));
        assert_eq!(r.availability_status, "available");
    }

    #[test]
    fn source_page_url_round_trips_and_survives_missing_value() {
        let conn = mem();
        let cid = upsert_course(&conn, "10", "CS F222", None, "https://x/10", "t0").unwrap();
        let w = ResourceWrite {
            external_id: "mod:resource:1",
            course_id: Some(cid),
            title: "Lecture 1",
            url: "https://x/1.pdf",
            source_page_url: Some("https://x/10"),
            section_path: Some(r#"["Lecture Notes","Recorded Lectures","Recorded Lecture 2.1"]"#),
            resource_type: "pdf",
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            fingerprint: "fp1",
            size_bytes: None,
            section: None,
            is_external: false,
            availability: "available",
        };
        upsert_resource(&conn, &w, "t1").unwrap();

        // A later write that cannot attribute a listing page must not erase it.
        let w2 = ResourceWrite {
            source_page_url: None,
            section_path: None,
            fingerprint: "fp2",
            ..w
        };
        upsert_resource(&conn, &w2, "t2").unwrap();
        let r = get_resource(&conn, "mod:resource:1").unwrap();
        assert_eq!(r.source_page_url.as_deref(), Some("https://x/10"));
        assert_eq!(r.section_path, vec!["Lecture Notes", "Recorded Lectures", "Recorded Lecture 2.1"]);

        // The event read path exposes it too (History/Calendar open links).
        insert_event(&conn, Some(r.id), Some(cid), "new", "Lecture 1", None, "k1", "t3").unwrap();
        let events = list_events_filtered(&conn, &EventFilter::default()).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].resource_url.as_deref(), Some("https://x/1.pdf"));
        assert_eq!(events[0].source_page_url.as_deref(), Some("https://x/10"));
        assert_eq!(events[0].section_path, r.section_path);
    }

    #[test]
    fn events_deduplicate_by_key() {
        let conn = mem();
        let now = "t";
        let a = insert_event(&conn, None, None, "new", "x", None, "k1", now).unwrap();
        let b = insert_event(&conn, None, None, "new", "x", None, "k1", now).unwrap();
        assert!(a);
        assert!(!b);
        assert_eq!(unread_count(&conn), 1);
        mark_all_read(&conn, now).unwrap();
        assert_eq!(unread_count(&conn), 0);
    }

    /// Regression: the Dashboard derived "new" from a scan-relative window, so
    /// any later successful scan reset it to zero while the event stayed in
    /// History. The canonical figure is the unread event count, which no scan
    /// can erase.
    #[test]
    fn unread_new_survives_a_later_scan() {
        let conn = mem();
        insert_event(&conn, None, None, "new", "Worksheet-9.pdf", None, "k1", "2026-10-12T04:52:00Z")
            .unwrap();
        assert_eq!(unread_new_count(&conn), 1);
        // A later, otherwise-empty successful scan must not change the figure.
        let id = start_scan(&conn, "2026-10-12T05:30:00Z").unwrap();
        finish_scan(&conn, id, "ok", 1, 0, 0, 0, 1, 0, None, false, "2026-10-12T05:30:00Z")
            .unwrap();
        assert_eq!(unread_new_count(&conn), 1);
        // Only reading the event clears it.
        mark_all_read(&conn, "2026-10-12T06:00:00Z").unwrap();
        assert_eq!(unread_new_count(&conn), 0);
    }

    #[test]
    fn unread_new_counts_uploads_and_announcements_only() {
        let conn = mem();
        insert_event(&conn, None, None, "new", "a", None, "k1", "t").unwrap();
        insert_event(&conn, None, None, "announcement", "b", None, "k2", "t").unwrap();
        insert_event(&conn, None, None, "updated", "c", None, "k3", "t").unwrap();
        insert_event(&conn, None, None, "deadline", "d", None, "k4", "t").unwrap();
        assert_eq!(unread_new_count(&conn), 2);
    }

    #[test]
    fn mark_all_read_only_marks_visible_history_and_persists_across_reopen() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("quanta-pulse-read-{suffix}.sqlite"));
        {
            let conn = open(&path).unwrap();
            insert_event(&conn, None, None, "new", "Old event", None, "old", "t1").unwrap();
            clear_history_activity(&conn).unwrap();
            insert_event(&conn, None, None, "new", "Visible event", None, "visible", "t2").unwrap();

            assert_eq!(unread_count(&conn), 1);
            mark_all_read(&conn, "t3").unwrap();
            assert_eq!(unread_count(&conn), 0);
            let visible = list_history_events(&conn, 100).unwrap();
            assert_eq!(visible.len(), 1);
            assert!(visible[0].read);

            // The clear point and read_at state use the same durable SQLite
            // database without deleting the shared event rows.
            assert_eq!(count_events(&conn), 2);
        }
        {
            let conn = open(&path).unwrap();
            let visible = list_history_events(&conn, 100).unwrap();
            assert_eq!(visible.len(), 1);
            assert_eq!(visible[0].title, "Visible event");
            assert!(visible[0].read);

            let dashboard = list_dashboard_events(&conn, 100).unwrap();
            assert_eq!(dashboard.len(), 2);
            assert!(!dashboard.iter().find(|event| event.title == "Old event").unwrap().read);
            assert!(dashboard.iter().find(|event| event.title == "Visible event").unwrap().read);
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
    }

    #[test]
    fn dashboard_and_history_clears_are_independent_and_preserve_records() {
        let conn = mem();
        let (course, _) = seed_resources(&conn);
        let resources = list_resources(&conn, &ResourceFilter::default()).unwrap();
        let new_resource = resources.iter().find(|r| r.title == "Lecture 01").unwrap();
        let deadline_resource = resources.iter().find(|r| r.title == "Assignment 1").unwrap();
        let unavailable_resource = resources.iter().find(|r| r.title == "Quiz 1").unwrap();
        set_availability(&conn, unavailable_resource.id, "unavailable").unwrap();

        insert_event(&conn, Some(new_resource.id), Some(course), "new", "New file", None, "old-new", "t1").unwrap();
        insert_event(&conn, Some(deadline_resource.id), Some(course), "updated", "Updated file", None, "old-updated", "t2").unwrap();
        let scan = start_scan(&conn, "t2").unwrap();
        finish_scan(&conn, scan, "ok", 3, 1, 1, 0, 1, 0, None, false, "t2").unwrap();

        assert_eq!(list_dashboard_resources(&conn, 2000).unwrap().len(), 3);
        assert_eq!(list_dashboard_events(&conn, 1000).unwrap().len(), 2);
        assert_eq!(unread_count(&conn), 2);
        clear_dashboard_activity(&conn).unwrap();

        assert!(list_dashboard_resources(&conn, 2000).unwrap().is_empty());
        assert!(list_dashboard_events(&conn, 1000).unwrap().is_empty());
        assert_eq!(list_history_events(&conn, 1000).unwrap().len(), 2);
        assert_eq!(list_events(&conn, false, 1000).unwrap().len(), 2, "Calendar's canonical event query is unchanged");
        assert_eq!(unread_count(&conn), 2, "clearing Dashboard leaves History unread state intact");
        assert_eq!(count_resources(&conn), 3);

        insert_event(&conn, Some(new_resource.id), Some(course), "updated", "New activity", None, "new-activity", "t3").unwrap();
        assert_eq!(list_dashboard_events(&conn, 1000).unwrap().len(), 1);
        assert_eq!(list_dashboard_resources(&conn, 2000).unwrap()[0].id, new_resource.id);
        assert_eq!(list_history_events(&conn, 1000).unwrap().len(), 3);

        clear_history_activity(&conn).unwrap();
        assert!(list_history_events(&conn, 1000).unwrap().is_empty());
        assert!(list_history_scans(&conn, 50).unwrap().is_empty());
        assert_eq!(unread_count(&conn), 0);
        assert_eq!(unread_new_count(&conn), 0);
        assert_eq!(list_dashboard_events(&conn, 1000).unwrap().len(), 1, "clearing History leaves Dashboard intact");
        assert_eq!(list_dashboard_resources(&conn, 2000).unwrap().len(), 1);

        insert_event(&conn, Some(deadline_resource.id), Some(course), "new", "Later file", None, "later-new", "t4").unwrap();
        let later_scan = start_scan(&conn, "t4").unwrap();
        finish_scan(&conn, later_scan, "ok", 1, 1, 0, 0, 1, 0, None, false, "t4").unwrap();
        assert_eq!(list_history_events(&conn, 1000).unwrap().len(), 1);
        assert_eq!(list_history_scans(&conn, 50).unwrap().len(), 1);
        assert_eq!(unread_count(&conn), 1);
        assert_eq!(list_events(&conn, false, 1000).unwrap().len(), 4);
        assert_eq!(count_resources(&conn), 3);
        assert_eq!(count_events(&conn), 4);
    }

    #[test]
    fn clear_watermarks_survive_reopening_the_database() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("quanta-pulse-clear-{suffix}.sqlite"));
        {
            let conn = open(&path).unwrap();
            insert_event(&conn, None, None, "new", "Old", None, "old", "t1").unwrap();
            clear_history_activity(&conn).unwrap();
            clear_dashboard_activity(&conn).unwrap();
            assert!(list_history_events(&conn, 100).unwrap().is_empty());
            assert!(list_dashboard_events(&conn, 100).unwrap().is_empty());
        }
        {
            let conn = open(&path).unwrap();
            assert!(list_history_events(&conn, 100).unwrap().is_empty());
            assert!(list_dashboard_events(&conn, 100).unwrap().is_empty());
            insert_event(&conn, None, None, "new", "New", None, "new", "t2").unwrap();
            assert_eq!(list_history_events(&conn, 100).unwrap().len(), 1);
            assert_eq!(list_dashboard_events(&conn, 100).unwrap().len(), 1);
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
    }

    #[test]
    fn events_filter_by_utc_window_and_type() {
        let conn = mem();
        insert_event(&conn, None, None, "new", "a", None, "k1", "2026-10-12T04:52:00Z").unwrap();
        insert_event(&conn, None, None, "updated", "b", None, "k2", "2026-10-12T05:30:00Z").unwrap();
        // Just after local midnight in a +05:30 zone (i.e. the next UTC day).
        insert_event(&conn, None, None, "new", "c", None, "k3", "2026-10-12T18:40:00Z").unwrap();
        insert_event(&conn, None, None, "new", "d", None, "k4", "2026-10-13T02:00:00Z").unwrap();

        let day = list_events_filtered(
            &conn,
            &EventFilter {
                since: Some("2026-10-11T18:30:00Z".into()),
                until: Some("2026-10-12T18:30:00Z".into()),
                ..EventFilter::default()
            },
        )
        .unwrap();
        assert_eq!(day.len(), 2);
        assert!(day.iter().all(|e| e.detected_at.as_str() < "2026-10-12T18:30:00Z"));

        let new_only = list_events_filtered(
            &conn,
            &EventFilter { change_type: Some("new".into()), ..EventFilter::default() },
        )
        .unwrap();
        assert_eq!(new_only.len(), 3);

        let limited = list_events_filtered(
            &conn,
            &EventFilter { limit: Some(2), ..EventFilter::default() },
        )
        .unwrap();
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn paged_history_queries_keep_full_totals_watermarks_filters_and_tie_order() {
        let conn = mem();
        insert_event(
            &conn,
            None,
            None,
            "new",
            "before clear",
            None,
            "before-clear",
            "2026-11-15T00:00:00Z",
        )
        .unwrap();
        let old_scan = start_scan(&conn, "2026-11-15T00:00:00Z").unwrap();
        finish_scan(
            &conn,
            old_scan,
            "ok",
            0,
            0,
            0,
            0,
            0,
            0,
            None,
            false,
            "2026-11-15T00:00:01Z",
        )
        .unwrap();
        clear_history_activity(&conn).unwrap();

        let tx = conn.unchecked_transaction().unwrap();
        for n in 0..1_205 {
            let kind = if n % 2 == 0 { "new" } else { "updated" };
            let title = if n == 1_204 { "Needle result" } else { "event" };
            insert_event(
                &tx,
                None,
                Some(7),
                kind,
                title,
                None,
                &format!("visible-{n}"),
                "2026-11-16T10:00:00Z",
            )
            .unwrap();
        }
        let suppressed_id = tx.last_insert_rowid() + 1;
        insert_event(
            &tx,
            None,
            Some(7),
            "new",
            "suppressed",
            None,
            "suppressed",
            "2026-11-16T10:00:00Z",
        )
        .unwrap();
        tx.execute(
            "UPDATE change_events SET calendar_suppressed=1 WHERE id=?1",
            [suppressed_id],
        )
        .unwrap();
        tx.execute(
            "UPDATE change_events SET read_at='2026-11-16T10:01:00Z' WHERE id=(SELECT MIN(id) FROM change_events WHERE deduplication_key LIKE 'visible-%')",
            [],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO inbox_dismissals(event_id,dismissed_at) SELECT id,'2026-11-16T10:01:00Z' FROM change_events WHERE deduplication_key='visible-2'",
            [],
        )
        .unwrap();
        for n in 0..605 {
            let id = start_scan(&tx, "2026-11-16T10:00:00Z").unwrap();
            finish_scan(
                &tx,
                id,
                "ok",
                0,
                0,
                0,
                0,
                0,
                0,
                None,
                false,
                "2026-11-16T10:01:00Z",
            )
            .unwrap();
            assert_eq!(id, old_scan + 1 + n);
        }
        tx.commit().unwrap();

        let first = query_history_events(
            &conn,
            &HistoryFilter {
                offset: 0,
                limit: 5,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(first.total, 1_205);
        assert_eq!(first.items.len(), 5);
        assert!(
            first.items.windows(2).all(|pair| pair[0].id > pair[1].id),
            "equal timestamps break ties by descending ID"
        );
        let later = query_history_events(
            &conn,
            &HistoryFilter {
                offset: 1_000,
                limit: 20,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(later.total, 1_205);
        assert_eq!(later.items.len(), 20);
        let old_attention_rows = query_history_events(
            &conn,
            &HistoryFilter {
                offset: 1_202,
                limit: 5,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            old_attention_rows
                .items
                .iter()
                .map(|event| event.id)
                .collect::<Vec<_>>(),
            vec![4, 3, 2],
            "read and Inbox-dismissed events remain in History"
        );
        assert!(old_attention_rows.items.last().unwrap().read);
        let search = query_history_events(
            &conn,
            &HistoryFilter {
                search: Some("NEEDLE".into()),
                offset: 0,
                limit: 10,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(search.total, 1);
        assert_eq!(search.items[0].title, "Needle result");
        let typed = query_history_events(
            &conn,
            &HistoryFilter {
                change_type: Some("updated".into()),
                course_id: Some(7),
                offset: 0,
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(typed.total, 602);
        assert_eq!(typed.items.len(), 1);
        let date_range = query_history_events(
            &conn,
            &HistoryFilter {
                since: Some("2026-11-16T10:00:00Z".into()),
                until: Some("2026-11-16T10:00:01Z".into()),
                offset: 0,
                limit: 10,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(date_range.total, 1_205, "since is inclusive and until exclusive");

        let scans = query_history_scans(&conn, &ScanFilter {
            offset: 600,
            limit: 10,
        })
        .unwrap();
        assert_eq!(scans.total, 605);
        assert_eq!(scans.items.len(), 5);
        assert!(
            scans.items.windows(2).all(|pair| pair[0].id > pair[1].id),
            "equal start times break ties by descending ID"
        );
    }

    #[test]
    fn history_bounds_compare_instants_and_reject_invalid_filters() {
        let conn = mem();
        for (n, at) in ["2026-11-16T10:00:00Z", "2026-11-16T10:00:00.500Z", "2026-11-16T10:00:01Z"].iter().enumerate() {
            insert_event(&conn, None, None, "new", "event", None, &format!("bounds-{n}"), at).unwrap();
        }
        let filter = HistoryFilter { offset: 0, limit: 10,
            since: Some("2026-11-16T15:30:00.500+05:30".into()),
            until: Some("2026-11-16T10:00:01Z".into()), ..Default::default() };
        let page = query_history_events(&conn, &filter).unwrap();
        assert_eq!(page.total, 1, "whole seconds before a fractional lower bound are excluded");
        assert_eq!(page.items[0].detected_at, "2026-11-16T10:00:00.500Z");
        for invalid in [
            HistoryFilter { limit: 0, ..filter.clone() },
            HistoryFilter { limit: 1001, ..filter.clone() },
            HistoryFilter { since: Some("not-a-date".into()), ..filter.clone() },
            HistoryFilter { since: filter.until.clone(), ..filter.clone() },
            HistoryFilter { course_id: Some(0), ..filter.clone() },
            HistoryFilter { change_type: Some("unknown".into()), ..filter.clone() },
        ] { assert!(query_history_events(&conn, &invalid).is_err()); }
    }

    #[test]
    fn digest_scopes_sync_metadata_to_the_selected_day() {
        let conn = mem();
        let id = start_scan(&conn, "2026-10-11T10:00:00Z").unwrap();
        finish_scan(&conn, id, "ok", 1, 0, 0, 0, 1, 2, None, false, "2026-10-11T10:00:00Z").unwrap();

        let other = digest(&conn, "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z", "2026-10-12").unwrap();
        assert!(other.last_success_at.is_none());
        assert_eq!(other.courses_failed, 0);

        let day = digest(&conn, "2026-10-11T00:00:00Z", "2026-10-12T00:00:00Z", "2026-10-11").unwrap();
        assert_eq!(day.last_success_at.as_deref(), Some("2026-10-11T10:00:00Z"));
        assert_eq!(day.courses_failed, 2);
    }

    #[test]
    fn miss_streak_promotes_to_unavailable() {        let conn = mem();
        let cid = upsert_course(&conn, "1", "C", None, "u", "t").unwrap();
        let w = ResourceWrite {
            external_id: "m:1",
            course_id: Some(cid),
            title: "T",
            url: "u",
            source_page_url: None,
            section_path: None,
            resource_type: "pdf",
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            fingerprint: "f",
            size_bytes: None,
            section: None,
            is_external: false,
            availability: "available",
        };
        upsert_resource(&conn, &w, "t").unwrap();
        bump_miss_streak(&conn, &["m:1".into()], 2).unwrap();
        assert_eq!(get_resource(&conn, "m:1").unwrap().availability_status, "available");
        bump_miss_streak(&conn, &["m:1".into()], 2).unwrap();
        assert_eq!(get_resource(&conn, "m:1").unwrap().availability_status, "unavailable");
    }

    #[test]
    fn paused_courses_are_reported() {
        let conn = mem();
        let a = upsert_course(&conn, "1", "A", None, "u", "t").unwrap();
        let b = upsert_course(&conn, "2", "B", None, "u", "t").unwrap();
        set_monitoring(&conn, b, "paused").unwrap();
        let paused = paused_course_ids(&conn);
        assert_eq!(paused, vec![b]);
        assert!(!paused.contains(&a));
    }

    fn seed_resources(conn: &Connection) -> (i64, i64) {
        let os = upsert_course(&conn, "10", "Operating Systems", None, "u/10", "t").unwrap();
        let ds = upsert_course(&conn, "11", "Data Structures", None, "u/11", "t").unwrap();
        fn write<'a>(id: &'a str, course: i64, title: &'a str, kind: &'a str, due: Option<&'a str>) -> ResourceWrite<'a> {
            ResourceWrite {
            external_id: id,
            course_id: Some(course),
            title,
            url: "u",
            source_page_url: None,
            section_path: None,
            resource_type: kind,
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: due,
            fingerprint: "fp",
            size_bytes: None,
            section: None,
            is_external: false,
            availability: "available",
            }
        }
        upsert_resource(&conn, &write("mod:resource:1", os, "Lecture 01", "pdf", None), "t").unwrap();
        upsert_resource(
            &conn,
            &write("mod:assign:2", os, "Assignment 1", "assignment", Some("2026-10-20T23:59:00+05:30")),
            "t",
        )
        .unwrap();
        upsert_resource(&conn, &write("mod:quiz:3", ds, "Quiz 1", "quiz", None), "t").unwrap();
        (os, ds)
    }

    /// Regression: the dashboard loads with no filter at all. The query used to
    /// bind `:course`/`:search` even though the SQL omitted them, which made the
    /// very first `list_resources` call fail with `Invalid parameter name`.
    #[test]
    fn list_resources_without_filters_succeeds() {
        let conn = mem();
        seed_resources(&conn);
        let all = list_resources(
            &conn,
            &ResourceFilter { limit: Some(500), ..ResourceFilter::default() },
        )
        .expect("unfiltered listing must not error");
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn list_resources_filters_by_course() {
        let conn = mem();
        let (os, ds) = seed_resources(&conn);
        let by_course = list_resources(
            &conn,
            &ResourceFilter { course_id: Some(os), ..ResourceFilter::default() },
        )
        .unwrap();
        assert_eq!(by_course.len(), 2);
        assert!(by_course.iter().all(|r| r.course_id == Some(os)));
        let by_ds = list_resources(
            &conn,
            &ResourceFilter { course_id: Some(ds), ..ResourceFilter::default() },
        )
        .unwrap();
        assert_eq!(by_ds.len(), 1);
    }

    #[test]
    fn list_resources_filters_by_search_and_kind() {
        let conn = mem();
        seed_resources(&conn);
        let search = list_resources(
            &conn,
            &ResourceFilter { search: Some("quiz".into()), ..ResourceFilter::default() },
        )
        .unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].title, "Quiz 1");
        // Searching by course name matches too.
        let by_course_name = list_resources(
            &conn,
            &ResourceFilter { search: Some("operating".into()), ..ResourceFilter::default() },
        )
        .unwrap();
        assert_eq!(by_course_name.len(), 2);

        let deadlines = list_resources(
            &conn,
            &ResourceFilter { kind: Some("deadlines".into()), ..ResourceFilter::default() },
        )
        .unwrap();
        assert_eq!(deadlines.len(), 1);
        assert_eq!(deadlines[0].title, "Assignment 1");
    }

    #[test]
    fn list_resources_combined_filters() {
        let conn = mem();
        let (os, _) = seed_resources(&conn);
        let rows = list_resources(
            &conn,
            &ResourceFilter {
                course_id: Some(os),
                search: Some("lecture".into()),
                ..ResourceFilter::default()
            },
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Lecture 01");
    }

    #[test]
    fn resources_are_ordered_newest_first() {
        let conn = mem();
        let cid = upsert_course(&conn, "10", "C", None, "u", "t").unwrap();
        fn mk<'a>(id: &'a str, published: &'a str, cid: i64) -> ResourceWrite<'a> {
            ResourceWrite {
            external_id: id,
            course_id: Some(cid),
            title: id,
            url: "u",
            source_page_url: None,
            section_path: None,
            resource_type: "pdf",
            uploaded_at: None,
            published_at: Some(published),
            modified_at: None,
            due_at: None,
            fingerprint: "fp",
            size_bytes: None,
            section: None,
            is_external: false,
            availability: "available",
            }
        }
        upsert_resource(&conn, &mk("old", "2026-10-01T00:00:00+05:30", cid), "t").unwrap();
        upsert_resource(&conn, &mk("new", "2026-10-11T00:00:00+05:30", cid), "t").unwrap();
        let rows = list_resources(&conn, &ResourceFilter::default()).unwrap();
        assert_eq!(rows[0].title, "new");
        assert_eq!(rows[1].title, "old");
    }

    #[test]
    fn course_tree_cleanup_is_once_only_and_preserves_recent_registrations() {
        let conn = mem();
        del_kv(&conn, COURSE_TREE_CALENDAR_CLEANUP_KEY).unwrap();
        let course_id = upsert_course(&conn, "math-1", "MATH F211", None, "https://x/course/1", "t0").unwrap();

        fn add_resource(conn: &Connection, course_id: i64, id: &str, first_seen: &str) -> i64 {
            let write = ResourceWrite {
                external_id: id,
                course_id: Some(course_id),
                title: id,
                url: id,
                source_page_url: None,
                resource_type: "pdf",
                uploaded_at: None,
                published_at: None,
                modified_at: None,
                due_at: None,
                fingerprint: "fp",
                size_bytes: None,
                section: None,
                section_path: None,
                is_external: false,
                availability: "available",
            };
            upsert_resource(conn, &write, first_seen).unwrap()
        }

        let old = add_resource(&conn, course_id, "old-resource", "2026-10-11T23:00:00Z");
        let recent_update = add_resource(&conn, course_id, "recent-resource", "2026-10-12T04:52:45Z");
        let recent_new = add_resource(&conn, course_id, "new-resource", "2026-10-12T12:12:13Z");
        let incident_at = COURSE_TREE_INCIDENT_COMPLETED_AT;
        let scan_id = start_scan(&conn, "2026-10-12T12:11:27Z").unwrap();
        finish_scan(&conn, scan_id, "ok", 3, 1, 2, 0, 1, 0, None, false, incident_at).unwrap();
        insert_event(&conn, Some(old), Some(course_id), "updated", "Old updated", None, "k-old", incident_at).unwrap();
        insert_event(
            &conn,
            Some(recent_update),
            Some(course_id),
            "updated",
            "Recent resource updated",
            None,
            "k-recent-update",
            incident_at,
        )
        .unwrap();
        insert_event(
            &conn,
            Some(recent_new),
            Some(course_id),
            "new",
            "Recent resource new",
            None,
            "k-recent-new",
            incident_at,
        )
        .unwrap();

        apply_course_tree_incident_cleanup(&conn, "2026-10-12T12:28:39Z").unwrap();
        let suppressed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM change_events WHERE calendar_suppressed = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(suppressed, 1);
        assert_eq!(list_events(&conn, false, 20).unwrap().len(), 2);
        assert_eq!(unread_count(&conn), 2);
        assert_eq!(unread_new_count(&conn), 1);
        assert_eq!(list_resources(&conn, &ResourceFilter::default()).unwrap().len(), 3);
        let scan = list_scans(&conn, 1).unwrap().remove(0);
        assert_eq!(scan.new_count, 1);
        assert_eq!(scan.updated_count, 1);
        assert_eq!(get_resource(&conn, "old-resource").unwrap().first_seen_at, "2026-10-11T23:00:00Z");

        let marker = get_kv(&conn, COURSE_TREE_CALENDAR_CLEANUP_KEY).unwrap();
        assert!(marker.contains(r#""cutoff":"2026-10-12T00:28:39Z""#));
        apply_course_tree_incident_cleanup(&conn, "2026-10-13T12:00:00Z").unwrap();
        assert_eq!(get_kv(&conn, COURSE_TREE_CALENDAR_CLEANUP_KEY).unwrap(), marker);
        assert_eq!(list_events(&conn, false, 20).unwrap().len(), 2);

        let future = add_resource(&conn, course_id, "future-resource", "2026-10-12T12:30:00Z");
        insert_event(
            &conn,
            Some(future),
            Some(course_id),
            "new",
            "Future new resource",
            None,
            "k-future",
            "2026-10-12T12:31:00Z",
        )
        .unwrap();
        assert_eq!(list_events(&conn, false, 20).unwrap().len(), 3);
        assert_eq!(unread_new_count(&conn), 2);
        assert_eq!(list_resources(&conn, &ResourceFilter::default()).unwrap().len(), 4);
    }

    #[test]
    fn fingerprint_migration_removes_section_metadata_without_changing_first_seen() {
        use sha2::Digest;

        let conn = mem();
        del_kv(&conn, RESOURCE_FINGERPRINT_V2_KEY).unwrap();
        let course_id = upsert_course(&conn, "10", "C", None, "u", "t0").unwrap();
        let mut old_hasher = sha2::Sha256::new();
        for part in ["Lecture 1", "pdf", "", "", "", "", "Old section", "1024"] {
            old_hasher.update(part.as_bytes());
            old_hasher.update(b"\x1f");
        }
        let old_fingerprint = hex::encode(&old_hasher.finalize()[..16]);
        let write = ResourceWrite {
            external_id: "mod:resource:1",
            course_id: Some(course_id),
            title: "Lecture 1",
            url: "https://x/lecture1.pdf",
            source_page_url: None,
            resource_type: "pdf",
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            fingerprint: &old_fingerprint,
            size_bytes: Some(1024),
            section: Some("Old section"),
            section_path: Some(r#"["Old section"]"#),
            is_external: false,
            availability: "available",
        };
        upsert_resource(&conn, &write, "2026-10-11T00:00:00Z").unwrap();

        migrate(&conn).unwrap();
        let resource = get_resource(&conn, "mod:resource:1").unwrap();
        assert_eq!(resource.first_seen_at, "2026-10-11T00:00:00Z");
        let expected = crate::quanta::content_fingerprint(
            "Lecture 1",
            "pdf",
            None,
            None,
            None,
            None,
            Some(1024),
        );
        assert_eq!(
            resource.content_fingerprint.as_deref(),
            Some(expected.as_str())
        );
    }

    /* --------------------------------------------------------- local mirror */

    /// Mirror priorities. Re-exported from `core::mirror` so the test and the
    /// worker cannot disagree about which tier means what.
    const P_BACKFILL: i64 = 2;
    const P_CHANGED: i64 = 1;
    const P_ON_DEMAND: i64 = 0;

    fn seed_resource(
        conn: &Connection,
        course_id: i64,
        external_id: &str,
        title: &str,
        uploaded_at: Option<&str>,
        size_bytes: Option<i64>,
    ) -> i64 {
        upsert_resource(
            conn,
            &ResourceWrite {
                external_id,
                course_id: Some(course_id),
                title,
                url: "https://quanta/mod/resource/view.php",
                source_page_url: None,
                resource_type: "pdf",
                uploaded_at,
                published_at: None,
                modified_at: None,
                due_at: None,
                fingerprint: "fp",
                size_bytes,
                section: None,
                section_path: None,
                is_external: false,
                availability: "available",
            },
            &now_rfc3339(),
        )
        .unwrap()
    }

    fn seeded_course(conn: &Connection) -> i64 {
        upsert_course(conn, "10", "CS F222", None, "https://x/10", "t0").unwrap()
    }

    #[test]
    fn mirror_rows_round_trip_and_report_bytes() {
        let conn = mem();
        let course = seeded_course(&conn);
        let rid = seed_resource(&conn, course, "mod:resource:1", "Lecture 1", None, Some(100));

        let row = MirrorRow {
            resource_id: rid,
            rel_path: "CS F222/Unit 1/Lecture 1.pdf".into(),
            sha256: Some("abc".into()),
            size_bytes: 100,
            mime: Some("application/pdf".into()),
            status: "ok".into(),
            error: None,
            attempts: 2,
            source_etag: Some("\"v1\"".into()),
            source_modified: None,
            downloaded_at: Some("t1".into()),
            last_checked: Some("t2".into()),
        };
        mirror_upsert(&conn, &row).unwrap();

        let stored = mirror_get(&conn, rid).unwrap().expect("row exists");
        assert_eq!(stored.rel_path, "CS F222/Unit 1/Lecture 1.pdf");
        assert_eq!(stored.sha256.as_deref(), Some("abc"));
        assert_eq!(stored.attempts, 2);
        assert_eq!(stored.source_etag.as_deref(), Some("\"v1\""));
        assert_eq!(stored.status, "ok");
        assert_eq!(
            mirror_bytes(&conn).unwrap(),
            (100, 1),
            "the indexed bytes are the ones actually written"
        );
        assert!(mirror_get(&conn, rid + 999).unwrap().is_none());
    }

    #[test]
    fn the_queue_runs_newest_uploads_first_within_a_priority_tier() {
        let conn = mem();
        let course = seeded_course(&conn);
        let older = seed_resource(&conn, course, "mod:resource:1", "Lecture 1", Some("2026-01-01T00:00:00Z"), None);
        let newer = seed_resource(&conn, course, "mod:resource:2", "Lecture 2", Some("2026-01-09T00:00:00Z"), None);
        let backfill = seed_resource(&conn, course, "mod:resource:3", "Lecture 3", Some("2026-01-05T00:00:00Z"), None);

        queue_enqueue(&conn, older, P_CHANGED, "t0").unwrap();
        queue_enqueue(&conn, newer, P_CHANGED, "t0").unwrap();
        queue_enqueue(&conn, backfill, P_BACKFILL, "t0").unwrap();

        let order: Vec<i64> = queue_next(&conn, 10)
            .unwrap()
            .iter()
            .map(|q| q.resource_id)
            .collect();
        assert_eq!(order, vec![newer, older, backfill]);

        // An on-demand request jumps the queue.
        queue_enqueue(&conn, backfill, P_ON_DEMAND, "t1").unwrap();
        let order: Vec<i64> = queue_next(&conn, 10)
            .unwrap()
            .iter()
            .map(|q| q.resource_id)
            .collect();
        assert_eq!(order, vec![backfill, newer, older]);

        // Re-enqueuing can only lower a priority, never raise it.
        queue_enqueue(&conn, backfill, P_BACKFILL, "t2").unwrap();
        let priority: i64 = conn
            .query_row(
                "SELECT priority FROM download_queue WHERE resource_id = ?1",
                params![backfill],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(priority, P_ON_DEMAND);
    }

    #[test]
    fn backfill_queues_only_what_has_no_local_copy_and_survives_reopening() {
        let conn = mem();
        let course = seeded_course(&conn);
        let first = seed_resource(&conn, course, "mod:resource:1", "Lecture 1", None, None);
        let second = seed_resource(&conn, course, "mod:resource:2", "Lecture 2", None, None);

        assert_eq!(queue_backfill(&conn, "t0").unwrap(), 2);
        assert_eq!(queue_backfill(&conn, "t1").unwrap(), 0, "already queued");

        // Downloading one removes it from the work list but not the record.
        queue_remove(&conn, first).unwrap();
        mirror_upsert(
            &conn,
            &MirrorRow {
                resource_id: second,
                rel_path: "CS F222/Lecture 2.pdf".into(),
                sha256: Some("h".into()),
                size_bytes: 10,
                mime: None,
                status: "ok".into(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some("t2".into()),
                last_checked: Some("t2".into()),
            },
        )
        .unwrap();

        // Only the still-missing resource is queued again.
        let result = queue_backfill(&conn, "t3").unwrap();
        assert_eq!(result, 1, "resource 1 should be queued again");
        // Resource 2 is still in the queue from the initial backfill (we never remove
        // queued items when they get a local file). queue_next returns the newest
        // upload first, so resource 2 comes before resource 1.
        let next = queue_next(&conn, 10).unwrap();
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].resource_id, second);
        assert_eq!(next[1].resource_id, first);
    }

    #[test]
    fn an_unavailable_resource_keeps_its_local_copy_and_is_relabelled() {
        let conn = mem();
        let course = seeded_course(&conn);
        let rid = seed_resource(&conn, course, "mod:resource:1", "Lecture 1", None, Some(64));
        mirror_upsert(
            &conn,
            &MirrorRow {
                resource_id: rid,
                rel_path: "CS F222/Lecture 1.pdf".into(),
                sha256: Some("h".into()),
                size_bytes: 64,
                mime: Some("application/pdf".into()),
                status: "ok".into(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some("t1".into()),
                last_checked: Some("t1".into()),
            },
        )
        .unwrap();

        // Two misses later the resource reads as unavailable.
        set_availability(&conn, rid, "unavailable").unwrap();
        let changed = conn
            .execute(
                "UPDATE local_files SET status = 'kept'
                  WHERE status IN ('ok', 'failed', 'skipped')
                    AND resource_id IN (SELECT id FROM resources WHERE availability_status = 'unavailable')",
                [],
            )
            .unwrap();

        assert_eq!(changed, 1);
        let stored = mirror_get(&conn, rid).unwrap().unwrap();
        assert_eq!(stored.status, "kept");
        assert_eq!(stored.rel_path, "CS F222/Lecture 1.pdf", "the path survives");
        assert_eq!(
            mirror_bytes(&conn).unwrap(),
            (64, 1),
            "'kept' is still on disk, so it still counts as saved"
        );
    }

    #[test]
    fn version_prune_keeps_the_newest_and_reports_the_rest() {
        let conn = mem();
        let course = seeded_course(&conn);
        let rid = seed_resource(&conn, course, "mod:resource:1", "Lecture 1", None, None);
        for day in ["2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z", "2026-03-03T00:00:00Z"] {
            version_insert(
                &conn,
                &MirrorVersion {
                    resource_id: rid,
                    rel_path: "CS F222/Lecture 1.pdf".into(),
                    sha256: Some(day.into()),
                    size_bytes: 10,
                    replaced_at: day.into(),
                },
            )
            .unwrap();
        }

        assert_eq!(version_list(&conn, rid).unwrap().len(), 3);
        let dropped = version_prune(&conn, rid, 2).unwrap();
        assert_eq!(dropped.len(), 1);
        assert_eq!(dropped[0].replaced_at, "2026-03-01T00:00:00Z", "the oldest goes");
        assert_eq!(version_list(&conn, rid).unwrap().len(), 2);

        // A keep of 0 removes every history entry.
        assert_eq!(version_prune(&conn, rid, 0).unwrap().len(), 2);
        assert!(version_list(&conn, rid).unwrap().is_empty());
    }

    #[test]
    fn deleting_a_resource_deletes_its_mirror_rows() {
        let conn = mem();
        let course = seeded_course(&conn);
        let rid = seed_resource(&conn, course, "mod:resource:1", "Lecture 1", None, None);
        mirror_upsert(
            &conn,
            &MirrorRow {
                resource_id: rid,
                rel_path: "CS F222/Lecture 1.pdf".into(),
                sha256: None,
                size_bytes: 0,
                mime: None,
                status: "failed".into(),
                error: Some("boom".into()),
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: None,
                last_checked: None,
            },
        )
        .unwrap();
        queue_enqueue(&conn, rid, P_ON_DEMAND, "t0").unwrap();

        conn.execute("DELETE FROM resources WHERE id = ?1", params![rid]).unwrap();
        assert!(mirror_get(&conn, rid).unwrap().is_none());
        assert_eq!(queue_len(&conn), 0, "a queue row for a dead resource is gone too");
    }

    #[test]
    fn upgrade_backs_up_semantic_zero_nine_to_zero_ten() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.9.0").unwrap();
        set_kv(&conn, SCHEMA_REVISION_KEY, "8").unwrap();
        conn.execute_batch("CREATE TABLE legacy (id INTEGER); INSERT INTO legacy VALUES (1);")
            .unwrap();

        upgrade(&conn, &path, "0.10.0").unwrap();

        let names = backup_names(&dir);
        assert_eq!(names.len(), 1, "one backup expected: {names:?}");
        assert!(names[0].starts_with("quanta-pulse-0.9.0-"), "{}", names[0]);
        assert_eq!(get_kv(&conn, LAST_APP_VERSION_KEY).as_deref(), Some("0.10.0"));
        assert_eq!(get_kv(&conn, SCHEMA_REVISION_KEY).as_deref(), Some("8"));
    }

    #[test]
    fn upgrade_backs_up_prerelease_progression() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.2.0-rc.1").unwrap();
        set_kv(&conn, SCHEMA_REVISION_KEY, "8").unwrap();

        upgrade(&conn, &path, "0.2.0").unwrap();

        let names = backup_names(&dir);
        assert_eq!(names.len(), 1, "one backup expected: {names:?}");
        assert!(names[0].starts_with("quanta-pulse-0.2.0-rc.1-"), "{}", names[0]);
    }

    #[test]
    fn upgrade_backs_up_numeric_prerelease_progression() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.2.0-rc.2").unwrap();
        set_kv(&conn, SCHEMA_REVISION_KEY, &CURRENT_SCHEMA_REVISION.to_string()).unwrap();

        upgrade(&conn, &path, "0.2.0-rc.10").unwrap();

        assert_eq!(backup_names(&dir).len(), 1);
    }

    #[test]
    fn upgrade_prerelease_order_and_metadata_control_backups() {
        for (recorded, running, expected_backups) in [
            ("0.2.0-rc.10", "0.2.0-rc.2", 0),
            ("0.2.0-1", "0.2.0-alpha", 1),
            ("0.2.0-alpha", "0.2.0-1", 0),
            ("0.2.0-beta", "0.2.0-beta.1", 1),
            ("0.2.0-beta.1", "0.2.0-beta", 0),
            ("0.2.0-rc.2+old", "0.2.0-rc.2+new", 0),
            ("0.2.0-rc.2+old", "0.2.0-rc.10+new", 1),
            ("0.2.0-rc.999999999999999999999", "0.2.0-rc.1000000000000000000000", 1),
        ] {
            let (dir, path, conn) = file_db();
            set_kv(&conn, LAST_APP_VERSION_KEY, recorded).unwrap();
            set_kv(&conn, SCHEMA_REVISION_KEY, &CURRENT_SCHEMA_REVISION.to_string()).unwrap();

            upgrade(&conn, &path, running).unwrap();

            assert_eq!(
                backup_names(&dir).len(),
                expected_backups,
                "backup decision for {recorded} -> {running}"
            );
        }
    }

    #[test]
    fn upgrade_no_backup_same_version_current_schema() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.2.0").unwrap();
        set_kv(&conn, SCHEMA_REVISION_KEY, "8").unwrap();

        upgrade(&conn, &path, "0.2.0").unwrap();

        assert!(!dir.path().join("backups").exists());
    }

    #[test]
    fn upgrade_backs_up_pending_same_version_schema_revision() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.2.0").unwrap();
        set_kv(&conn, SCHEMA_REVISION_KEY, "7").unwrap();
        conn.execute_batch("CREATE TABLE legacy (id INTEGER); INSERT INTO legacy VALUES (1);")
            .unwrap();

        upgrade(&conn, &path, "0.2.0").unwrap();

        let names = backup_names(&dir);
        assert_eq!(names.len(), 1, "one backup expected: {names:?}");
        let backup = Connection::open(dir.path().join("backups").join(&names[0])).unwrap();
        let count: i64 = backup.query_row("SELECT COUNT(*) FROM legacy", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upgrade_refuses_unsupported_newer_schema() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.2.0").unwrap();
        set_kv(&conn, SCHEMA_REVISION_KEY, "99").unwrap();

        let result = upgrade(&conn, &path, "0.2.0");
        let err = result.expect_err("newer schema must be refused");
        assert!(err.contains("newer"), "unexpected error: {err}");
        assert_eq!(get_kv(&conn, LAST_APP_VERSION_KEY).as_deref(), Some("0.2.0"));
        assert_eq!(get_kv(&conn, SCHEMA_REVISION_KEY).as_deref(), Some("99"));
        assert!(!dir.path().join("backups").exists());
    }

    #[test]
    fn upgrade_unknown_legacy_still_backs_up() {
        let (dir, path, conn) = file_db();
        // No recorded version, but user data present.
        conn.execute_batch("CREATE TABLE legacy (id INTEGER); INSERT INTO legacy VALUES (1);")
            .unwrap();

        upgrade(&conn, &path, "0.2.0").unwrap();

        let names = backup_names(&dir);
        assert_eq!(names.len(), 1, "one backup expected: {names:?}");
        assert!(names[0].starts_with("quanta-pulse-unknown-"), "{}", names[0]);
    }

    #[test]
    fn upgrade_idempotent_reopen_records_revision() {
        let (dir, path, conn) = file_db();
        set_kv(&conn, LAST_APP_VERSION_KEY, "0.1.0").unwrap();
        upgrade(&conn, &path, "0.2.0").unwrap();
        drop(conn);
        let reopened = Connection::open(&path).unwrap();
        // Re-running upgrade at same version/schema must not back up again.
        let before = backup_names(&dir).len();
        upgrade(&reopened, &path, "0.2.0").unwrap();
        let after = backup_names(&dir).len();
        assert_eq!(before, after);
        assert_eq!(get_kv(&reopened, SCHEMA_REVISION_KEY).as_deref(), Some("8"));
    }
}

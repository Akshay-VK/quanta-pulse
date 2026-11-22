//! Real file SQLite upgrade and restore compatibility.
use crate::db;
#[test]
fn academic_upgrade_failure_rolls_back_and_backup_restores_populated_legacy() {
    let data = tempfile::tempdir().unwrap();
    let path = data.path().join("legacy.sqlite");
    let conn = db::open(&path).unwrap();
    // Revision-8 state, including private unowned legacy data: never adopt it.
    conn.execute_batch("DROP TABLE academic_assignments; DROP TABLE academic_grades; DROP TABLE academic_attendance; DROP TABLE academic_coverage; CREATE TABLE legacy_academic(value TEXT); INSERT INTO legacy_academic VALUES ('unowned private');").unwrap();
    db::set_kv(&conn, db::SCHEMA_REVISION_KEY, "8").unwrap();
    db::set_kv(&conn, "baseline_reset_generation", "17").unwrap();
    db::set_kv(&conn, "retained_marker", "keep").unwrap();
    conn.execute_batch("CREATE TRIGGER reject_revision BEFORE INSERT ON settings WHEN NEW.key='schema_revision' AND NEW.value='9' BEGIN SELECT RAISE(ABORT,'synthetic revision failure'); END;").unwrap();
    assert!(db::upgrade(&conn, &path, env!("CARGO_PKG_VERSION")).is_err());
    assert_eq!(
        db::get_kv(&conn, db::SCHEMA_REVISION_KEY).as_deref(),
        Some("8")
    );
    let academic_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'academic_%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        academic_tables, 0,
        "failed migration must not leave expanded tables"
    );
    let backup = std::fs::read_dir(data.path().join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let restored = rusqlite::Connection::open(&backup).unwrap();
    assert_eq!(
        db::get_kv(&restored, "baseline_reset_generation").as_deref(),
        Some("17")
    );
    assert_eq!(
        restored
            .query_row("SELECT value FROM legacy_academic", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "unowned private"
    );
    restored
        .execute_batch("DROP TRIGGER reject_revision")
        .unwrap();
    db::upgrade(&restored, &backup, env!("CARGO_PKG_VERSION")).unwrap();
    assert_eq!(
        restored
            .query_row("SELECT COUNT(*) FROM academic_assignments", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db::get_kv(&restored, "retained_marker").as_deref(),
        Some("keep")
    );
}

fn seed_material(conn: &rusqlite::Connection) -> i64 {
    let time = "2026-11-21T00:00:00Z";
    let course = db::upsert_course(
        conn,
        "course-101",
        "Course",
        None,
        "https://quanta.bits-pilani.ac.in/course/view.php?id=101",
        time,
    )
    .unwrap();
    let resource = db::upsert_resource(
        conn,
        &db::ResourceWrite {
            external_id: "mod:13",
            course_id: Some(course),
            title: "Retained material",
            url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=13",
            source_page_url: None,
            resource_type: "file",
            uploaded_at: Some(time),
            published_at: None,
            modified_at: None,
            due_at: None,
            fingerprint: "retained-fingerprint",
            size_bytes: Some(12),
            section: Some("Week 1"),
            section_path: Some("[\"Week 1\"]"),
            is_external: false,
            availability: "available",
        },
        time,
    )
    .unwrap();
    db::insert_event(
        conn,
        Some(resource),
        Some(course),
        "new",
        "Retained material",
        None,
        "retained-event",
        time,
    )
    .unwrap();
    let event = db::list_history_events(conn, 10).unwrap()[0].id;
    crate::attention::set_event_read_state(conn, &[event], true, time).unwrap();
    crate::attention::dismiss_inbox(conn, &[event], time).unwrap();
    db::mirror_upsert(
        conn,
        &db::MirrorRow {
            resource_id: resource,
            rel_path: "Course/retained.pdf".into(),
            sha256: Some("retained-hash".into()),
            size_bytes: 12,
            mime: Some("application/pdf".into()),
            status: "ok".into(),
            error: None,
            attempts: 1,
            source_etag: None,
            source_modified: None,
            downloaded_at: Some(time.into()),
            last_checked: None,
        },
    )
    .unwrap();
    db::version_insert(
        conn,
        &db::MirrorVersion {
            resource_id: resource,
            rel_path: ".history/retained-v1.pdf".into(),
            sha256: Some("previous-hash".into()),
            size_bytes: 10,
            replaced_at: time.into(),
        },
    )
    .unwrap();
    let mut settings = crate::settings::Settings::default();
    settings.mirror_keep_versions = 7;
    db::save_settings(conn, &settings).unwrap();
    db::set_kv(conn, "baseline_reset_generation", "17").unwrap();
    db::set_kv(conn, "baseline_global_reset_generation", "16").unwrap();
    resource
}
fn assert_material(conn: &rusqlite::Connection, id: i64) {
    let resource = db::get_resource(conn, "mod:13").unwrap();
    assert_eq!(resource.id, id);
    assert_eq!(
        resource.content_fingerprint.as_deref(),
        Some("retained-fingerprint")
    );
    assert_eq!(resource.section_path, vec!["Week 1".to_string()]);
    let event = &db::list_history_events(conn, 10).unwrap()[0];
    assert!(event.read);
    assert_eq!(
        crate::attention::inbox(conn, &crate::models::InboxFilter::default())
            .unwrap()
            .total,
        0
    );
    assert_eq!(
        db::mirror_get(conn, id).unwrap().unwrap().rel_path,
        "Course/retained.pdf"
    );
    assert_eq!(
        db::version_list(conn, id).unwrap()[0].rel_path,
        ".history/retained-v1.pdf"
    );
    assert_eq!(db::load_settings(conn).mirror_keep_versions, 7);
    assert_eq!(
        db::get_kv(conn, "baseline_reset_generation").as_deref(),
        Some("17")
    );
    assert_eq!(
        db::get_kv(conn, "baseline_global_reset_generation").as_deref(),
        Some("16")
    );
}
#[test]
fn populated_legacy_upgrade_and_consistent_backup_restore_preserve_material_contracts() {
    let data = tempfile::tempdir().unwrap();
    let path = data.path().join("legacy.sqlite");
    let conn = db::open(&path).unwrap();
    let id = seed_material(&conn);
    let mirror_dir = data.path().join("mirror");
    std::fs::create_dir_all(mirror_dir.join("Course")).unwrap();
    std::fs::create_dir_all(mirror_dir.join(".history")).unwrap();
    std::fs::write(
        mirror_dir.join("Course/retained.pdf"),
        b"retained current bytes",
    )
    .unwrap();
    std::fs::write(
        mirror_dir.join(".history/retained-v1.pdf"),
        b"retained previous bytes",
    )
    .unwrap();
    conn.execute_batch("DROP TABLE academic_assignments; DROP TABLE academic_grades; DROP TABLE academic_attendance; DROP TABLE academic_coverage;").unwrap();
    db::set_kv(&conn, db::SCHEMA_REVISION_KEY, "8").unwrap();
    db::upgrade(&conn, &path, env!("CARGO_PKG_VERSION")).unwrap();
    assert_material(&conn, id);
    let backups: Vec<_> = std::fs::read_dir(data.path().join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(backups.len(), 1);
    let legacy = rusqlite::Connection::open(&backups[0]).unwrap();
    assert_material(&legacy, id);
    assert_eq!(
        db::get_kv(&legacy, db::SCHEMA_REVISION_KEY).as_deref(),
        Some("8")
    );
    drop(legacy);
    let restored_path = data.path().join("restored.sqlite");
    std::fs::copy(&backups[0], &restored_path).unwrap();
    let restored = db::open(&restored_path).unwrap();
    assert_material(&restored, id);
    drop(restored);
    let restored = db::open(&restored_path).unwrap();
    assert_material(&restored, id);
    assert_eq!(
        std::fs::read(mirror_dir.join("Course/retained.pdf")).unwrap(),
        b"retained current bytes"
    );
    assert_eq!(
        std::fs::read(mirror_dir.join(".history/retained-v1.pdf")).unwrap(),
        b"retained previous bytes"
    );
    // Unsupported newer store is rejected without changing even populated rows.
    db::set_kv(&restored, db::SCHEMA_REVISION_KEY, "99").unwrap();
    assert!(
        db::upgrade(&restored, &restored_path, env!("CARGO_PKG_VERSION"))
            .unwrap_err()
            .contains("newer")
    );
    assert_material(&restored, id);
}

#[test]
fn unknown_or_conflicting_schema_revisions_cannot_bypass_the_newer_store_guard() {
    for revision in ["9223372036854775808", "-1", "future"] {
        let data = tempfile::tempdir().unwrap();
        let path = data.path().join("store.sqlite");
        let conn = db::open(&path).unwrap();
        let id = seed_material(&conn);
        db::set_kv(&conn, db::SCHEMA_REVISION_KEY, revision).unwrap();
        assert!(db::upgrade(&conn, &path, env!("CARGO_PKG_VERSION")).is_err());
        assert_eq!(
            db::get_kv(&conn, db::SCHEMA_REVISION_KEY).as_deref(),
            Some(revision)
        );
        assert_material(&conn, id);
    }
    let data = tempfile::tempdir().unwrap();
    let path = data.path().join("store.sqlite");
    let conn = db::open(&path).unwrap();
    db::set_kv(&conn, "db_schema_revision", "99").unwrap();
    assert!(db::upgrade(&conn, &path, env!("CARGO_PKG_VERSION")).is_err());
}

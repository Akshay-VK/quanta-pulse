//! Desktop metadata search helpers. Keeps search-specific reads out of the
//! larger database module so concurrent edits stay small.

use crate::db::{self, ResourceFilter};
use crate::models::{Course, DesktopSearchInventory, Resource};
use rusqlite::Connection;

/// Read complete metadata and canonical unread facts in one SQLite transaction,
/// so scans and read mutations cannot split the published search state.
pub fn desktop_inventory(conn: &Connection) -> rusqlite::Result<DesktopSearchInventory> {
    // A read transaction also fences writers using a different SQLite connection.
    let tx = conn.unchecked_transaction()?;
    let courses: Vec<Course> = db::list_courses(&tx)?;
    let resources: Vec<Resource> = db::list_resources(
        &tx,
        &ResourceFilter {
            // SQLite LIMIT -1 means no cap; this complete-read command owns it.
            limit: Some(-1),
            offset: Some(0),
            ..ResourceFilter::default()
        },
    )?;
    let unread_resource_ids = crate::attention::unread_resource_ids(&tx)?;
    tx.commit()?;
    Ok(DesktopSearchInventory {
        courses,
        resources,
        unread_resource_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn desktop_inventory_returns_complete_refresh_after_rename_update_and_delete() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn.execute("INSERT INTO courses(id, external_course_id, name, url, first_seen_at) VALUES(1, 'c1', 'Before', 'https://example.test', '2026-11-21T00:00:00Z')", []).unwrap();
        for id in 1..=2501 {
            conn.execute("INSERT INTO resources(id, external_resource_id, course_id, title, url, resource_type, first_seen_at) VALUES(?1, ?2, 1, 'Lecture', 'https://example.test', 'pdf', '2026-11-21T00:00:00Z')", rusqlite::params![id, format!("r{id}")]).unwrap();
        }
        let before = desktop_inventory(&conn).unwrap();
        assert_eq!(before.resources.len(), 2501);
        assert_eq!(
            before
                .resources
                .iter()
                .map(|r| r.id)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            2501
        );
        conn.execute_batch("BEGIN; UPDATE courses SET name='After'; DELETE FROM resources WHERE id=2; UPDATE resources SET title='Updated' WHERE id=2501; COMMIT;").unwrap();
        let after = desktop_inventory(&conn).unwrap();
        assert_eq!(after.courses[0].name, "After");
        assert_eq!(after.resources.len(), 2500);
        assert!(after
            .resources
            .iter()
            .all(|r| r.course_name.as_deref() == Some("After")));
        assert!(!after.resources.iter().any(|r| r.id == 2));
        assert_eq!(
            after.resources.iter().find(|r| r.id == 2501).unwrap().title,
            "Updated"
        );
        assert_eq!(before.courses[0].name, "Before");
        conn.execute_batch("DROP TABLE resources").unwrap();
        assert!(desktop_inventory(&conn).is_err());
    }
    #[test]
    fn desktop_inventory_is_coherent_while_another_connection_commits() {
        use std::sync::{Arc, Barrier};
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("search.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        db::migrate(&conn).unwrap();
        conn.execute_batch("INSERT INTO courses(id,external_course_id,name,url,first_seen_at) VALUES(1,'c1','0','https://example.test','2026-11-21T00:00:00Z'); BEGIN;").unwrap();
        for id in 1..=2501 {
            conn.execute("INSERT INTO resources(id,external_resource_id,course_id,title,url,resource_type,first_seen_at) VALUES(?1,?2,1,'0','https://example.test','pdf','2026-11-21T00:00:00Z')", rusqlite::params![id, format!("r{id}")]).unwrap();
        }
        conn.execute_batch("INSERT INTO change_events(id,resource_id,course_id,change_type,title,detected_at,deduplication_key) VALUES(1,2501,1,'new','New','2026-11-21T00:00:00Z','canonical'); COMMIT;").unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let writer_barrier = barrier.clone();
        let writer = std::thread::spawn(move || {
            let mut writer = Connection::open(path).unwrap();
            writer
                .busy_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            writer_barrier.wait();
            for generation in 1..=80 {
                let tx = writer.transaction().unwrap();
                let marker = generation.to_string();
                tx.execute("UPDATE courses SET name=?1", [&marker]).unwrap();
                tx.execute("UPDATE resources SET title=?1", [&marker])
                    .unwrap();
                // Both sides of a would-be 2,000-row page boundary change together.
                tx.execute("DELETE FROM resources WHERE id IN (1,3000)", [])
                    .unwrap();
                let id = if generation % 2 == 0 { 1 } else { 3000 };
                tx.execute("INSERT INTO resources(id,external_resource_id,course_id,title,url,resource_type,first_seen_at) VALUES(?1,?2,1,?3,'https://example.test','pdf','2026-11-21T00:00:00Z')", rusqlite::params![id, format!("r{id}"), marker]).unwrap();
                tx.execute("UPDATE change_events SET read_at=CASE WHEN ?1 % 2 = 0 THEN NULL ELSE '2026-11-21T00:01:00Z' END", [generation]).unwrap();
                tx.commit().unwrap();
                std::thread::yield_now();
            }
        });
        barrier.wait();
        for _ in 0..80 {
            let snapshot = desktop_inventory(&conn).unwrap();
            assert_eq!(snapshot.resources.len(), 2501);
            assert_eq!(
                snapshot
                    .resources
                    .iter()
                    .map(|r| r.id)
                    .collect::<std::collections::HashSet<_>>()
                    .len(),
                2501
            );
            let marker = &snapshot.courses[0].name;
            assert!(
                snapshot
                    .resources
                    .iter()
                    .all(|r| &r.title == marker && r.course_name.as_ref() == Some(marker)),
                "mixed course/resource generations"
            );
            let wire = serde_json::to_value(&snapshot).unwrap();
            let expected = if marker.parse::<u32>().unwrap() % 2 == 0 {
                serde_json::json!([2501])
            } else {
                serde_json::json!([])
            };
            assert_eq!(
                wire.get("unreadResourceIds"),
                Some(&expected),
                "mixed metadata/read-fact generations"
            );
            let changed_id = if marker.parse::<u32>().unwrap() % 2 == 0 {
                1
            } else {
                3000
            };
            assert!(snapshot.resources.iter().any(|r| r.id == changed_id));
        }
        writer.join().unwrap();
    }
    #[test]
    fn desktop_inventory_uses_canonical_attention_without_visibility_or_page_limits() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn.execute_batch("INSERT INTO courses(id,external_course_id,name,url,first_seen_at) VALUES(1,'c1','Course','https://example.test','2026-11-21T00:00:00Z');").unwrap();
        for id in 1..=2501 {
            conn.execute("INSERT INTO resources(id,external_resource_id,course_id,title,url,resource_type,first_seen_at) VALUES(?1,?2,1,'Lecture','https://example.test','pdf','2026-11-21T00:00:00Z')", rusqlite::params![id, format!("r{id}")]).unwrap();
            conn.execute("INSERT INTO change_events(id,resource_id,course_id,change_type,title,detected_at,deduplication_key) VALUES(?1,?1,1,'updated','Changed','2026-11-21T00:00:00Z',?2)", rusqlite::params![id, format!("e{id}")]).unwrap();
        }
        conn.execute_batch(
            "UPDATE change_events SET change_type='baseline' WHERE id=1;
          UPDATE change_events SET calendar_suppressed=1 WHERE id=2;
          UPDATE change_events SET read_at='2026-11-21T00:01:00Z' WHERE id=3;
          INSERT INTO inbox_dismissals VALUES(4,'2026-11-21T00:02:00Z');",
        )
        .unwrap();
        db::clear_history_activity(&conn).unwrap();
        let snapshot = desktop_inventory(&conn).unwrap();
        let wire = serde_json::to_value(snapshot).unwrap();
        assert_eq!(
            wire.get("unreadResourceIds"),
            Some(&serde_json::json!((4..=2501).collect::<Vec<i64>>()))
        );
        assert_eq!(
            crate::attention::snapshot_resource_unread_event_ids(&conn, 4).unwrap(),
            vec![4]
        );
    }

    #[test]
    fn desktop_inventory_fences_a_wal_commit_between_metadata_and_unread_reads() {
        use rusqlite::ffi;
        use std::ffi::{c_char, c_int, c_void, CStr};
        struct Interleave {
            writer: Connection,
            committed: bool,
            error: Option<String>,
        }
        // SQLite calls the authorizer when preparing the attention SELECT, after
        // the public snapshot has read metadata. Commit on a real second WAL
        // connection at that exact boundary; no production test hook is needed.
        unsafe extern "C" fn commit_before_attention(
            context: *mut c_void,
            action: c_int,
            table: *const c_char,
            _: *const c_char,
            _: *const c_char,
            _: *const c_char,
        ) -> c_int {
            let interleave = &mut *(context as *mut Interleave);
            if !interleave.committed
                && action == ffi::SQLITE_READ
                && !table.is_null()
                && CStr::from_ptr(table).to_bytes() == b"change_events"
            {
                interleave.committed = true;
                if let Err(error) = interleave.writer.execute_batch("BEGIN; UPDATE resources SET title='New'; UPDATE change_events SET read_at='2026-11-21T00:01:00Z'; COMMIT;") {
                    interleave.error = Some(error.to_string());
                }
            }
            ffi::SQLITE_OK
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("interleave.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        db::migrate(&conn).unwrap();
        conn.execute_batch("INSERT INTO courses(id,external_course_id,name,url,first_seen_at) VALUES(1,'c1','Course','https://example.test','2026-11-21T00:00:00Z');
            INSERT INTO resources(id,external_resource_id,course_id,title,url,resource_type,first_seen_at) VALUES(1,'r1',1,'Old','https://example.test','pdf','2026-11-21T00:00:00Z');
            INSERT INTO change_events(id,resource_id,course_id,change_type,title,detected_at,deduplication_key) VALUES(1,1,1,'new','New','2026-11-21T00:00:00Z','event');").unwrap();
        let mut interleave = Box::new(Interleave {
            writer: Connection::open(path).unwrap(),
            committed: false,
            error: None,
        });
        // The context outlives the callback registration. SQLite invokes it on
        // this thread; it only operates on the independent writer connection.
        unsafe {
            assert_eq!(
                ffi::sqlite3_set_authorizer(
                    conn.handle(),
                    Some(commit_before_attention),
                    (&mut *interleave as *mut Interleave).cast()
                ),
                ffi::SQLITE_OK
            );
        }
        let during = desktop_inventory(&conn);
        unsafe {
            assert_eq!(
                ffi::sqlite3_set_authorizer(conn.handle(), None, std::ptr::null_mut()),
                ffi::SQLITE_OK
            );
        }
        assert!(
            interleave.committed,
            "writer must commit inside the metadata/read-facts boundary"
        );
        assert!(
            interleave.error.is_none(),
            "writer failed: {:?}",
            interleave.error
        );
        let during = during.unwrap();
        assert_eq!(during.resources[0].title, "Old");
        assert_eq!(
            during.unread_resource_ids,
            vec![1],
            "Old/read never existed in SQLite"
        );
        let after = desktop_inventory(&conn).unwrap();
        assert_eq!(after.resources[0].title, "New");
        assert!(after.unread_resource_ids.is_empty());
    }
}

#[cfg(test)]
mod benchmark {
    use super::*;
    use std::sync::Mutex;
    use std::time::Instant;

    /// Measures the production snapshot including Rust row mapping, with no Tauri IPC.
    #[test]
    #[ignore = "synthetic measurement; run explicitly in release mode"]
    fn synthetic_desktop_snapshot_lock() {
        const STAMP: &str = "2026-11-20T12:00:00Z";
        for size in [5_000, 25_000, 100_000] {
            for _ in 0..5 {
                let directory = tempfile::tempdir().unwrap();
                let path = directory.path().join("fixture.sqlite");
                let conn = Connection::open(&path).unwrap();
                db::migrate(&conn).unwrap();
                let tx = conn.unchecked_transaction().unwrap();
                for id in 1..=100 {
                    tx.execute("INSERT INTO courses(id,external_course_id,name,url,first_seen_at) VALUES(?1,?2,?3,'https://example.test/course',?4)",
                        rusqlite::params![id, id.to_string(), format!("Synthetic Course {id}"), STAMP]).unwrap();
                }
                {
                    let mut insert = tx.prepare("INSERT INTO resources(id,external_resource_id,course_id,title,url,resource_type,uploaded_at,section_path,first_seen_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?7)").unwrap();
                    for id in 1..=size {
                        let n = id - 1;
                        let course = n % 100 + 1;
                        let title = if n % 7 == 0 { "statistics" } else { "regression" };
                        let kind = if n % 3 == 0 { "text" } else { "pdf" };
                        let section = if n % 3 == 0 { "Exercises" } else { "Lectures" };
                        insert.execute(rusqlite::params![id, format!("fixture:{id}"), course, format!("Lecture {id} {title}"), format!("https://example.test/resource/{id}"), kind, STAMP,
                            serde_json::json!([format!("Unit {}", n % 9), section]).to_string()]).unwrap();
                        if id % 10 == 0 {
                            tx.execute("INSERT INTO change_events(resource_id,course_id,change_type,title,detected_at,deduplication_key) VALUES(?1,?2,'new','Synthetic',?3,?4)",
                                rusqlite::params![id, course, STAMP, format!("event:{id}")]).unwrap();
                        }
                    }
                }
                tx.commit().unwrap();
                drop(conn);
                let conn = Mutex::new(Connection::open(path).unwrap());
                let mut samples = Vec::new();
                for _ in 0..21 {
                    let snapshot = {
                        let guard = conn.lock().unwrap();
                        let start = Instant::now();
                        let inventory = desktop_inventory(&guard).unwrap();
                        samples.push(start.elapsed().as_secs_f64() * 1000.0);
                        inventory
                    };
                    assert_eq!(snapshot.resources.len(), size as usize);
                    assert_eq!(snapshot.unread_resource_ids.len(), size as usize / 10);
                }
                println!("snapshot {size} {samples:?}");
            }
        }
    }
}

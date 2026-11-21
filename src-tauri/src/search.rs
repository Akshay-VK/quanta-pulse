//! Desktop metadata search helpers. Keeps search-specific reads out of the
//! larger database module so concurrent edits stay small.

use crate::db::{self, ResourceFilter};
use crate::models::{Course, DesktopSearchInventory, Resource};
use rusqlite::Connection;

/// Read courses and resources under one connection without paging, so a
/// concurrent scan cannot split the inventory between pages.
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
    tx.commit()?;
    Ok(DesktopSearchInventory { courses, resources })
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
        conn.execute_batch("COMMIT").unwrap();
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
            let changed_id = if marker.parse::<u32>().unwrap() % 2 == 0 {
                1
            } else {
                3000
            };
            assert!(snapshot.resources.iter().any(|r| r.id == changed_id));
        }
        writer.join().unwrap();
    }
}

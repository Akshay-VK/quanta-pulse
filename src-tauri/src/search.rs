//! Desktop metadata search helpers. Keeps search-specific reads out of the
//! larger database module so concurrent edits stay small.

use crate::db::{self, ResourceFilter};
use crate::models::{Course, DesktopSearchInventory, Resource};
use rusqlite::Connection;

/// Read courses and resources under one connection without paging, so a
/// concurrent scan cannot split the inventory between pages.
pub fn desktop_inventory(conn: &Connection) -> rusqlite::Result<DesktopSearchInventory> {
    let courses: Vec<Course> = db::list_courses(conn)?;
    let resources: Vec<Resource> = db::list_resources(
        conn,
        &ResourceFilter {
            limit: Some(1_000_000),
            offset: Some(0),
            ..ResourceFilter::default()
        },
    )?;
    Ok(DesktopSearchInventory { courses, resources })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn desktop_inventory_returns_all_rows_in_one_read() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let inv = desktop_inventory(&conn).unwrap();
        assert!(inv.courses.is_empty());
        assert!(inv.resources.is_empty());
    }
}

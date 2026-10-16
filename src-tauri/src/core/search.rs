//! Resource search, shared by the app, the Telegram bot and a future MCP
//! server.
//!
//! One query, one ranking rule: the same `resources.title` / `courses.name`
//! match the Library uses, newest first. Hits carry the resource id so a caller
//! can follow up with `Mirror::ensure_local` or `core::text::local_text`.

use rusqlite::Connection;

use super::mirror::Mirror;
use crate::db::{self, ResourceFilter};
use crate::models::Resource;

/// How many hits a caller gets without asking for more.
pub const DEFAULT_LIMIT: i64 = 10;
/// Upper bound, so a bot cannot be asked to print the whole catalogue.
pub const MAX_LIMIT: i64 = 50;

/// One search result, with everything a caller needs to reply and to fetch it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub resource_id: i64,
    pub title: String,
    pub course: Option<String>,
    pub resource_type: String,
    pub uploaded_at: Option<String>,
    /// A local copy already exists, so no download is needed.
    pub local: bool,
}

/// Resources matching `query` in their title or course name, newest first.
///
/// An empty query matches nothing: a caller that passes one gets no results
/// rather than the whole catalogue.
pub fn search(conn: &Connection, mirror: &Mirror, query: &str, limit: i64) -> Vec<SearchHit> {
    let query = query.trim();
    if query.is_empty() {
        return Vec::new();
    }
    let filter = ResourceFilter {
        search: Some(query.to_string()),
        limit: Some(limit.clamp(1, MAX_LIMIT)),
        ..ResourceFilter::default()
    };
    db::list_resources(conn, &filter)
        .unwrap_or_default()
        .into_iter()
        .map(|r| hit(conn, mirror, r))
        .collect()
}

fn hit(conn: &Connection, mirror: &Mirror, r: Resource) -> SearchHit {
    let local = mirror.local_file(conn, r.id).is_some();
    SearchHit {
        resource_id: r.id,
        title: r.title,
        course: r.course_name,
        resource_type: r.resource_type,
        uploaded_at: r.uploaded_at,
        local,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ResourceWrite;
    use std::sync::Arc;

    fn conn_and_mirror() -> (tempfile::TempDir, Arc<Mirror>, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let mirror = Mirror::new(dir.path().to_path_buf(), Default::default());
        (dir, mirror, conn)
    }

    fn seed(conn: &Connection, course: &str, title: &str, resource_type: &str, uploaded: &str) -> i64 {
        let cid = db::upsert_course(conn, course, course, None, "https://x/c", "t0").unwrap();
        db::upsert_resource(
            conn,
            &ResourceWrite {
                external_id: &format!("mod:{title}"),
                course_id: Some(cid),
                title,
                url: "https://x/f.pdf",
                source_page_url: None,
                section_path: None,
                resource_type,
                uploaded_at: Some(uploaded),
                published_at: None,
                modified_at: None,
                due_at: None,
                fingerprint: "fp",
                size_bytes: None,
                section: None,
                is_external: false,
                availability: "available",
            },
            "t1",
        )
        .unwrap();
        db::get_resource(conn, &format!("mod:{title}")).unwrap().id
    }

    #[test]
    fn matches_the_title_and_the_course_name() {
        let (_dir, mirror, conn) = conn_and_mirror();
        seed(&conn, "CS F222", "Quiz 2 answer sheet", "quiz", "2026-10-01T00:00:00Z");
        seed(&conn, "ME F213", "Workshop manual", "pdf", "2026-09-01T00:00:00Z");

        let by_title = search(&conn, &mirror, "answer sheet", DEFAULT_LIMIT);
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].title, "Quiz 2 answer sheet");
        assert_eq!(by_title[0].course.as_deref(), Some("CS F222"));

        let by_course = search(&conn, &mirror, "ME F213", DEFAULT_LIMIT);
        assert_eq!(by_course.len(), 1);
        assert_eq!(by_course[0].title, "Workshop manual");
    }

    #[test]
    fn newest_first_and_limited() {
        let (_dir, mirror, conn) = conn_and_mirror();
        seed(&conn, "CS F222", "quiz one", "quiz", "2026-09-01T00:00:00Z");
        seed(&conn, "CS F222", "quiz two", "quiz", "2026-10-01T00:00:00Z");
        seed(&conn, "CS F222", "quiz three", "quiz", "2026-11-01T00:00:00Z");

        let hits = search(&conn, &mirror, "quiz", 2);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "quiz three");
        assert_eq!(hits[1].title, "quiz two");
    }

    #[test]
    fn an_empty_query_matches_nothing() {
        let (_dir, mirror, conn) = conn_and_mirror();
        seed(&conn, "CS F222", "quiz one", "quiz", "2026-09-01T00:00:00Z");
        assert!(search(&conn, &mirror, "   ", DEFAULT_LIMIT).is_empty());
    }

    #[test]
    fn reports_whether_a_local_copy_exists() {
        let (dir, mirror, conn) = conn_and_mirror();
        let id = seed(&conn, "CS F222", "quiz one", "quiz", "2026-09-01T00:00:00Z");
        assert!(!search(&conn, &mirror, "quiz", DEFAULT_LIMIT)[0].local);

        let rel = "CS F222/quiz one.pdf";
        let path = dir.path().join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"%PDF-1").unwrap();
        db::mirror_upsert(
            &conn,
            &db::MirrorRow {
                resource_id: id,
                rel_path: rel.to_string(),
                sha256: None,
                size_bytes: 6,
                mime: Some("application/pdf".to_string()),
                status: "ok".to_string(),
                error: None,
                attempts: 1,
                source_etag: None,
                source_modified: None,
                downloaded_at: Some("t2".to_string()),
                last_checked: Some("t2".to_string()),
            },
        )
        .unwrap();

        assert!(search(&conn, &mirror, "quiz", DEFAULT_LIMIT)[0].local);
    }
}

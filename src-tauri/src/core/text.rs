//! Readable text for a resource, read from its local copy.
//!
//! The transport-agnostic half of the preview, and the input the content index,
//! the Telegram bot and a future MCP server all want: given a resource id it
//! reads the bytes through `Mirror::local_file` (the permanent mirror first,
//! then the preview cache) and returns them as text. No network, no preview
//! lease, no auth — a mirrored page is readable offline.
//!
//! `None` means there is nothing local to read, so the caller falls back to the
//! network. A binary copy (a PDF, a recording) is `None` too: text extraction
//! cannot say anything about it, and the binary preview handles it instead.

use std::fs;

use rusqlite::Connection;

use super::mirror::Mirror;
use crate::models::LocalFile;
use crate::quanta::parse::extract_readable_text;

/// Largest local copy we will pull into memory to read as text. Anything bigger
/// is a binary in practice.
pub const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;

/// Text read from a resource's local copy.
#[derive(Debug, Clone)]
pub struct LocalText {
    /// Readable text: HTML converted, Markdown and plain text as they are.
    pub text: String,
    /// Absolute path of the copy the text came from.
    pub path: String,
    /// Whether the bytes were HTML that had to be converted.
    pub from_html: bool,
}

/// Readable text for a resource from its local copy, when one exists.
pub fn local_text(conn: &Connection, mirror: &Mirror, resource_id: i64) -> Option<LocalText> {
    let (file, bytes) = mirror.local_bytes(conn, resource_id, MAX_TEXT_BYTES)?;
    if !is_textual(&file) {
        return None;
    }
    let raw = String::from_utf8_lossy(&bytes).into_owned();
    let from_html = is_html(&file, &raw);
    let text = if from_html {
        extract_readable_text(&raw)
    } else {
        raw.trim().to_string()
    };
    Some(LocalText {
        text,
        path: file.path,
        from_html,
    })
}

/// Whether a local copy can be read as text. The mirror records the served
/// content type, so trust it first; fall back to the extension for a row that
/// never learned its MIME.
fn is_textual(file: &LocalFile) -> bool {
    match file.mime.as_deref() {
        Some(mime) if !mime.is_empty() => {
            let mime = mime.to_ascii_lowercase();
            mime.starts_with("text/")
                || mime.contains("html")
                || mime.contains("json")
                || mime.contains("xml")
                || mime.contains("csv")
        }
        _ => {
            let lower = file.rel_path.to_ascii_lowercase();
            [
                ".html", ".htm", ".md", ".markdown", ".txt", ".csv", ".json", ".xml", ".log",
                ".ics",
            ]
            .iter()
            .any(|ext| lower.ends_with(ext))
        }
    }
}

/// Whether the bytes are an HTML page that has to be converted. A Markdown
/// snapshot is never HTML, even when the MIME was lost.
fn is_html(file: &LocalFile, raw: &str) -> bool {
    if let Some(mime) = file.mime.as_deref() {
        if mime.to_ascii_lowercase().contains("html") {
            return true;
        }
    }
    if file.rel_path.to_ascii_lowercase().ends_with(".md") {
        return false;
    }
    let head = raw.trim_start().to_ascii_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html") || head.contains("<body")
}

/// Whether a local copy exists on disk. Cheap check for callers that only need
/// "can this be opened offline".
pub fn has_local_copy(conn: &Connection, mirror: &Mirror, resource_id: i64) -> bool {
    mirror
        .local_file(conn, resource_id)
        .and_then(|file| fs::metadata(&file.path).ok())
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, MirrorRow, ResourceWrite};
    use std::path::Path;
    use std::sync::Arc;

    fn mirror_and_conn() -> (tempfile::TempDir, Arc<Mirror>, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let mirror = Mirror::new(dir.path().to_path_buf(), Default::default());
        (dir, mirror, conn)
    }

    fn seed_resource(conn: &Connection, external_id: &str) -> i64 {
        let cid = db::upsert_course(conn, "10", "CS F222", None, "https://x/10", "t0").unwrap();
        db::upsert_resource(
            conn,
            &ResourceWrite {
                external_id,
                course_id: Some(cid),
                title: "Regarding Quiz-2",
                url: "https://x/1",
                source_page_url: None,
                section_path: None,
                resource_type: "notice",
                uploaded_at: None,
                published_at: None,
                modified_at: None,
                due_at: None,
                fingerprint: "fp1",
                size_bytes: None,
                section: None,
                is_external: false,
                availability: "available",
            },
            "t1",
        )
        .unwrap();
        db::get_resource(conn, external_id).unwrap().id
    }

    /// Write a local copy under the mirror root and index it as saved.
    fn save_local(
        dir: &Path,
        conn: &Connection,
        resource_id: i64,
        rel_path: &str,
        mime: Option<&str>,
        bytes: &[u8],
    ) {
        let path = dir.join(rel_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        db::mirror_upsert(
            conn,
            &MirrorRow {
                resource_id,
                rel_path: rel_path.to_string(),
                sha256: Some(crate::core::files::hash_bytes(bytes)),
                size_bytes: bytes.len() as i64,
                mime: mime.map(str::to_string),
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
    }

    #[test]
    fn a_markdown_snapshot_reads_as_text_without_conversion() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:notice:1");
        let snapshot = "# Regarding Quiz-2\n\n- Date: 2026-10-15\n\nBring your answer sheet.\n";
        save_local(
            dir.path(),
            &conn,
            rid,
            "CS F222/Announcements/2026-10-15 Regarding Quiz-2.md",
            Some("text/markdown"),
            snapshot.as_bytes(),
        );

        let text = local_text(&conn, &mirror, rid).unwrap();
        assert_eq!(text.text, snapshot.trim());
        assert!(!text.from_html);
        assert!(text.path.ends_with("2026-10-15 Regarding Quiz-2.md"));
    }

    #[test]
    fn an_html_copy_is_converted_to_readable_text() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:page:1");
        save_local(
            dir.path(),
            &conn,
            rid,
            "CS F222/Pages/Page.html",
            Some("text/html; charset=utf-8"),
            b"<html><body><main><h1>Hello</h1><p>world</p></main></body></html>",
        );

        let text = local_text(&conn, &mirror, rid).unwrap();
        assert!(text.from_html);
        assert!(text.text.contains("Hello"));
        assert!(text.text.contains("world"));
        assert!(!text.text.contains("<h1>"));
    }

    #[test]
    fn a_binary_copy_is_not_text() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:resource:1");
        save_local(
            dir.path(),
            &conn,
            rid,
            "CS F222/Lecture 1.pdf",
            Some("application/pdf"),
            b"%PDF-1.7 not really",
        );
        assert!(local_text(&conn, &mirror, rid).is_none());
    }

    #[test]
    fn a_copy_bigger_than_the_text_limit_is_not_read() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:page:2");
        let big = vec![b'x'; (MAX_TEXT_BYTES + 1) as usize];
        save_local(
            dir.path(),
            &conn,
            rid,
            "CS F222/Pages/huge.txt",
            Some("text/plain"),
            &big,
        );
        assert!(local_text(&conn, &mirror, rid).is_none());
    }

    #[test]
    fn a_missing_copy_reads_as_nothing() {
        let (_dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:page:3");
        assert!(local_text(&conn, &mirror, rid).is_none());
        assert!(!has_local_copy(&conn, &mirror, rid));
    }

    #[test]
    fn a_row_whose_file_vanished_reads_as_nothing() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:page:4");
        save_local(
            dir.path(),
            &conn,
            rid,
            "CS F222/Pages/gone.md",
            Some("text/markdown"),
            b"# Gone",
        );
        fs::remove_file(dir.path().join("CS F222/Pages/gone.md")).unwrap();
        assert!(local_text(&conn, &mirror, rid).is_none());
        assert!(!has_local_copy(&conn, &mirror, rid));
    }

    #[test]
    fn the_mime_beats_the_extension_when_they_disagree() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:resource:2");
        // A .bin whose served type is text: the content type is what Quanta said.
        save_local(
            dir.path(),
            &conn,
            rid,
            "CS F222/notes.bin",
            Some("text/plain"),
            b"plain notes",
        );
        let text = local_text(&conn, &mirror, rid).unwrap();
        assert_eq!(text.text, "plain notes");
    }

    #[test]
    fn a_copy_without_a_mime_falls_back_to_the_extension() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:resource:3");
        save_local(dir.path(), &conn, rid, "CS F222/readme.txt", None, b"hello");
        assert_eq!(local_text(&conn, &mirror, rid).unwrap().text, "hello");

        let rid2 = seed_resource(&conn, "mod:resource:4");
        save_local(dir.path(), &conn, rid2, "CS F222/blob.bin", None, b"\x00\x01");
        assert!(local_text(&conn, &mirror, rid2).is_none());
    }

    #[test]
    fn local_bytes_respects_its_limit() {
        let (dir, mirror, conn) = mirror_and_conn();
        let rid = seed_resource(&conn, "mod:resource:5");
        save_local(
            dir.path(),
            &conn,
            rid,
            "CS F222/small.pdf",
            Some("application/pdf"),
            b"%PDF-1",
        );
        let (file, bytes) = mirror.local_bytes(&conn, rid, 1024).unwrap();
        assert_eq!(file.size_bytes, 6);
        assert_eq!(bytes, b"%PDF-1");
        assert!(mirror.local_bytes(&conn, rid, 3).is_none());
    }
}

//! Path rules for the local mirror.
//!
//! Files are laid out so a human can browse them:
//! `<root>/<course display name>/<section path>/<filename>`. Every segment is
//! sanitised for Windows *and* POSIX, because the same function runs on both and
//! a name that is legal on one but not the other is a bug that only shows up on
//! someone else's machine.
//!
//! The rules, in the order they are applied:
//!
//! - Unicode NFC, so a name typed on macOS (NFD) and the same name from Quanta
//!   compare equal.
//! - Characters Windows forbids (`<>:"/\|?*`) and control characters become `-`.
//! - Trailing dots and spaces are dropped: Windows silently does this, which
//!   would make our stored path disagree with the file on disk.
//! - Reserved device names (`CON`, `NUL`, `COM1`, …) are prefixed, since no
//!   directory may contain them whatever the extension.
//! - A segment is capped at 80 characters, keeping the extension so the file
//!   still opens with the right application.
//! - A whole relative path is capped at 240 characters; over that, the deepest
//!   section segments are dropped first.
//! - Collisions get ` (2)`, ` (3)`, … because Windows and macOS both fold case.
//!
//! Nothing here trusts the input: `join_within` is the guard that keeps a
//! crafted name from escaping the mirror root.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use unicode_normalization::UnicodeNormalization;

/// Longest a single path segment may be.
pub const MAX_SEGMENT_CHARS: usize = 80;
/// Longest a whole relative path may be. Well under Windows' 260-character
/// limit once the root and the `.part` suffix are added.
pub const MAX_PATH_CHARS: usize = 240;

/// Windows device names, which are reserved with or without an extension.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn is_forbidden(c: char) -> bool {
    matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control()
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

/// Keep the extension (up to 12 characters) and shorten the stem around it, so
/// a truncated name is still recognisable and still opens.
fn truncate_keeping_extension(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let (stem, ext) = match s.rfind('.') {
        Some(i) if i > 0 && s[i + 1..].chars().count() <= 12 && !s[i + 1..].is_empty() => {
            (&s[..i], &s[i..])
        }
        _ => (s, ""),
    };
    let ext_len = ext.chars().count();
    if ext_len >= max {
        return truncate_chars(s, max);
    }
    format!("{}{}", truncate_chars(stem, max - ext_len), ext)
}

/// One directory or file name, safe on Windows and POSIX alike. Never empty.
pub fn sanitize_segment(raw: &str) -> String {
    let normalized: String = raw.nfc().collect();

    let mut out = String::with_capacity(normalized.len());
    for c in normalized.chars() {
        out.push(if is_forbidden(c) { '-' } else { c });
    }

    // Windows strips these silently; strip them ourselves so the stored path
    // and the file on disk cannot disagree.
    let trimmed = out.trim();
    let trimmed = trimmed.trim_end_matches(['.', ' ']);
    let mut out = truncate_keeping_extension(trimmed, MAX_SEGMENT_CHARS);

    if out.is_empty() || out.chars().all(|c| c == '.') {
        return "_".to_string();
    }

    // `CON.txt` is as reserved as `CON`.
    let stem = out.split('.').next().unwrap_or(&out).trim();
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        out = format!("_{out}");
    }
    out
}

/// Build the stored relative path for a resource. `sections` are the Quanta
/// listing titles from the course root down; they are dropped from the front
/// when the total would exceed [`MAX_PATH_CHARS`], because the file name and the
/// course are the parts worth keeping.
pub fn build_rel_path(course: &str, sections: &[String], filename: &str) -> String {
    let course = sanitize_segment(course);
    let mut sections: Vec<String> = sections.iter().map(|s| sanitize_segment(s)).collect();
    let file = sanitize_segment(filename);

    loop {
        let mut parts = vec![course.clone()];
        parts.extend(sections.iter().cloned());
        parts.push(file.clone());
        let joined = parts.join("/");
        if joined.chars().count() <= MAX_PATH_CHARS || sections.is_empty() {
            return joined;
        }
        sections.remove(0);
    }
}

/// A path already handed out once. Two different resources may sanitise to the
/// same name, so the second gets ` (2)` and so on.
pub fn unique_rel_path(wanted: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(&wanted.to_ascii_lowercase()) {
        return wanted.to_string();
    }
    let (stem, ext) = match wanted.rfind('.') {
        Some(i) if i > 0 => (&wanted[..i], &wanted[i..]),
        _ => (wanted, ""),
    };
    for n in 2..10_000 {
        let candidate = format!("{stem} ({n}){ext}");
        if !taken.contains(&candidate.to_ascii_lowercase()) {
            return candidate;
        }
    }
    wanted.to_string()
}

/// Resolve a stored relative path under `root`, or `None` if it is not a plain
/// relative path. This is the traversal guard: absolute paths, `..`, empty
/// segments and backslashes are rejected outright, so a compromised database row
/// cannot point outside the mirror.
pub fn join_within(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.contains('\0') || rel.contains('\\') {
        return None;
    }
    for segment in rel.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return None;
        }
    }
    Some(root.join(rel))
}

/// Confirm that a path that is about to be written still lands inside `root`,
/// by canonicalising the nearest ancestor that exists. Catches symlinks and any
/// case where the rules above were bypassed.
pub fn is_within(root: &Path, path: &Path) -> bool {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut probe = path;
    loop {
        match probe.canonicalize() {
            Ok(real) => return real.starts_with(&root),
            Err(_) => match probe.parent() {
                Some(parent) => probe = parent,
                None => return false,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn taken(names: &[&str]) -> HashSet<String> {
        names.iter().map(|n| n.to_ascii_lowercase()).collect()
    }

    #[test]
    fn reserved_device_names_are_prefixed_whatever_the_extension() {
        assert_eq!(sanitize_segment("CON"), "_CON");
        assert_eq!(sanitize_segment("con.txt"), "_con.txt");
        assert_eq!(sanitize_segment("NUL.pdf"), "_NUL.pdf");
        assert_eq!(sanitize_segment("COM1"), "_COM1");
        assert_eq!(sanitize_segment("lpt9.md"), "_lpt9.md");
        // Not reserved: only the exact stem counts.
        assert_eq!(sanitize_segment("CONSOLE.pdf"), "CONSOLE.pdf");
        assert_eq!(sanitize_segment("COM10"), "COM10");
    }

    #[test]
    fn invalid_characters_and_controls_become_dashes() {
        assert_eq!(sanitize_segment("a<b>c:d\"e/f\\g|h?i*j"), "a-b-c-d-e-f-g-h-i-j");
        assert_eq!(sanitize_segment("tab\there\nnew"), "tab-here-new");
    }

    #[test]
    fn trailing_dots_and_spaces_are_dropped() {
        assert_eq!(sanitize_segment("File name. "), "File name");
        assert_eq!(sanitize_segment("dots..."), "dots");
        // A leading dot is fine: it is not a trailing one.
        assert_eq!(sanitize_segment(".hidden"), ".hidden");
    }

    #[test]
    fn an_empty_or_dot_only_name_becomes_an_underscore() {
        assert_eq!(sanitize_segment(""), "_");
        assert_eq!(sanitize_segment("   "), "_");
        assert_eq!(sanitize_segment("..."), "_");
        assert_eq!(sanitize_segment("///"), "---");
    }

    #[test]
    fn segments_are_normalised_to_nfc_so_macos_and_linux_agree() {
        // "e" plus a combining acute accent is the NFD form of "é".
        let decomposed = "Re\u{301}sum\u{e9}.pdf";
        let composed = sanitize_segment(decomposed);
        assert_eq!(composed, "Résumé.pdf");
        assert_eq!(composed.chars().count(), 10);
    }

    #[test]
    fn long_names_are_capped_but_keep_their_extension() {
        let stem = "x".repeat(200);
        let out = sanitize_segment(&format!("{stem}.pdf"));
        assert_eq!(out.chars().count(), MAX_SEGMENT_CHARS);
        assert!(out.ends_with(".pdf"), "extension survives: {out}");
        assert!(out.starts_with("xxx"));

        // No extension: a plain cut.
        let out = sanitize_segment(&"y".repeat(200));
        assert_eq!(out.chars().count(), MAX_SEGMENT_CHARS);
    }

    #[test]
    fn build_rel_path_joins_course_sections_and_file() {
        let rel = build_rel_path(
            "CS F222 Discrete Structures",
            &["Unit 1".into(), "Slides".into()],
            "Lecture 1.pdf",
        );
        assert_eq!(rel, "CS F222 Discrete Structures/Unit 1/Slides/Lecture 1.pdf");
    }

    #[test]
    fn build_rel_path_drops_deep_sections_before_the_file_name() {
        let sections: Vec<String> = (0..12)
            .map(|i| format!("Section number {i} with a long title"))
            .collect();
        let rel = build_rel_path("Course", &sections, "final.pdf");
        assert!(rel.chars().count() <= MAX_PATH_CHARS, "{rel}");
        assert!(rel.starts_with("Course/"));
        assert!(rel.ends_with("final.pdf"), "the file name survives: {rel}");
        // The shallowest sections are the ones sacrificed.
        assert!(!rel.contains("Section number 0"), "deep sections dropped: {rel}");
    }

    #[test]
    fn collisions_get_a_numbered_suffix() {
        let already = taken(&["lecture 1.pdf"]);
        assert_eq!(unique_rel_path("Lecture 1.pdf", &already), "Lecture 1 (2).pdf");

        let already = taken(&["lecture 1.pdf", "lecture 1 (2).pdf"]);
        assert_eq!(unique_rel_path("Lecture 1.pdf", &already), "Lecture 1 (3).pdf");

        // Extension-less names still get a suffix.
        let already = taken(&["notes"]);
        assert_eq!(unique_rel_path("notes", &already), "notes (2)");
    }

    #[test]
    fn join_within_rejects_every_traversal_attempt() {
        let root = Path::new("/mirror");
        assert_eq!(join_within(root, "Course/Unit 1/a.pdf"),
                   Some(PathBuf::from("/mirror/Course/Unit 1/a.pdf")));
        for bad in [
            "../outside.pdf",
            "Course/../../outside.pdf",
            "/etc/passwd",
            "Course//absolute.pdf",
            "",
        ] {
            assert!(join_within(root, bad).is_none(), "must reject {bad:?}");
        }
    }
}

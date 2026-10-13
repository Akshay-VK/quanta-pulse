//! URL normalisation and stable identifier derivation.
//!
//! These functions are deliberately pure so they can be exhaustively unit
//! tested. They decide two important things:
//!
//! 1. Whether two links point at the "same" resource (deduplication).
//! 2. Whether a link is safe and relevant to crawl at all.

use std::collections::HashMap;

use once_cell::sync::Lazy;
use url::Url;

pub const QUANTA_HOST: &str = "quanta.bits-pilani.ac.in";
pub const QUANTA_ORIGIN: &str = "https://quanta.bits-pilani.ac.in";

/// Query parameters that change between requests and must not affect identity.
static VOLATILE_PARAMS: Lazy<std::collections::HashSet<&'static str>> = Lazy::new(|| {
    [
        "sesskey",
        "time",
        "PHPSESSID",
        "lang",
        "redirect",
        "anchor",
        "skipcache",
        "_",
        "cache",
    ]
    .into_iter()
    .collect()
});

/// Link prefixes that are navigation, not content.
static IGNORED_PATHS: Lazy<Vec<&'static str>> = Lazy::new(|| {
    vec![
        "/login/",
        "/logout.php",
        "/help.php",
        "/admin/",
        "/message/",
        "/blog/",
        "/user/view.php",
        "/user/profile.php",
        "/grade/report",
        "/course/index.php",
        "/calendar/view.php",
        "/mod/forum/search.php",
        "/mod/forum/subscribe.php",
        "/blocks/",
        "/badges/",
        "/notes/",
        "/tag/",
        "/search/",
    ]
});

pub fn is_internal(url: &Url) -> bool {
    url.host_str().map(|h| h.eq_ignore_ascii_case(QUANTA_HOST)).unwrap_or(false)
}

pub fn is_crawlable_scheme(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Should this link be followed by the crawler at all?
pub fn is_relevant_link(url: &Url) -> bool {
    if !is_crawlable_scheme(url) {
        return false;
    }
    if !is_internal(url) {
        // External links are recorded as resources but never crawled.
        return true;
    }
    let path = url.path();
    if IGNORED_PATHS.iter().any(|p| path.starts_with(p)) {
        return false;
    }
    if path.ends_with(".php") && path.contains("/mod/") {
        return true;
    }
    true
}

fn rebuild_query(pairs: Vec<(String, String)>) -> Option<String> {
    if pairs.is_empty() {
        return None;
    }
    let mut ser = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        ser.append_pair(&k, &v);
    }
    Some(ser.finish())
}

/// Normalise a URL for deduplication: lowercases the host, removes the
/// fragment, sorts-stable-filters volatile query parameters, and drops the
/// trailing slash for non-root paths.
pub fn normalize_url(raw: &str, base: Option<&Url>) -> Option<String> {
    let parsed = match base {
        Some(b) => b.join(raw).ok()?,
        None => Url::parse(raw).ok()?,
    };
    let mut url = parsed;
    url.set_fragment(None);

    if url.query().is_some() {
        let mut kept: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(k, _)| !VOLATILE_PARAMS.contains(k.as_ref()))
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        kept.sort();
        match rebuild_query(kept) {
            Some(q) => url.set_query(Some(&q)),
            None => url.set_query(None),
        }
    }

    if url.path().len() > 1 && url.path().ends_with('/') {
        let trimmed = url.path().trim_end_matches('/').to_string();
        url.set_path(&trimmed);
    }

    Some(url.to_string())
}

pub fn query_map(url: &Url) -> HashMap<String, String> {
    url.query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

/// Derive a stable identifier that survives navigation and session changes.
pub fn stable_resource_id(url: &Url) -> String {
    let path = url.path();
    let q = query_map(url);

    if let Some(rest) = path.strip_prefix("/mod/") {
        if let Some((module_type, file)) = rest.split_once('/') {
            if let Some(id) = q.get("id") {
                return format!("mod:{module_type}:{id}");
            }
            if let Some(d) = q.get("d") {
                return format!("{module_type}:discuss:{d}");
            }
            if let Some(f) = q.get("f") {
                return format!("{module_type}:forum:{f}");
            }
            return format!("mod:{module_type}:{}", short_hash(&format!("{path}?{}", file)));
        }
    }

    if path.starts_with("/course/view.php") {
        if let Some(id) = q.get("id") {
            return format!("course:{id}");
        }
    }

    if path.contains("/pluginfile.php/") {
        // File identity is the full path (includes the content hash segment).
        return format!("file:{}", short_hash(path));
    }

    if !is_internal(url) {
        return format!("ext:{}", short_hash(url.as_str()));
    }

    if let Some(id) = q.get("id") {
        let kind = path
            .rsplit('/')
            .next()
            .unwrap_or("view")
            .trim_end_matches(".php");
        return format!("{kind}:{id}");
    }

    format!("path:{}", short_hash(path))
}

fn short_hash(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    hex::encode(&digest[..8])
}

/// Map a Moodle module type (from `/mod/<type>/`) to a friendly resource type.
pub fn friendly_resource_type(module_type: &str, mime_hint: Option<&str>) -> String {
    match module_type {
        "resource" => infer_file_type(mime_hint).to_string(),
        "folder" => "folder".to_string(),
        "url" => "external link".to_string(),
        "assign" => "assignment".to_string(),
        "quiz" => "quiz".to_string(),
        "forum" => "announcement".to_string(),
        "page" => "page".to_string(),
        "book" => "book".to_string(),
        "lti" => "external tool".to_string(),
        "label" => "label".to_string(),
        "h5pactivity" => "interactive".to_string(),
        "video" | "vod" => "video".to_string(),
        other => other.to_string(),
    }
}

pub fn infer_file_type(mime_hint: Option<&str>) -> &'static str {
    match mime_hint {
        Some(m) if m.contains("pdf") => "pdf",
        Some(m) if m.contains("presentation") || m.contains("powerpoint") => "presentation",
        Some(m) if m.contains("word") || m.contains("document") => "document",
        Some(m) if m.contains("spreadsheet") || m.contains("excel") => "spreadsheet",
        Some(m) if m.starts_with("image/") => "image",
        Some(m) if m.starts_with("video/") => "video",
        Some(m) if m.starts_with("audio/") => "audio",
        _ => "file",
    }
}

/// Extract the module type from a `/mod/<type>/...` URL, if present.
pub fn module_type_from_path(url: &Url) -> Option<String> {
    let path = url.path();
    path.strip_prefix("/mod/")
        .and_then(|rest| rest.split('/').next())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn strips_volatile_params() {
        let n = normalize_url(
            "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=42&sesskey=xyz&time=123",
            None,
        )
        .unwrap();
        assert_eq!(n, "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=42");
    }

    #[test]
    fn drops_fragment_and_trailing_slash() {
        let n = normalize_url("https://quanta.bits-pilani.ac.in/course/view.php?id=5#section-2", None)
            .unwrap();
        assert_eq!(n, "https://quanta.bits-pilani.ac.in/course/view.php?id=5");
        let n2 = normalize_url("https://quanta.bits-pilani.ac.in/my/", None).unwrap();
        assert_eq!(n2, "https://quanta.bits-pilani.ac.in/my");
    }

    #[test]
    fn resolves_relative_against_base() {
        let base = u("https://quanta.bits-pilani.ac.in/course/view.php?id=5");
        let n = normalize_url("/mod/folder/view.php?id=99", Some(&base)).unwrap();
        assert_eq!(n, "https://quanta.bits-pilani.ac.in/mod/folder/view.php?id=99");
    }

    #[test]
    fn stable_ids_use_moodle_ids() {
        let id = stable_resource_id(&u("https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=42"));
        assert_eq!(id, "mod:resource:42");
        let cid = stable_resource_id(&u("https://quanta.bits-pilani.ac.in/course/view.php?id=7"));
        assert_eq!(cid, "course:7");
        let did = stable_resource_id(&u("https://quanta.bits-pilani.ac.in/mod/forum/discuss.php?d=11"));
        assert_eq!(did, "forum:discuss:11");
    }

    #[test]
    fn stable_file_ids_ignore_session_and_download_query_variants() {
        let a = normalize_url(
            "https://quanta.bits-pilani.ac.in/pluginfile.php/123/mod_folder/content/0/notes.pdf?sesskey=abc&forcedownload=1",
            None,
        )
        .unwrap();
        let b = normalize_url(
            "https://quanta.bits-pilani.ac.in/pluginfile.php/123/mod_folder/content/0/notes.pdf?forcedownload=0&sesskey=xyz",
            None,
        )
        .unwrap();
        assert_eq!(stable_resource_id(&u(&a)), stable_resource_id(&u(&b)));
    }

    #[test]
    fn external_links_get_ext_ids() {
        let id = stable_resource_id(&u("https://example.org/notes/lecture1.pdf"));
        assert!(id.starts_with("ext:"));
        assert!(!is_internal(&u("https://example.org/x")));
    }

    #[test]
    fn ignores_login_and_admin_links() {
        assert!(!is_relevant_link(&u("https://quanta.bits-pilani.ac.in/login/index.php")));
        assert!(!is_relevant_link(&u("https://quanta.bits-pilani.ac.in/logout.php")));
        assert!(is_relevant_link(&u("https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1")));
    }

    #[test]
    fn file_types_are_inferred() {
        assert_eq!(infer_file_type(Some("application/pdf")), "pdf");
        assert_eq!(friendly_resource_type("assign", None), "assignment");
        assert_eq!(friendly_resource_type("url", None), "external link");
    }
}

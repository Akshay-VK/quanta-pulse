//! Quanta (Moodle) interaction: authenticated HTTP client, HTML parsing and
//! recursive discovery.
//!
//! There is no public REST API available on this Quanta instance (Moodle web
//! services are disabled), so Quanta Pulse uses the authenticated web session
//! and parses the rendered Moodle pages. All parsing logic lives in `parse.rs`
//! and is unit tested against captured fixtures.

pub mod client;
pub mod discover;
pub mod parse;
pub mod preview;
pub mod urlnorm;

/// A course discovered from the authenticated dashboard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredCourse {
    pub external_id: String,
    pub name: String,
    pub short_name: Option<String>,
    pub url: String,
}

/// A resource discovered on a course page or a sub-page.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DiscoveredResource {
    /// Stable identifier derived from the Moodle module id where possible.
    pub external_id: String,
    pub course_external_id: String,
    pub title: String,
    /// Direct file / download URL (for materials) or the module URL.
    pub url: String,
    /// The page where this resource's link was listed. Captured by the
    /// crawler from the page the anchor was parsed on — a course page, a
    /// section page or a folder/forum page — never guessed from the course id.
    pub source_page_url: Option<String>,
    pub resource_type: String,
    /// Authoritative upload/publication time, if Quanta exposes one.
    pub uploaded_at: Option<String>,
    pub published_at: Option<String>,
    pub modified_at: Option<String>,
    pub due_at: Option<String>,
    pub size_bytes: Option<i64>,
    pub section: Option<String>,
    /// Actual ordered course-section and nested-page titles.
    pub section_path: Vec<String>,
    pub is_external: bool,
    /// False when the link was observed but is known to be broken.
    pub available: bool,
}

impl DiscoveredResource {
    /// A fingerprint over the metadata that determines "has this changed?".
    ///
    /// Section placement is intentionally excluded: moving a resource through
    /// a hierarchy refresh does not change the resource itself.
    pub fn fingerprint(&self) -> String {
        content_fingerprint(
            &self.title,
            &self.resource_type,
            self.uploaded_at.as_deref(),
            self.published_at.as_deref(),
            self.modified_at.as_deref(),
            self.due_at.as_deref(),
            self.size_bytes,
        )
    }
}

/// Fingerprint the content-related fields shared by live observations and the
/// database fingerprint migration. Placement and presentation metadata do not
/// participate.
pub fn content_fingerprint(
    title: &str,
    resource_type: &str,
    uploaded_at: Option<&str>,
    published_at: Option<&str>,
    modified_at: Option<&str>,
    due_at: Option<&str>,
    size_bytes: Option<i64>,
) -> String {
    use sha2::{Digest, Sha256};
    let size = size_bytes.map(|bytes| bytes.to_string()).unwrap_or_default();
    let mut hasher = Sha256::new();
    for part in [
        title,
        resource_type,
        uploaded_at.unwrap_or(""),
        published_at.unwrap_or(""),
        modified_at.unwrap_or(""),
        due_at.unwrap_or(""),
        size.as_str(),
    ] {
        hasher.update(part.as_bytes());
        hasher.update(b"\x1f");
    }
    hex::encode(&hasher.finalize()[..16])
}

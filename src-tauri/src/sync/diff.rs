//! Pure change-detection logic.
//!
//! Kept separate from I/O so the rules are easy to test and reason about.
//! The guiding principle: a resource is only reported as changed when we have
//! positive evidence. Missing data never counts as deletion.

use crate::models::Resource;
use crate::quanta::DiscoveredResource;

/// The subset of stored state that matters for change detection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviousState {
    pub fingerprint: Option<String>,
    pub availability: String,
    pub due_at: Option<String>,
    pub uploaded_at: Option<String>,
    pub published_at: Option<String>,
    pub title: String,
}

impl From<&Resource> for PreviousState {
    fn from(r: &Resource) -> Self {
        PreviousState {
            fingerprint: r.content_fingerprint.clone(),
            availability: r.availability_status.clone(),
            due_at: r.due_at.clone(),
            uploaded_at: r.uploaded_at.clone(),
            published_at: r.published_at.clone(),
            title: r.title.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detected {
    New,
    Updated { reason: String },
    DeadlineChanged { from: Option<String>, to: Option<String> },
    Unavailable,
    Restored,
    Unchanged,
}

/// Classify the current observation of a resource against its stored state.
///
/// `baseline` suppresses new/changed reporting during the very first scan so a
/// fresh install never floods the user with notifications for existing content.
pub fn classify(
    previous: Option<&PreviousState>,
    current: &DiscoveredResource,
    baseline: bool,
) -> Detected {
    if baseline {
        return Detected::Unchanged;
    }

    let Some(prev) = previous else {
        return Detected::New;
    };

    let was_available = prev.availability == "available";
    let is_available = current.available;

    if was_available && !is_available {
        return Detected::Unavailable;
    }
    if !was_available && is_available {
        return Detected::Restored;
    }

    if prev.due_at != current.due_at && (prev.due_at.is_some() || current.due_at.is_some()) {
        return Detected::DeadlineChanged {
            from: prev.due_at.clone(),
            to: current.due_at.clone(),
        };
    }

    let fingerprint = current.fingerprint();
    if prev.fingerprint.as_deref() != Some(fingerprint.as_str()) {
        let reason = describe_change(prev, current);
        return Detected::Updated { reason };
    }

    Detected::Unchanged
}

fn describe_change(prev: &PreviousState, current: &DiscoveredResource) -> String {
    let mut parts = Vec::new();
    if prev.title != current.title {
        parts.push("title changed".to_string());
    }
    if prev.uploaded_at != current.uploaded_at {
        parts.push("upload date available".to_string());
    }
    if prev.published_at != current.published_at {
        parts.push("publication time changed".to_string());
    }
    if parts.is_empty() {
        parts.push("content updated".to_string());
    }
    parts.join(", ")
}

/// Deduplication key for an event. Two events with the same key are the same
/// change and must never produce a second notification.
pub fn dedup_key(kind: &str, external_id: &str, discriminator: &str) -> String {
    format!("{kind}:{external_id}:{discriminator}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resource(id: &str, _fp: &str, available: bool) -> DiscoveredResource {
        DiscoveredResource {
            external_id: id.into(),
            course_external_id: "10".into(),
            title: format!("Title {id}"),
            url: format!("https://quanta.bits-pilani.ac.in/mod/resource/view.php?id={id}"),
            source_page_url: None,
            resource_type: "pdf".into(),
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            size_bytes: None,
            section: None,
            section_path: Vec::new(),
            is_external: false,
            available,
        }
    }

    fn prev(fp: &str, availability: &str) -> PreviousState {
        PreviousState {
            fingerprint: Some(fp.into()),
            availability: availability.into(),
            due_at: None,
            uploaded_at: None,
            published_at: None,
            title: "Title 1".into(),
        }
    }

    #[test]
    fn baseline_suppresses_everything() {
        let r = resource("1", "a", true);
        assert_eq!(classify(None, &r, true), Detected::Unchanged);
        assert_eq!(classify(Some(&prev("a", "available")), &r, true), Detected::Unchanged);
    }

    #[test]
    fn new_resource_detected() {
        let r = resource("1", "a", true);
        assert_eq!(classify(None, &r, false), Detected::New);
    }

    #[test]
    fn identical_resource_is_unchanged() {
        let mut r = resource("1", "a", true);
        r.title = "Title 1".into();
        let fp = r.fingerprint();
        assert_eq!(classify(Some(&prev(&fp, "available")), &r, false), Detected::Unchanged);
    }

    #[test]
    fn section_and_parent_path_changes_do_not_change_resource_fingerprint() {
        let mut before = resource("1", "a", true);
        before.title = "Title 1".into();
        before.section = Some("Old section".into());
        before.section_path = vec!["Old section".into(), "Old folder".into()];
        let mut after = before.clone();
        after.section = Some("New section".into());
        after.section_path = vec!["New section".into(), "New folder".into()];

        let previous = PreviousState {
            fingerprint: Some(before.fingerprint()),
            ..prev("unused", "available")
        };
        assert_eq!(
            classify(Some(&previous), &after, false),
            Detected::Unchanged
        );
    }

    #[test]
    fn changed_fingerprint_is_updated() {
        let r = resource("1", "b", true);
        match classify(Some(&prev("different", "available")), &r, false) {
            Detected::Updated { .. } => {}
            other => panic!("expected Updated, got {other:?}"),
        }
    }

    #[test]
    fn disappearing_is_not_deletion_but_unavailable() {
        let r = resource("1", "a", false);
        assert_eq!(classify(Some(&prev("a", "available")), &r, false), Detected::Unavailable);
    }

    #[test]
    fn coming_back_is_restored() {
        let r = resource("1", "a", true);
        assert_eq!(classify(Some(&prev("a", "unavailable")), &r, false), Detected::Restored);
    }

    #[test]
    fn deadline_change_is_detected() {
        let mut r = resource("1", "a", true);
        r.due_at = Some("2026-11-01T23:59:00+05:30".into());
        let mut p = prev(&r.fingerprint(), "available");
        p.due_at = Some("2026-10-25T23:59:00+05:30".into());
        match classify(Some(&p), &r, false) {
            Detected::DeadlineChanged { to, .. } => {
                assert_eq!(to.as_deref(), Some("2026-11-01T23:59:00+05:30"))
            }
            other => panic!("expected DeadlineChanged, got {other:?}"),
        }
    }

    #[test]
    fn dedup_keys_are_stable() {
        assert_eq!(dedup_key("new", "mod:resource:1", "abc"), "new:mod:resource:1:abc");
    }
}

//! User-configurable settings, persisted as a single JSON row in SQLite.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    // Scheduling
    pub sync_interval_minutes: u64,
    pub launch_at_login: bool,
    pub run_in_background: bool,

    // Notifications
    pub notifications_enabled: bool,
    pub notify_new: bool,
    pub notify_updated: bool,
    pub notify_announcements: bool,
    pub notify_deadlines: bool,
    pub notify_availability: bool,
    pub notify_auth: bool,
    pub quiet_hours_start: Option<String>,
    pub quiet_hours_end: Option<String>,
    pub deadline_reminder_hours: i64,

    // Display
    pub timezone: String,

    // Storage
    /// LRU ceiling for files/<resource_id>/<content_hash>, in bytes.
    /// `#[serde(default)]` because `load_settings` falls back to `default()` on
    /// a deserialisation failure: a missing field would otherwise wipe the
    /// whole settings row for anyone upgrading.
    #[serde(default = "default_cache_limit_bytes")]
    pub cache_limit_bytes: u64,

    // Mirror (the permanent local copy of everything Quanta serves)
    /// Download new and updated resources as each scan finds them.
    #[serde(default = "default_true")]
    pub mirror_enabled: bool,
    /// Mirror root. `None` means the default under the user's Documents folder.
    #[serde(default)]
    pub mirror_root: Option<String>,
    /// Files above this size are skipped, not failed. 0 means no limit.
    #[serde(default = "default_mirror_max_bytes")]
    pub mirror_max_bytes: u64,
    /// Pause the queue rather than fill the disk below this free-space floor.
    #[serde(default = "default_mirror_min_free_bytes")]
    pub mirror_min_free_bytes: u64,
    /// Superseded copies kept per resource under `<root>/.history`.
    #[serde(default = "default_mirror_keep_versions")]
    pub mirror_keep_versions: usize,

    // Crawl limits (safety rails; conservative defaults)
    pub max_courses: usize,
    pub max_resources_per_course: usize,
    pub max_detail_fetches: usize,
    pub request_timeout_secs: u64,
    pub concurrency: usize,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            sync_interval_minutes: 60,
            launch_at_login: false,
            run_in_background: true,
            notifications_enabled: true,
            notify_new: true,
            notify_updated: true,
            notify_announcements: true,
            notify_deadlines: true,
            notify_availability: true,
            notify_auth: true,
            quiet_hours_start: None,
            quiet_hours_end: None,
            deadline_reminder_hours: 48,
            timezone: "system".to_string(),
            cache_limit_bytes: default_cache_limit_bytes(),
            mirror_enabled: true,
            mirror_root: None,
            mirror_max_bytes: default_mirror_max_bytes(),
            mirror_min_free_bytes: default_mirror_min_free_bytes(),
            mirror_keep_versions: default_mirror_keep_versions(),

            max_courses: 60,
            max_resources_per_course: 400,
            max_detail_fetches: 600,
            request_timeout_secs: 25,
            concurrency: 4,
        }
    }
}

impl Settings {
    /// Clamp values that would otherwise make the crawler unsafe.
    pub fn sanitize(&mut self) {
        // Floor at 64 MB so eviction cannot thrash, ceiling at 64 GB so a typo
        // cannot promise more disk than a machine has.
        self.cache_limit_bytes = self.cache_limit_bytes.clamp(64 * 1024 * 1024, 64 * 1024 * 1024 * 1024);
        self.sync_interval_minutes = self.sync_interval_minutes.clamp(15, 24 * 60);
        self.max_courses = self.max_courses.clamp(1, 500);
        self.max_resources_per_course = self.max_resources_per_course.clamp(1, 5000);
        self.max_detail_fetches = self.max_detail_fetches.clamp(0, 10_000);
        self.request_timeout_secs = self.request_timeout_secs.clamp(5, 120);
        self.concurrency = self.concurrency.clamp(1, 8);
        self.deadline_reminder_hours = self.deadline_reminder_hours.clamp(1, 24 * 30);

        // Mirror. 0 is the "no limit" choice and must survive the clamp.
        if self.mirror_max_bytes != 0 {
            self.mirror_max_bytes =
                self.mirror_max_bytes.clamp(16 * 1024 * 1024, 64 * 1024 * 1024 * 1024);
        }
        self.mirror_min_free_bytes =
            self.mirror_min_free_bytes.clamp(512 * 1024 * 1024, 1024 * 1024 * 1024 * 1024);
        self.mirror_keep_versions = self.mirror_keep_versions.min(10);
        if self
            .mirror_root
            .as_deref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(false)
        {
            self.mirror_root = None;
        }

        for slot in [&self.quiet_hours_start, &self.quiet_hours_end] {
            if let Some(v) = slot {
                if !is_valid_hhmm(v) {
                    // Fall back to "no quiet hours" rather than persist junk.
                }
            }
        }
    }

    /// True if the given local time falls inside the configured quiet hours.
    pub fn in_quiet_hours(&self, local_hhmm: &str) -> bool {
        match (&self.quiet_hours_start, &self.quiet_hours_end) {
            (Some(start), Some(end)) if is_valid_hhmm(start) && is_valid_hhmm(end) => {
                if start <= end {
                    local_hhmm >= start.as_str() && local_hhmm < end.as_str()
                } else {
                    // Window crosses midnight.
                    local_hhmm >= start.as_str() || local_hhmm < end.as_str()
                }
            }
            _ => false,
        }
    }
}

/// 2 GB. Large enough to hold a semester of slides, small enough that the
/// eviction pass stays cheap.
fn default_cache_limit_bytes() -> u64 {
    2 * 1024 * 1024 * 1024
}

fn default_true() -> bool {
    true
}

/// 500 MB. Above this a file is skipped with 'too_large', not failed.
fn default_mirror_max_bytes() -> u64 {
    500 * 1024 * 1024
}

/// 5 GB. Below this the queue pauses instead of filling the disk.
fn default_mirror_min_free_bytes() -> u64 {
    5 * 1024 * 1024 * 1024
}

fn default_mirror_keep_versions() -> usize {
    3
}

pub fn is_valid_hhmm(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let hh: u32 = s[0..2].parse().unwrap_or(99);
    let mm: u32 = s[3..5].parse().unwrap_or(99);
    hh <= 23 && mm <= 59
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_limit_defaults_to_two_gigabytes_and_clamps() {
        assert_eq!(Settings::default().cache_limit_bytes, 2 * 1024 * 1024 * 1024);

        let mut s = Settings { cache_limit_bytes: 0, ..Settings::default() };
        s.sanitize();
        assert_eq!(s.cache_limit_bytes, 64 * 1024 * 1024);
    }

    #[test]
    fn missing_cache_limit_field_does_not_discard_the_settings_row() {
        // A settings row written before this field existed.
        let mut json = serde_json::to_value(Settings::default()).unwrap();
        json.as_object_mut().unwrap().remove("cacheLimitBytes");
        let parsed: Settings = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.cache_limit_bytes, Settings::default().cache_limit_bytes);
    }

    #[test]
    fn missing_mirror_fields_do_not_discard_the_settings_row() {
        // Same guarantee for the mirror fields: a row written before Part B.
        let mut json = serde_json::to_value(Settings::default()).unwrap();
        let obj = json.as_object_mut().unwrap();
        for key in [
            "mirrorEnabled",
            "mirrorRoot",
            "mirrorMaxBytes",
            "mirrorMinFreeBytes",
            "mirrorKeepVersions",
        ] {
            obj.remove(key);
        }
        let parsed: Settings = serde_json::from_value(json).unwrap();
        assert!(parsed.mirror_enabled);
        assert_eq!(parsed.mirror_root, None);
        assert_eq!(parsed.mirror_max_bytes, 500 * 1024 * 1024);
        assert_eq!(parsed.mirror_min_free_bytes, 5 * 1024 * 1024 * 1024);
        assert_eq!(parsed.mirror_keep_versions, 3);
    }

    #[test]
    fn mirror_sanitize_keeps_zero_as_no_limit_and_clamps_the_rest() {
        let mut s = Settings {
            mirror_max_bytes: 0,
            mirror_min_free_bytes: 1,
            mirror_keep_versions: 99,
            mirror_root: Some("   ".into()),
            ..Settings::default()
        };
        s.sanitize();
        assert_eq!(s.mirror_max_bytes, 0, "0 means no limit and must survive");
        assert_eq!(s.mirror_min_free_bytes, 512 * 1024 * 1024);
        assert_eq!(s.mirror_keep_versions, 10);
        assert_eq!(s.mirror_root, None, "a blank root means the default");

        let mut s = Settings {
            mirror_max_bytes: 1,
            ..Settings::default()
        };
        s.sanitize();
        assert_eq!(s.mirror_max_bytes, 16 * 1024 * 1024);
    }

    #[test]
    fn quiet_hours_within_same_day() {
        let mut s = Settings::default();
        s.quiet_hours_start = Some("22:00".into());
        s.quiet_hours_end = Some("07:00".into());
        assert!(s.in_quiet_hours("23:30"));
        assert!(s.in_quiet_hours("06:00"));
        assert!(!s.in_quiet_hours("12:00"));
    }

    #[test]
    fn quiet_hours_disabled_when_unset() {
        let s = Settings::default();
        assert!(!s.in_quiet_hours("03:00"));
    }

    #[test]
    fn sanitize_clamps_intervals() {
        let mut s = Settings::default();
        s.sync_interval_minutes = 1;
        s.concurrency = 99;
        s.sanitize();
        assert_eq!(s.sync_interval_minutes, 15);
        assert_eq!(s.concurrency, 8);
    }

    #[test]
    fn hhmm_validation() {
        assert!(is_valid_hhmm("00:00"));
        assert!(is_valid_hhmm("23:59"));
        assert!(!is_valid_hhmm("24:00"));
        assert!(!is_valid_hhmm("7:00"));
        assert!(!is_valid_hhmm("nope"));
    }
}

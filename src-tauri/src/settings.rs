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
        self.sync_interval_minutes = self.sync_interval_minutes.clamp(15, 24 * 60);
        self.max_courses = self.max_courses.clamp(1, 500);
        self.max_resources_per_course = self.max_resources_per_course.clamp(1, 5000);
        self.max_detail_fetches = self.max_detail_fetches.clamp(0, 10_000);
        self.request_timeout_secs = self.request_timeout_secs.clamp(5, 120);
        self.concurrency = self.concurrency.clamp(1, 8);
        self.deadline_reminder_hours = self.deadline_reminder_hours.clamp(1, 24 * 30);
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

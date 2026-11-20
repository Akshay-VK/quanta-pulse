//! Bounded in-memory aggregation of actual discovery boundaries for scan history.

use std::sync::{Arc, Mutex};

use crate::models::{ScanCourseDetail, ScanCourseStatus as Status, ScanDetails, ScanStep};
use crate::quanta::discover::{Observation, ObservationBoundary, ObserverFn};

#[derive(Default)]
struct CourseWork {
    name: String,
    started_at: Option<String>,
    completed_at: Option<String>,
    page: Option<ScanStep>,
    detail: Option<ScanStep>,
    detail_active: usize,
    detail_succeeded: usize,
    detail_failed: usize,
    page_status: Option<Status>,
    error: Option<String>,
}

/// Thread-safe observer used by discovery tasks. It only retains one course
/// row and at most two aggregate steps per observed course.
#[derive(Clone, Default)]
pub(crate) struct Collector(Arc<Mutex<Vec<(String, CourseWork)>>>);

impl Collector {
    pub(crate) fn observer(&self) -> ObserverFn {
        let this = self.clone();
        Arc::new(move |event| this.record(event))
    }

    fn record(&self, event: Observation) {
        let mut courses = self.0.lock().expect("diagnostic collector poisoned");
        let external_id = event.course_external_id;
        let index = courses
            .iter()
            .position(|(id, _)| id == &external_id)
            .unwrap_or_else(|| {
                courses.push((external_id.clone(), CourseWork::default()));
                courses.len() - 1
            });
        let work = &mut courses[index].1;
        work.name = event.course_name;
        match event.boundary {
            ObservationBoundary::CourseStarted => {
                work.started_at.get_or_insert(event.at.clone());
                work.page.get_or_insert(ScanStep {
                    label: "Course pages".into(),
                    status: Status::Success,
                    started_at: event.at,
                    completed_at: None,
                    error: None,
                });
            }
            ObservationBoundary::CoursePagesTerminal { status, error } => {
                work.page_status = Some(status);
                if let Some(step) = work.page.as_mut() {
                    step.status = status;
                    step.completed_at = Some(event.at);
                    step.error = error.clone();
                }
                if error.is_some() {
                    work.error = error;
                }
            }
            ObservationBoundary::DetailStarted => {
                work.detail_active += 1;
                let step = work.detail.get_or_insert(ScanStep {
                    label: "Material details".into(),
                    status: Status::Success,
                    started_at: event.at,
                    completed_at: None,
                    error: None,
                });
                step.completed_at = None;
            }
            ObservationBoundary::DetailTerminal { status, error } => {
                work.detail_active = work.detail_active.saturating_sub(1);
                if status == Status::Success {
                    work.detail_succeeded += 1;
                } else {
                    work.detail_failed += 1;
                }
                if let Some(message) = error {
                    append_error(&mut work.error, message.clone());
                    if let Some(step) = work.detail.as_mut() {
                        append_error(&mut step.error, message);
                    }
                }
                if work.detail_active == 0 {
                    if let Some(step) = work.detail.as_mut() {
                        step.completed_at = Some(event.at);
                        step.status = detail_status(work.detail_succeeded, work.detail_failed);
                    }
                }
            }
        }
    }

    /// Close only work that was actually observed. Never-started courses do
    /// not have collector entries.
    pub(crate) fn finish(
        &self,
        scan_id: i64,
        cancelled: bool,
        auth_expired: bool,
        interrupted_at: &str,
        course_ids: &std::collections::HashMap<String, i64>,
    ) -> ScanDetails {
        let mut courses = self.0.lock().expect("diagnostic collector poisoned");
        let mut result = Vec::with_capacity(courses.len());
        for (external_id, work) in courses.iter_mut() {
            let active = work.page_status.is_none() || work.detail_active > 0;
            let terminal = active.then_some(if cancelled || auth_expired {
                Status::Cancelled
            } else {
                Status::Failed
            });
            if let Some(status) = terminal {
                let at = interrupted_at.to_owned();
                if work.page_status.is_none() {
                    if let Some(step) = work.page.as_mut() {
                        step.status = status;
                        step.completed_at = Some(at.clone());
                        step.error = Some("scan ended before this work returned".into());
                    }
                }
                if work.detail_active > 0 {
                    if let Some(step) = work.detail.as_mut() {
                        step.status = status;
                        step.completed_at = Some(at.clone());
                        step.error
                            .get_or_insert_with(|| "scan ended before this work returned".into());
                    }
                }
                work.completed_at = Some(at);
            } else {
                work.completed_at = work
                    .detail
                    .as_ref()
                    .and_then(|s| s.completed_at.clone())
                    .or_else(|| work.page.as_ref().and_then(|s| s.completed_at.clone()));
            }
            let status = if terminal.is_some() {
                terminal.unwrap()
            } else if work.page_status == Some(Status::Failed) {
                Status::Failed
            } else if work.page_status == Some(Status::Partial) || work.detail_failed > 0 {
                Status::Partial
            } else {
                Status::Success
            };
            let mut steps = Vec::with_capacity(2);
            if let Some(step) = work.page.clone() {
                steps.push(step);
            }
            if let Some(step) = work.detail.clone() {
                steps.push(step);
            }
            if let Some(started_at) = work.started_at.clone() {
                result.push(ScanCourseDetail {
                    course_id: course_ids.get(external_id).copied(),
                    course_name: work.name.clone(),
                    status,
                    started_at,
                    completed_at: work.completed_at.clone(),
                    steps,
                    error: work.error.clone(),
                });
            }
        }
        ScanDetails {
            scan_id,
            courses: result,
        }
    }
}

/// Production persistence seam shared with deterministic tests. The engine
/// calls it only after finalizing the aggregate scan row.
pub(crate) fn persist(conn: &rusqlite::Connection, details: &ScanDetails) -> rusqlite::Result<()> {
    crate::db::save_scan_details(conn, details)
}

fn detail_status(succeeded: usize, failed: usize) -> Status {
    if failed == 0 {
        Status::Success
    } else if succeeded == 0 {
        Status::Failed
    } else {
        Status::Partial
    }
}

fn append_error(target: &mut Option<String>, message: String) {
    match target {
        Some(existing) => {
            existing.push_str("; ");
            existing.push_str(&message);
        }
        None => *target = Some(message),
    }
    if let Some(existing) = target.as_mut() {
        existing.truncate(2048);
    }
}

#[cfg(test)]
mod tests {
    use super::{persist, Collector, Observation, ObservationBoundary};
    use crate::{
        db,
        models::{ScanCourseStatus as Status, ScanDetails},
    };
    use std::collections::HashMap;

    fn event(boundary: ObservationBoundary, at: &str) -> Observation {
        Observation {
            course_external_id: "c1".into(),
            course_name: "Course one".into(),
            at: at.into(),
            boundary,
        }
    }

    #[test]
    fn observed_success_partial_and_cancelled_work_persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagnostics.sqlite");
        let conn = db::open(&path).unwrap();
        let scan_id = db::start_scan(&conn, "2026-11-16T00:00:00Z").unwrap();
        let collector = Collector::default();
        let observer = collector.observer();
        observer(event(
            ObservationBoundary::CourseStarted,
            "2026-11-16T00:00:01Z",
        ));
        observer(event(
            ObservationBoundary::CoursePagesTerminal {
                status: Status::Success,
                error: None,
            },
            "2026-11-16T00:00:02Z",
        ));
        observer(event(
            ObservationBoundary::DetailStarted,
            "2026-11-16T00:00:03Z",
        ));
        observer(event(
            ObservationBoundary::DetailTerminal {
                status: Status::Partial,
                error: Some("bad url?token=secret".into()),
            },
            "2026-11-16T00:00:04Z",
        ));
        let details = collector.finish(
            scan_id,
            false,
            false,
            "2026-11-16T00:00:05Z",
            &HashMap::from([("c1".into(), 9)]),
        );
        assert_eq!(details.courses[0].status, Status::Partial);
        assert_eq!(details.courses[0].started_at, "2026-11-16T00:00:01Z");
        assert_eq!(
            details.courses[0].completed_at.as_deref(),
            Some("2026-11-16T00:00:04Z")
        );
        assert_eq!(
            details.courses[0].steps[0].started_at,
            "2026-11-16T00:00:01Z"
        );
        assert_eq!(
            details.courses[0].steps[1].completed_at.as_deref(),
            Some("2026-11-16T00:00:04Z")
        );
        assert!(persist(
            &conn,
            &ScanDetails {
                scan_id: scan_id + 100,
                courses: details.courses.clone(),
            }
        )
        .is_err());
        let aggregate_status: String = conn
            .query_row(
                "SELECT status FROM scan_runs WHERE id=?1",
                [scan_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(aggregate_status, "running");
        persist(&conn, &details).unwrap();
        drop(conn);

        let reopened = db::open(&path).unwrap();
        let stored = db::scan_details(&reopened, scan_id).unwrap().unwrap();
        assert_eq!(stored.courses[0].status, details.courses[0].status);
        assert_eq!(stored.courses[0].started_at, details.courses[0].started_at);
        assert_eq!(stored.courses[0].steps.len(), 2);
        assert_eq!(
            stored.courses[0].steps[0].started_at,
            details.courses[0].steps[0].started_at
        );
        assert_eq!(
            stored.courses[0].steps[1].completed_at,
            details.courses[0].steps[1].completed_at
        );
        assert!(!stored.courses[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("secret"));
        assert!(!stored.courses[0].steps[1]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("secret"));
        assert_eq!(stored.courses[0].course_id, Some(9));
        let raw: String = reopened
            .query_row(
                "SELECT payload FROM scan_details WHERE scan_id=?1",
                [scan_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!raw.contains("secret"));
        assert!(raw.contains("2026-11-16T00:00:01Z"));

        let second = db::start_scan(&reopened, "2026-11-16T00:01:00Z").unwrap();
        let interrupted = Collector::default();
        (interrupted.observer())(event(
            ObservationBoundary::CourseStarted,
            "2026-11-16T00:01:01Z",
        ));
        let closed =
            interrupted.finish(second, true, false, "2026-11-16T00:01:02Z", &HashMap::new());
        assert_eq!(closed.courses[0].status, Status::Cancelled);
        assert_eq!(closed.courses[0].steps[0].status, Status::Cancelled);
        assert_eq!(
            closed.courses[0].completed_at.as_deref(),
            Some("2026-11-16T00:01:02Z")
        );
        assert!(
            closed.courses[0].steps[0].started_at
                < closed.courses[0].steps[0].completed_at.clone().unwrap()
        );
    }

    #[test]
    fn unstarted_courses_are_absent_and_completed_course_survives_later_cancellation() {
        let collector = Collector::default();
        let observer = collector.observer();
        observer(event(
            ObservationBoundary::CourseStarted,
            "2026-11-16T00:00:01Z",
        ));
        observer(event(
            ObservationBoundary::CoursePagesTerminal {
                status: Status::Success,
                error: None,
            },
            "2026-11-16T00:00:02Z",
        ));
        let details = collector.finish(1, true, false, "2026-11-16T00:00:03Z", &HashMap::new());
        assert_eq!(details.courses.len(), 1);
        assert_eq!(details.courses[0].status, Status::Success);
        assert_eq!(
            details.courses[0].completed_at.as_deref(),
            Some("2026-11-16T00:00:02Z")
        );
    }

    #[test]
    fn failed_page_observation_is_terminal() {
        let collector = Collector::default();
        let observer = collector.observer();
        observer(event(
            ObservationBoundary::CourseStarted,
            "2026-11-16T00:00:01Z",
        ));
        observer(event(
            ObservationBoundary::CoursePagesTerminal {
                status: Status::Failed,
                error: Some("offline".into()),
            },
            "2026-11-16T00:00:02Z",
        ));
        let details = collector.finish(3, false, false, "2026-11-16T00:00:03Z", &HashMap::new());
        assert_eq!(details.courses[0].status, Status::Failed);
        assert_eq!(details.courses[0].error.as_deref(), Some("offline"));
        assert_eq!(
            details.courses[0].completed_at.as_deref(),
            Some("2026-11-16T00:00:02Z")
        );
    }
}

//! Own-attendance observations for an explicitly synthetic report dialect.
//! V1 must establish the deployed layout and request effects before collection is wired.

use std::collections::HashSet;

use chrono::NaiveDate;
use rusqlite::OptionalExtension;
use scraper::{ElementRef, Html, Selector};

use crate::{
    academic::{
        self, AcademicCommit, AcademicSource, AttendanceObservation, AttendanceRange,
        AttendanceReportDetails, AttendanceSession, AttendanceSessionState, Coverage, Visibility,
    },
    db,
    quanta::{
        client::{StudentReport, StudentReportError, QUANTA_ORIGIN},
        report_html::{hidden, positive_id, readable_text, unique},
    },
    state::AppState,
};

/// Capture one supported self-report page using A0's bounded transport and commit fence.
/// The module is a candidate tied to this course by the verified report envelope.
pub async fn collect(
    state: &AppState,
    generation: &str,
    course_id: i64,
    course_module_id: i64,
) -> Result<AcademicCommit, String> {
    let context = academic::context(state);
    let student_id = context
        .owner
        .filter(|_| context.generation == generation)
        .ok_or("Academic session changed")?
        .moodle_user_id;
    let external: String = state
        .conn()
        .query_row(
            "SELECT external_course_id FROM courses WHERE id=?1",
            [course_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Academic storage unavailable")?
        .ok_or("Course unavailable")?;
    let commit = |coverage, report| {
        academic::commit_attendance_report(
            state,
            generation,
            course_id,
            course_module_id,
            coverage,
            report,
        )
    };
    let Some(moodle_course_id) = positive_id(&external) else {
        return commit(Coverage::Unsupported, None);
    };
    academic::read_student_report_then(
        state,
        generation,
        StudentReport::Attendance { course_module_id },
        |response| match response {
            Ok(response) => match parse_report(
                &response.body,
                student_id,
                moodle_course_id,
                course_module_id,
            ) {
                Some((coverage, report)) => commit(coverage, Some(report)),
                None => commit(Coverage::Unsupported, None),
            },
            Err(StudentReportError::Denied) => commit(Coverage::Denied, None),
            Err(StudentReportError::Unavailable) => commit(Coverage::Offline, None),
            Err(
                StudentReportError::Unsupported
                | StudentReportError::TooLarge
                | StudentReportError::UnsafeRoute,
            ) => commit(Coverage::Unsupported, None),
            Err(error) => Err(error.to_string()),
        },
    )
    .await
    .map_err(|error| error.to_string())?
}

fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static attendance-report selector")
}

fn field(root: ElementRef<'_>, name: &str) -> Option<String> {
    let node = unique(root.select(&selector(&format!("[data-field='{name}']"))))?;
    // Action labels and attributes are outside this synthetic fixture contract.
    if node
        .select(&selector("a, button, form, input, img"))
        .next()
        .is_some()
        || matches!(
            node.value().name(),
            "a" | "button" | "form" | "input" | "img"
        )
    {
        return None;
    }
    readable_text(node)
}

fn date(value: &str) -> Option<NaiveDate> {
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    (parsed.format("%Y-%m-%d").to_string() == value).then_some(parsed)
}

fn parse_report(
    body: &str,
    student_id: i64,
    course_id: i64,
    course_module_id: i64,
) -> Option<(Coverage, AttendanceObservation)> {
    let document = Html::parse_document(body);
    let report =
        unique(document.select(&selector("main[data-pulse-fixture='attendance-self-v1']")))?;
    let attr = |key| report.value().attr(key);
    if positive_id(attr("data-student")?)? != student_id
        || positive_id(attr("data-course")?)? != course_id
        || positive_id(attr("data-module")?)? != course_module_id
    {
        return None;
    }
    let activity_instance_id = positive_id(attr("data-instance")?)?;
    let group = attr("data-group")?;
    let (group_id, group_display) = if group == "course" {
        (None, None)
    } else {
        (Some(positive_id(group)?), Some(field(report, "group")?))
    };
    let range_key = attr("data-range")?;
    let range = match range_key {
        "all" => AttendanceRange::All,
        "month" => AttendanceRange::Month,
        "week" => AttendanceRange::Week,
        "custom" => AttendanceRange::Custom,
        _ => return None,
    };
    let (from, through, dates) = if range == AttendanceRange::All {
        if attr("data-from").is_some() || attr("data-through").is_some() {
            return None;
        }
        (None, None, "All dates".into())
    } else {
        let from = attr("data-from")?;
        let through = attr("data-through")?;
        if date(from)? > date(through)? {
            return None;
        }
        (
            Some(from.into()),
            Some(through.into()),
            format!("{from} to {through}"),
        )
    };
    let page: u32 = attr("data-page")?.parse().ok()?;
    let total_pages: u32 = attr("data-pages")?.parse().ok()?;
    if page == 0 || page > total_pages {
        return None;
    }
    let expected_rows: usize = attr("data-page-rows")?.parse().ok()?;
    let table = unique(report.select(&selector("tbody[data-session-rows]")))?;
    if table.ancestors().filter_map(ElementRef::wrap).any(hidden) {
        return None;
    }
    let rows = table
        .children()
        .filter_map(ElementRef::wrap)
        .filter(|row| row.value().name() == "tr" && !hidden(*row));
    let mut sessions = rows.map(parse_session).collect::<Option<Vec<_>>>()?;
    if sessions.len() > expected_rows {
        return None;
    }
    let mut ids = HashSet::new();
    if !sessions
        .iter()
        .all(|row| row.session_id.is_some_and(|id| ids.insert(id)))
    {
        // Inconsistent or missing IDs make this whole page a weak-ID snapshot.
        for row in &mut sessions {
            row.session_id = None;
        }
    }
    let complete = total_pages == 1 && sessions.len() == expected_rows;
    let scope_display = format!(
        "{dates} · {}",
        group_display.as_deref().unwrap_or("Course-wide")
    );
    let source_id = format!(
        "attendance:{course_module_id}:{activity_instance_id}:{}:{range_key}:{}:{}",
        group_id.unwrap_or(0),
        from.as_deref().unwrap_or(""),
        through.as_deref().unwrap_or("")
    );
    let record = AttendanceObservation {
        source: AcademicSource {
            source_id,
            source_url: format!("{QUANTA_ORIGIN}/mod/attendance/view.php?id={course_module_id}"),
            observed_at: db::now_rfc3339(),
            visibility: Visibility::Visible,
        },
        activity_instance_id,
        course_module_id: Some(course_module_id),
        session_id: None,
        scope_display,
        status_display: None,
        points_display: None,
        maximum_display: field(report, "denominator"),
        summary_display: field(report, "summary-value"),
        details: Some(AttendanceReportDetails {
            title: field(report, "activity")?,
            group_id,
            group_display,
            range,
            from,
            through,
            page,
            total_pages,
            complete,
            summary_label: field(report, "summary-label"),
            sessions,
        }),
    };
    Some((
        if complete {
            Coverage::Complete
        } else {
            Coverage::Partial
        },
        record,
    ))
}

fn parse_session(row: ElementRef<'_>) -> Option<AttendanceSession> {
    let state = match row.value().attr("data-state") {
        Some("recorded") => AttendanceSessionState::Recorded,
        Some("absent") => AttendanceSessionState::Absent,
        Some("unrecorded") => AttendanceSessionState::Unrecorded,
        Some("future") => AttendanceSessionState::Future,
        Some("enrollment-boundary") => AttendanceSessionState::EnrollmentBoundary,
        _ => AttendanceSessionState::Unknown,
    };
    Some(AttendanceSession {
        session_id: row.value().attr("data-session-id").and_then(positive_id),
        date_display: field(row, "date")?,
        description: field(row, "description"),
        state,
        status_display: field(row, "status"),
        points_display: field(row, "points"),
        maximum_display: field(row, "maximum"),
        remarks: field(row, "remarks"),
    })
}

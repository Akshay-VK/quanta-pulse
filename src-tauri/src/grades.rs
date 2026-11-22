//! Local grade observation pipeline for a bounded, synthetic self-report dialect.
//! No scheduler or desktop command fetches this source before V1 validation.

use std::collections::HashSet;

use rusqlite::OptionalExtension;
use scraper::{ElementRef, Html, Selector};

use crate::{
    academic::{
        self, AcademicBatch, AcademicCommit, AcademicSource, Coverage, GradeDetails, GradeKind,
        GradeObservation, GradeValueStatus, Visibility,
    },
    db,
    quanta::client::{StudentReport, StudentReportError, QUANTA_ORIGIN},
    state::AppState,
};

/// Read one course's current-self report and reconcile it atomically through A0.
/// Admission, expiry and ownership errors cannot commit under the old session.
pub async fn collect(
    state: &AppState,
    generation: &str,
    course_id: i64,
) -> Result<AcademicCommit, String> {
    let owner = academic::context(state);
    let student_id = owner
        .owner
        .filter(|_| owner.generation == generation)
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
    let commit = |coverage, rows| {
        academic::commit(
            state,
            generation,
            course_id,
            coverage,
            AcademicBatch::Grades(rows),
        )
    };
    let Some(moodle_course_id) = positive_id(&external) else {
        return commit(Coverage::Unsupported, vec![]);
    };
    let source_url = format!("{QUANTA_ORIGIN}/grade/report/user/index.php?id={moodle_course_id}");
    academic::read_student_report_then(
        state,
        generation,
        StudentReport::Grades {
            course_id: moodle_course_id,
        },
        |response| {
            let (coverage, rows) = match response {
                Ok(response) => parse_report(&response.body, &source_url, student_id)
                    .unwrap_or((Coverage::Unsupported, vec![])),
                Err(StudentReportError::Denied) => (Coverage::Denied, vec![]),
                Err(StudentReportError::Unavailable) => (Coverage::Offline, vec![]),
                Err(StudentReportError::Unsupported | StudentReportError::TooLarge) => {
                    (Coverage::Unsupported, vec![])
                }
                Err(error) => return Err(error.to_string()),
            };
            commit(coverage, rows)
        },
    )
    .await
    .map_err(|error| error.to_string())?
}

fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static grade-report selector")
}

fn unique<'a>(mut elements: impl Iterator<Item = ElementRef<'a>>) -> Option<ElementRef<'a>> {
    let first = elements.next()?;
    elements.next().is_none().then_some(first)
}

fn hidden(element: ElementRef<'_>) -> bool {
    let tag = element.value();
    tag.attr("hidden").is_some()
        || tag.attr("aria-hidden") == Some("true")
        || tag
            .classes()
            .any(|class| matches!(class, "d-none" | "hidden" | "visually-hidden" | "sr-only"))
        || tag.attr("style").is_some_and(|style| {
            style.split(';').any(|rule| {
                rule.split_once(':').is_some_and(|(name, value)| {
                    let value = value.split('!').next().unwrap_or("").trim();
                    (name.trim().eq_ignore_ascii_case("display")
                        && value.eq_ignore_ascii_case("none"))
                        || (name.trim().eq_ignore_ascii_case("visibility")
                            && value.eq_ignore_ascii_case("hidden"))
                })
            })
        })
}

fn readable_text(element: ElementRef<'_>) -> Option<String> {
    let mut text = String::new();
    for node in element.descendants() {
        if node
            .ancestors()
            .filter_map(ElementRef::wrap)
            .any(|ancestor| {
                hidden(ancestor)
                    || matches!(
                        ancestor.value().name(),
                        "script" | "style" | "template" | "noscript" | "svg" | "iframe"
                    )
            })
        {
            continue;
        }
        if let Some(value) = node.value().as_text() {
            text.push_str(value);
        } else if let Some(tag) = node.value().as_element() {
            if matches!(tag.name(), "p" | "br" | "div" | "li" | "blockquote") {
                text.push(' ');
            }
        }
    }
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty()).then_some(normalized)
}

fn positive_id(value: &str) -> Option<i64> {
    value
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
}

fn report_id(element: ElementRef<'_>, prefix: &str, suffix: &str) -> Option<i64> {
    positive_id(
        element
            .value()
            .id()?
            .strip_prefix(prefix)?
            .strip_suffix(suffix)?,
    )
}

fn category_source(id: i64) -> String {
    format!("category:{id}")
}

// Moodle emits the parent category path as classes on each row.
fn parent_category(row: ElementRef<'_>) -> Option<String> {
    row.value()
        .attr("class")?
        .split_ascii_whitespace()
        .rev()
        .find_map(|class| positive_id(class.strip_prefix("cat_")?).map(category_source))
}

struct Columns {
    grade: Option<String>,
    range: Option<String>,
    weight: Option<String>,
    percentage: Option<String>,
    letter: Option<String>,
    feedback: Option<String>,
}

fn parse_report(body: &str, url: &str, student: i64) -> Option<(Coverage, Vec<GradeObservation>)> {
    let document = Html::parse_document(body);
    let table = unique(document.select(&selector("table.user-grade")))?;
    if table.ancestors().filter_map(ElementRef::wrap).any(hidden) || hidden(table) {
        return None;
    }
    let container = table.parent().and_then(ElementRef::wrap)?;
    let container_id = format!("user-report-{student}");
    if !container.value().has_class(
        "user-report-container",
        scraper::CaseSensitivity::CaseSensitive,
    ) || container.value().id() != Some(container_id.as_str())
    {
        return None;
    }
    let header = unique(table.select(&selector("thead > tr")))?;
    let column = |key: &str| {
        let id = format!("{key}{student}");
        let class = format!("column-{key}");
        unique(header.child_elements().filter(|cell| {
            cell.value().name() == "th"
                && cell.value().id() == Some(id.as_str())
                && cell.value().classes().any(|name| name == class)
        }))
        .map(|_| id)
    };
    column("itemname")?;
    let columns = Columns {
        grade: column("grade"),
        range: column("range"),
        weight: column("weight"),
        percentage: column("percentage"),
        letter: column("lettergrade"),
        feedback: column("feedback"),
    };
    if columns.grade.is_none() && columns.percentage.is_none() && columns.letter.is_none() {
        return None;
    }

    let observed_at = db::now_rfc3339();
    let suffix = format!("_{student}");
    let mut ids = HashSet::new();
    let mut rows = Vec::new();
    let mut coverage = Coverage::Complete;
    let mut course_total = false;
    for row in table.select(&selector("tbody > tr")) {
        if row.value().classes().any(|c| c == "spacer")
            && row.child_elements().all(|cell| {
                cell.value().name() == "td"
                    && cell.value().attr("rowspan").is_some()
                    && readable_text(cell).is_none()
            })
        {
            continue;
        }
        let Some(grade) = parse_row(row, &columns, &suffix, url, &observed_at) else {
            coverage = Coverage::Partial;
            continue;
        };
        if !ids.insert(grade.source.source_id.clone()) {
            return None;
        }
        if grade.item_kind == GradeKind::CourseTotal && std::mem::replace(&mut course_total, true) {
            return None;
        }
        rows.push(grade);
    }
    if rows.iter().any(|row| {
        row.parent_source_id
            .as_ref()
            .is_some_and(|id| !ids.contains(id))
    }) {
        coverage = Coverage::Partial;
    }
    Some((coverage, rows))
}

fn parse_row(
    row: ElementRef<'_>,
    columns: &Columns,
    suffix: &str,
    url: &str,
    observed_at: &str,
) -> Option<GradeObservation> {
    if hidden(row) {
        return None;
    }
    let label = unique(
        row.child_elements()
            .filter(|cell| cell.value().name() == "th"),
    )?;
    let category_id = report_id(label, "cat_", suffix);
    let grade_item_id = report_id(label, "row_", suffix);
    let (source_id, item_kind, title) = if let Some(id) = category_id {
        if !label.value().classes().any(|class| class == "category") {
            return None;
        }
        (
            category_source(id),
            GradeKind::Category,
            readable_text(label)?,
        )
    } else {
        let id = grade_item_id?;
        let kind = unique(label.select(&selector(".courseitem, .categoryitem, .item")))?;
        let item_kind = if kind.value().classes().any(|class| class == "courseitem") {
            GradeKind::CourseTotal
        } else if kind.value().classes().any(|class| class == "categoryitem") {
            GradeKind::CategoryTotal
        } else {
            GradeKind::Item
        };
        (
            format!("grade:{id}"),
            item_kind,
            readable_text(unique(kind.select(&selector(".rowtitle")))?)?,
        )
    };
    let mut observation = GradeObservation {
        source: AcademicSource {
            source_id,
            source_url: url.into(),
            observed_at: observed_at.into(),
            visibility: Visibility::Visible,
        },
        title,
        grade_item_id,
        parent_source_id: parent_category(row),
        item_kind,
        display_value: None,
        numeric_value: None,
        range_display: None,
        weight_display: None,
        feedback: None,
        details: None,
        omitted: false,
    };
    if category_id.is_some() {
        return Some(observation);
    }

    let label_id = label.value().id()?;
    // Resolve cells by semantic headers and their own grade-item header.
    let cell = |column: &Option<String>| -> Option<Option<ElementRef<'_>>> {
        let Some(column) = column else {
            return Some(None);
        };
        let mut matches = row.child_elements().filter(|cell| {
            cell.value().name() == "td"
                && cell.value().attr("headers").is_some_and(|headers| {
                    headers.split_ascii_whitespace().any(|id| id == label_id)
                        && headers.split_ascii_whitespace().any(|id| id == column)
                })
        });
        let first = matches.next();
        matches.next().is_none().then_some(first)
    };
    let mark = cell(&columns.grade)?;
    let marker = mark.and_then(|cell| cell.value().attr("data-grade-state"));
    let has_class = |class| mark.is_some_and(|cell| cell.value().classes().any(|c| c == class));
    observation.source.visibility = if marker == Some("unreleased") {
        Visibility::Unreleased
    } else if marker == Some("hidden") || has_class("datesubmitted") || has_class("dimmed_text") {
        Visibility::Hidden
    } else if has_class("gradingerror") || hidden(label) || mark.is_some_and(hidden) {
        Visibility::Unknown
    } else {
        Visibility::Visible
    };
    if observation.source.visibility != Visibility::Visible {
        return Some(observation);
    }

    let mark_text = mark.and_then(readable_text);
    let is_value = |value: &str| !matches!(value, "-" | "–" | "—");
    observation.display_value = mark_text.clone().filter(|value| is_value(value));
    observation.numeric_value = observation
        .display_value
        .as_deref()
        .filter(|value| {
            value
                .bytes()
                .all(|b| b.is_ascii_digit() || b == b'.' || b == b'-')
        })
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite());
    let value_status = if observation.display_value.is_some() {
        GradeValueStatus::Reported
    } else if marker == Some("ungraded") {
        GradeValueStatus::Ungraded
    } else if mark.is_some() && mark_text.is_none() {
        GradeValueStatus::Blank
    } else {
        GradeValueStatus::Unknown
    };
    let field = |column| -> Option<Option<String>> {
        Some(
            cell(column)?
                .and_then(readable_text)
                .filter(|value| is_value(value)),
        )
    };
    observation.range_display = field(&columns.range)?;
    observation.weight_display = field(&columns.weight)?;
    observation.feedback = field(&columns.feedback)?;
    observation.details = Some(GradeDetails {
        value_status,
        percentage_display: field(&columns.percentage)?,
        letter_display: field(&columns.letter)?,
    });
    Some(observation)
}

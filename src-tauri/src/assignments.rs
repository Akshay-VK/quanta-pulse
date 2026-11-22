//! Student assignment observation from supported HTML shapes. Collection stays
//! explicit and internal pending V1 verification of permissions and view effects.

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use scraper::{ElementRef, Html, Selector};
use url::Url;

use crate::{
    academic::{
        self, AcademicDate, AcademicSource, AssignmentAttachment, AssignmentFacts,
        AssignmentObservation, DueProvenance, SubmissionMode, SubmissionStatus, Visibility,
    },
    models::Resource,
    quanta::client::{StudentReport, StudentReportError, QUANTA_ORIGIN},
    state::AppState,
};

/// Course-module identity comes from the canonical assignment view, never titles.
pub(crate) fn module_id(resource_type: &str, url: &str) -> Option<i64> {
    if resource_type != "assignment" {
        return None;
    }
    let url = Url::parse(url).ok()?;
    if url.origin().ascii_serialization() != QUANTA_ORIGIN
        || url.path() != "/mod/assign/view.php"
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let mut pairs = url.query_pairs();
    let (key, id) = pairs.next()?;
    if key != "id" || !id.bytes().all(|byte| byte.is_ascii_digit()) || pairs.next().is_some() {
        return None;
    }
    id.parse().ok().filter(|id| *id > 0)
}

/// Read one discovered assignment through the existing bounded self-report
/// transport. A caller may commit a complete course snapshot only after all
/// expected reads succeed. No Tauri command, scheduler or UI invokes this read.
pub async fn read_observation(
    state: &AppState,
    generation: &str,
    resource: &Resource,
) -> Result<AssignmentObservation, StudentReportError> {
    let course_module_id = module_id(&resource.resource_type, &resource.url)
        .filter(|_| resource.course_id.is_some())
        .ok_or(StudentReportError::UnsafeRoute)?;
    let response = academic::read_student_report(
        state,
        generation,
        StudentReport::Assignment { course_module_id },
    )
    .await?;
    parse_observation(&response.body, resource, course_module_id)
        .ok_or(StudentReportError::Unsupported)
}

fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static assignment selector")
}

fn visible(element: ElementRef<'_>) -> bool {
    !std::iter::once(element)
        .chain(element.ancestors().filter_map(ElementRef::wrap))
        .any(|ancestor| {
            let tag = ancestor.value();
            matches!(tag.name(), "script" | "style" | "template")
                || tag.attr("hidden").is_some()
                || tag.attr("aria-hidden") == Some("true")
                || tag
                    .classes()
                    .any(|class| matches!(class, "d-none" | "hidden"))
        })
}

fn text(element: ElementRef<'_>) -> Option<String> {
    let extracted = element
        .descendants()
        .filter_map(|node| {
            let value = node.value().as_text()?;
            visible(ElementRef::wrap(node.parent()?)?).then_some(value.as_ref())
        })
        .flat_map(str::split_whitespace)
        .collect::<Vec<_>>()
        .join(" ");
    (!extracted.is_empty()).then_some(extracted)
}

fn field_text(value: &str) -> AcademicDate {
    if matches!(
        value.to_ascii_lowercase().as_str(),
        "0" | "no due date" | "no date set" | "not set"
    ) {
        return AcademicDate::Unset;
    }
    if let Ok(instant) = DateTime::parse_from_rfc3339(value) {
        return AcademicDate::Instant(
            instant
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Secs, true),
        );
    }
    if NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok_and(|date| date.to_string() == value) {
        return AcademicDate::DateOnly(value.into());
    }
    AcademicDate::Ambiguous(value.into())
}

fn date(element: Option<ElementRef<'_>>) -> AcademicDate {
    let Some(element) = element else {
        return AcademicDate::Unknown;
    };
    let timestamp = element.attr("data-timestamp");
    if timestamp == Some("0") {
        return AcademicDate::Unset;
    }
    if let Some(instant) = timestamp
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .and_then(|value| DateTime::<Utc>::from_timestamp(value, 0))
    {
        return AcademicDate::Instant(instant.to_rfc3339_opts(SecondsFormat::Secs, true));
    }
    if timestamp.is_some() {
        return AcademicDate::Unsupported;
    }
    let time_selector = selector("time[datetime]");
    let mut times = element.select(&time_selector).filter(|item| visible(*item));
    let attribute = element
        .attr("datetime")
        .or_else(|| times.next()?.attr("datetime"));
    if times.next().is_some() {
        return AcademicDate::Unsupported;
    }
    if let Some(value) = attribute {
        return if value.is_empty() {
            AcademicDate::Unsupported
        } else {
            field_text(value)
        };
    }
    text(element).map_or(AcademicDate::Unsupported, |value| field_text(&value))
}

fn unique<'a>(mut elements: impl Iterator<Item = ElementRef<'a>>) -> Option<ElementRef<'a>> {
    let first = elements.next()?;
    elements.next().is_none().then_some(first)
}

fn status(cell: Option<ElementRef<'_>>) -> SubmissionStatus {
    let Some(cell) = cell else {
        return SubmissionStatus::Unknown;
    };
    let display = text(cell).unwrap_or_default().to_ascii_lowercase();
    match display.as_str() {
        "not required" | "no submission required" => return SubmissionStatus::NotRequired,
        "not yet open" | "this assignment is not yet open for submissions" => {
            return SubmissionStatus::NotYetOpen
        }
        "reopened" => return SubmissionStatus::Reopened,
        _ => {}
    }
    for element in cell
        .descendants()
        .filter_map(ElementRef::wrap)
        .filter(|cell| visible(*cell))
    {
        for class in element.value().classes() {
            match class {
                "submissionstatussubmitted" => return SubmissionStatus::Submitted,
                "submissionstatusdraft" => return SubmissionStatus::Draft,
                "submissionstatusnew" | "submissionstatusnosubmission" => {
                    return SubmissionStatus::Unsubmitted
                }
                "submissionstatusreopened" => return SubmissionStatus::Reopened,
                _ => {}
            }
        }
    }
    match display.as_str() {
        "submitted for grading" => SubmissionStatus::Submitted,
        "draft (not submitted)" | "draft" => SubmissionStatus::Draft,
        "no attempt" | "no submission" => SubmissionStatus::Unsubmitted,
        _ => SubmissionStatus::Unknown,
    }
}

fn projected_date(facts: &AssignmentFacts) -> (AcademicDate, DueProvenance) {
    use AcademicDate::*;
    let effective = &facts.effective_due;
    let extension_applies = match (effective, &facts.extension) {
        (Instant(due), Instant(extension)) => extension > due,
        (DateOnly(due), DateOnly(extension)) => extension > due,
        (Unknown | Unset, Instant(_) | DateOnly(_)) => true,
        _ => false,
    };
    if extension_applies {
        (facts.extension.clone(), DueProvenance::Extension)
    } else if *effective != Unknown {
        (effective.clone(), DueProvenance::Effective)
    } else if facts.base_due != Unknown {
        (facts.base_due.clone(), DueProvenance::Base)
    } else {
        (Unknown, DueProvenance::Unknown)
    }
}

fn parse_observation(
    html: &str,
    resource: &Resource,
    course_module_id: i64,
) -> Option<AssignmentObservation> {
    let document = Html::parse_document(html);
    let body = document
        .select(&selector("body#page-mod-assign-view"))
        .next()?;
    // A known module marker must agree with the requested URL.
    if body
        .value()
        .classes()
        .filter_map(|class| class.strip_prefix("cmid-"))
        .any(|id| id.parse::<i64>() != Ok(course_module_id))
    {
        return None;
    }
    let main = body
        .select(&selector("#region-main"))
        .next()
        .unwrap_or(body);
    let rows = selector(".submissionstatustable tr, .submissionsummarytable tr");
    let headings = selector("th[scope=row], th, td");
    let row = |labels: &[&str]| {
        unique(
            main.select(&rows)
                .filter(|row| visible(*row))
                .filter_map(|row| {
                    let mut cells = row.select(&headings).filter(|cell| visible(*cell));
                    let label = text(cells.next()?)?.to_ascii_lowercase();
                    labels
                        .contains(&label.as_str())
                        .then(|| cells.next())
                        .flatten()
                }),
        )
    };
    let activity_date = |key: &str| {
        let sel = selector(key);
        date(unique(main.select(&sel).filter(|item| visible(*item))))
    };
    let effective = activity_date(".activity-dates [dataid=duedate]");
    let effective_due = if effective == AcademicDate::Unknown {
        date(row(&["due date"]))
    } else {
        effective
    };
    let group = row(&["group", "submission group"]);
    let submission_type = row(&["submission type"]).and_then(text);
    let mode = match (group.is_some(), submission_type.as_deref()) {
        (true, _) | (_, Some("Team" | "Group")) => SubmissionMode::Team,
        (_, Some("Individual")) => SubmissionMode::Individual,
        _ => SubmissionMode::Unknown,
    };
    let pending_team_confirmations = if mode == SubmissionMode::Team {
        row(&[
            "required confirmations",
            "group members who still need to submit",
        ])
        .and_then(|cell| {
            let count = cell
                .select(&selector("li"))
                .filter(|item| visible(*item))
                .count();
            if count > 0 {
                u32::try_from(count).ok()
            } else {
                text(cell)?.parse().ok()
            }
        })
    } else {
        None
    };
    let submission = row(&["submission status"]);
    let attempt_number = row(&["attempt number"]).and_then(text).and_then(|display| {
        let number = display.strip_prefix("This is attempt ").unwrap_or(&display);
        let ordinal = number.split([' ', '.']).next()?.parse::<i64>().ok()?;
        ordinal.checked_sub(1).filter(|value| *value >= 0)
    });
    let intro = main.select(&selector("#intro")).find(|item| visible(*item));
    let mut attachments: Vec<AssignmentAttachment> = Vec::new();
    if let Some(intro) = intro {
        let origin = Url::parse(QUANTA_ORIGIN).expect("canonical Quanta origin");
        for link in intro
            .select(&selector("a[href]"))
            .filter(|item| visible(*item))
        {
            let Some(mut url) = link.attr("href").and_then(|href| origin.join(href).ok()) else {
                continue;
            };
            let reference = url.path_segments().is_some_and(|mut segments| {
                segments.next() == Some("pluginfile.php")
                    && segments
                        .next()
                        .is_some_and(|id| id.parse::<u64>().is_ok_and(|id| id > 0))
                    && segments.next() == Some("mod_assign")
                    && matches!(segments.next(), Some("intro" | "introattachment"))
                    && segments.any(|part| !part.is_empty())
            });
            if !reference
                || url.origin() != origin.origin()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                continue;
            }
            url.set_query(None);
            url.set_fragment(None);
            if let Some(title) = text(link).filter(|_| {
                !attachments
                    .iter()
                    .any(|attachment| attachment.url == url.as_str())
            }) {
                attachments.push(AssignmentAttachment {
                    title,
                    url: url.into(),
                });
            }
        }
    }
    let feedback = unique(
        main.select(&selector(".feedback"))
            .filter(|item| visible(*item)),
    );
    let released_feedback = feedback.and_then(|region| {
        region
            .select(&selector("h2, h3, h4"))
            .find(|heading| text(*heading).as_deref() == Some("Feedback"))?;
        let paragraphs: Vec<_> = region.select(&selector("p")).filter_map(text).collect();
        (!paragraphs.is_empty()).then(|| paragraphs.join("\n"))
    });
    let mut details = AssignmentFacts {
        opening: activity_date(".activity-dates [dataid=allowsubmissionsfromdate]"),
        base_due: date(row(&["base due date"])),
        effective_due,
        extension: date(row(&["extension due date", "extension granted until"])),
        cut_off: date(row(&["cut-off date", "cutoff date"])),
        grading_due: date(row(&["grading due date"])),
        due_provenance: DueProvenance::Unknown,
        mode,
        pending_team_confirmations,
        time_limit_seconds: row(&["time limit (seconds)"])
            .and_then(text)
            .and_then(|value| value.parse().ok()),
        description: intro.and_then(text),
        attachments,
        grading_status: row(&["grading status"]).and_then(text),
        released_feedback,
    };
    let (due, provenance) = projected_date(&details);
    details.due_provenance = provenance;
    let due_display = match provenance {
        DueProvenance::Base => row(&["base due date"]).and_then(text),
        DueProvenance::Extension => {
            row(&["extension due date", "extension granted until"]).and_then(text)
        }
        DueProvenance::Effective => main
            .select(&selector(".activity-dates [dataid=duedate]"))
            .find(|item| visible(*item))
            .and_then(text)
            .or_else(|| row(&["due date"]).and_then(text)),
        DueProvenance::Unknown => None,
    };
    Some(AssignmentObservation {
        source: AcademicSource {
            source_id: format!("assign:{course_module_id}"),
            source_url: format!("{QUANTA_ORIGIN}/mod/assign/view.php?id={course_module_id}"),
            observed_at: crate::db::now_rfc3339(),
            visibility: Visibility::Visible,
        },
        title: resource.title.clone(),
        course_module_id: Some(course_module_id),
        activity_instance_id: None,
        resource_id: Some(resource.id),
        due,
        due_display,
        submission_display: submission.and_then(text),
        calendar_event_id: None,
        submission_status: status(submission),
        attempt_number,
        details: Some(details),
    })
}

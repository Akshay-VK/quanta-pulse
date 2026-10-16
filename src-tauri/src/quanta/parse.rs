//! Pure HTML parsers for the Moodle (Quanta) pages Quanta Pulse reads.
//!
//! Moodle markup varies by theme and version. These parsers target the standard
//! "classic"/"boost" markup used by Quanta and are intentionally tolerant:
//! missing structures yield empty results rather than errors. Every function is
//! pure so it can be tested against captured fixtures without a network.

use once_cell::sync::Lazy;
use scraper::{ElementRef, Html, Selector};
use url::Url;

use crate::quanta::urlnorm::{
    friendly_resource_type, infer_file_type, is_internal, module_type_from_path, normalize_url,
    query_map, stable_resource_id,
};
use crate::quanta::{DiscoveredCourse, DiscoveredResource};

/* ------------------------------------------------------------------ selectors */

fn sel(css: &str) -> Selector {
    Selector::parse(css).expect("static selector")
}

static S_COURSE_LINK: Lazy<Selector> = Lazy::new(|| sel("a[href*=\"course/view.php\"]"));
static S_PAGINATION_LINK: Lazy<Selector> = Lazy::new(|| sel(".pagination a[href], nav[aria-label*=\"pagination\"] a[href]"));
static S_SECTION: Lazy<Selector> = Lazy::new(|| sel("li.section, div.section.main"));
static S_SECTION_NAME: Lazy<Selector> =
    Lazy::new(|| sel(".sectionname, h3.sectionname, h3"));
static S_ACTIVITY: Lazy<Selector> = Lazy::new(|| sel("li.activity"));
static S_ACTIVITY_ALT: Lazy<Selector> = Lazy::new(|| sel("div.activity-item, div.activity"));
static S_MOD_LINK: Lazy<Selector> = Lazy::new(|| sel("a[href*=\"/mod/\"]"));
static S_PLUGINFILE: Lazy<Selector> = Lazy::new(|| sel("a[href*=\"pluginfile.php\"]"));
static S_INSTANCENAME: Lazy<Selector> = Lazy::new(|| sel(".instancename"));
static S_ACCESSHIDE: Lazy<Selector> = Lazy::new(|| sel(".accesshide"));
static S_TIME: Lazy<Selector> = Lazy::new(|| sel("time[datetime]"));
static S_ACTIVITY_DATES: Lazy<Selector> = Lazy::new(|| sel(".activity-dates"));
static S_DISCUSSION: Lazy<Selector> = Lazy::new(|| sel("tr.discussion, .discussion"));
static S_DISCUSS_LINK: Lazy<Selector> = Lazy::new(|| sel("a[href*=\"discuss.php?d=\"]"));
static S_FILESIZE: Lazy<Selector> = Lazy::new(|| sel(".fp-filesize, .filesize"));
static S_FILEDATE: Lazy<Selector> = Lazy::new(|| sel(".fp-filedate, .filedate"));
static S_DIM: Lazy<Selector> = Lazy::new(|| sel(".dimmed, .dimmed_text, .hiddenactivity"));

fn is_course_section(el: &ElementRef<'_>) -> bool {
    let is_section = el.value().classes().any(|class| class == "section");
    let is_main = el.value().classes().any(|class| class == "main");
    is_section
        && (el.value().name() == "li"
            || (el.value().name() == "div" && is_main))
}

fn nearest_course_section<'a>(el: &ElementRef<'a>) -> Option<ElementRef<'a>> {
    el.ancestors()
        .filter_map(ElementRef::wrap)
        .find(|ancestor| is_course_section(ancestor))
}

fn section_name(section: &ElementRef<'_>) -> Option<String> {
    section
        .select(&S_SECTION_NAME)
        .find(|name| {
            nearest_course_section(name)
                .map(|owner| owner.id() == section.id())
                .unwrap_or(false)
        })
        .map(|name| text_of(&name))
        .filter(|name| !name.is_empty())
}

/// Ordered section labels from the outermost course section to this section.
fn section_path(section: &ElementRef<'_>) -> Vec<String> {
    let mut sections: Vec<_> = section
        .ancestors()
        .filter_map(ElementRef::wrap)
        .filter(is_course_section)
        .collect();
    if !sections.iter().any(|ancestor| ancestor.id() == section.id()) {
        sections.push(section.clone());
    }
    sections.iter().filter_map(section_name).collect()
}

fn belongs_to_section(el: &ElementRef<'_>, section: &ElementRef<'_>) -> bool {
    nearest_course_section(el)
        .map(|owner| owner.id() == section.id())
        .unwrap_or(false)
}

/* -------------------------------------------------------------------- helpers */

fn text_of(el: &ElementRef) -> String {
    // Normalise whitespace so comparisons are stable.
    let mut out = String::new();
    for chunk in el.text() {
        out.push_str(chunk);
        out.push(' ');
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Title of an activity, excluding Moodle's screen-reader-only type suffix.
fn activity_title(el: &ElementRef) -> Option<String> {
    if let Some(node) = el.select(&S_INSTANCENAME).next() {
        let full = text_of(&node);
        let hidden: String = node
            .select(&S_ACCESSHIDE)
            .map(|h| text_of(&h))
            .collect::<Vec<_>>()
            .join(" ");
        let cleaned = full.replace(&hidden, "");
        let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    if let Some(name) = el.value().attr("data-activityname") {
        let name = name.trim();
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    let link = el.select(&S_MOD_LINK).next()?;
    let t = text_of(&link);
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Extract the first `<time datetime>` value inside an element.
fn time_attr(el: &ElementRef) -> Option<String> {
    el.select(&S_TIME)
        .find_map(|t| t.value().attr("datetime").map(normalize_timestamp_value))
        .flatten()
}

/// Normalise an ISO-ish timestamp coming from a `<time datetime>` attribute.
fn normalize_timestamp_value(raw: &str) -> Option<String> {
    normalize_timestamp(raw)
}

/// Convert a raw timestamp string into a consistent stored representation.
///
/// * ISO-8601 with an offset  -> RFC 3339 (offset preserved).
/// * Date only               -> `YYYY-MM-DD` (no time invented).
/// * Unix seconds            -> RFC 3339 UTC.
/// * Common Moodle text      -> best effort, never inventing an offset.
pub fn normalize_timestamp(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Some(dt.to_rfc3339());
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(d.format("%Y-%m-%d").to_string());
    }
    if let Ok(secs) = raw.parse::<i64>() {
        if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
            return Some(dt.to_rfc3339());
        }
    }
    for fmt in [
        "%d %B %Y, %I:%M %p",
        "%d %b %Y, %I:%M %p",
        "%d %B %Y, %H:%M",
        "%d %b %Y, %H:%M",
        "%B %d, %Y, %I:%M %p",
    ] {
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(raw, fmt) {
            // No offset information: keep the wall-clock value without inventing UTC.
            return Some(ndt.format("%Y-%m-%dT%H:%M").to_string());
        }
    }
    for fmt in ["%d %B %Y", "%d %b %Y", "%B %d, %Y", "%d/%m/%Y", "%Y-%m-%dT%H:%M"] {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(raw, fmt) {
            return Some(d.format("%Y-%m-%d").to_string());
        }
    }
    None
}

fn is_dimmed(el: &ElementRef) -> bool {
    el.select(&S_DIM).next().is_some()
        || el.value().classes().any(|c| c == "dimmed" || c == "hiddenactivity")
}

fn parse_size(text: &str) -> Option<i64> {
    let compact: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let upper = compact.to_uppercase();
    let (num_part, factor) = if let Some(idx) = upper.find("GB") {
        (&compact[..idx], 1024f64 * 1024.0 * 1024.0)
    } else if let Some(idx) = upper.find("MB") {
        (&compact[..idx], 1024f64 * 1024.0)
    } else if let Some(idx) = upper.find("KB") {
        (&compact[..idx], 1024f64)
    } else if let Some(idx) = upper.find("B") {
        (&compact[..idx], 1f64)
    } else {
        return None;
    };
    let digits: String = num_part
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    let value: f64 = digits.replace(',', "").parse().ok()?;
    Some((value * factor) as i64)
}

fn basename(url: &Url) -> String {
    url.path_segments()
        .and_then(|s| s.last())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn file_type_from_name(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "pdf" => "pdf",
        "ppt" | "pptx" => "presentation",
        "doc" | "docx" | "odt" | "rtf" | "txt" | "md" => "document",
        "xls" | "xlsx" | "csv" | "ods" => "spreadsheet",
        "zip" | "rar" | "7z" | "tar" | "gz" => "archive",
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" => "image",
        "mp4" | "mov" | "mkv" | "avi" | "webm" => "video",
        "mp3" | "wav" | "m4a" | "ogg" => "audio",
        "ipynb" => "notebook",
        _ => infer_file_type(None),
    }
}

/* ------------------------------------------------------------------- courses */

/// Parse enrolled courses from the dashboard / "My courses" listing.
pub fn parse_courses(html: &str, base: &Url) -> Vec<DiscoveredCourse> {
    let doc = Html::parse_document(html);
    let mut out: Vec<DiscoveredCourse> = Vec::new();

    for link in doc.select(&S_COURSE_LINK) {
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Some(normalized) = normalize_url(href, Some(base)) else {
            continue;
        };
        let Ok(url) = Url::parse(&normalized) else {
            continue;
        };
        if !is_internal(&url) {
            continue;
        }
        let Some(id) = url
            .query_pairs()
            .find(|(k, _)| k == "id")
            .map(|(_, v)| v.into_owned())
        else {
            continue;
        };
        // Skip the front page (id=1) and non-numeric ids.
        if id == "1" || !id.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let name = {
            let t = text_of(&link);
            if t.is_empty() {
                link.value()
                    .attr("title")
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            } else {
                t
            }
        };
        if name.is_empty() || name.chars().all(|c| !c.is_alphanumeric()) {
            continue;
        }
        if out.iter().any(|c| c.external_id == id) {
            continue;
        }
        out.push(DiscoveredCourse {
            external_id: id,
            name,
            short_name: None,
            url: normalized,
        });
    }
    out
}

/// Moodle course formats and activity listings can paginate independently.
/// Return only same-origin links so a page cannot expand the crawl elsewhere.
pub fn parse_pagination_links(html: &str, base: &Url) -> Vec<Url> {
    let doc = Html::parse_document(html);
    let mut urls = std::collections::BTreeSet::new();
    for link in doc.select(&S_PAGINATION_LINK) {
        let Some(href) = link.value().attr("href") else { continue };
        let Some(normalized) = normalize_url(href, Some(base)) else { continue };
        let Ok(url) = Url::parse(&normalized) else { continue };
        if url.origin() == base.origin() && url.path().starts_with("/course/") {
            urls.insert(url);
        }
    }
    urls.into_iter().collect()
}

/* ------------------------------------------------------------- course page */

/// Parse resources (activities and inline files) from a course page.
pub fn parse_course_page(
    html: &str,
    course_external_id: &str,
    base: &Url,
) -> Vec<DiscoveredResource> {
    let doc = Html::parse_document(html);
    let mut out: Vec<DiscoveredResource> = Vec::new();

    let sections: Vec<ElementRef> = doc.select(&S_SECTION).collect();

    // Prefer the primary activity selector, fall back to the alternate markup.
    let activity_sel: &Selector = if doc.select(&S_ACTIVITY).next().is_some() {
        &S_ACTIVITY
    } else {
        &S_ACTIVITY_ALT
    };

    if sections.is_empty() {
        collect_activities(
            doc.select(activity_sel).collect(),
            course_external_id,
            base,
            &[],
            &mut out,
        );
        collect_inline_files(
            doc.select(&S_PLUGINFILE).collect(),
            course_external_id,
            base,
            &[],
            &mut out,
        );
    } else {
        for section in sections {
            let path = section_path(&section);
            let activities = section
                .select(activity_sel)
                .filter(|activity| belongs_to_section(activity, &section))
                .collect();
            collect_activities(
                activities,
                course_external_id,
                base,
                &path,
                &mut out,
            );
            let inline_files = section
                .select(&S_PLUGINFILE)
                .filter(|link| belongs_to_section(link, &section))
                .collect();
            collect_inline_files(
                inline_files,
                course_external_id,
                base,
                &path,
                &mut out,
            );
        }
    }

    dedupe(&mut out);
    out
}

/// How many course sections the page renders. Course formats that show one
/// section per page render exactly one; the standard "topics"/"weeks" formats
/// render every section in a single page.
pub fn section_count(html: &str) -> usize {
    Html::parse_document(html).select(&S_SECTION).count()
}

/// Links to the other section pages of the same course, for course formats that
/// display a single section per page (e.g. `/course/view.php?id=10&section=3`).
pub fn parse_section_links(html: &str, base: &Url, course_external_id: &str) -> Vec<String> {
    let doc = Html::parse_document(html);
    let mut out: Vec<String> = Vec::new();

    for link in doc.select(&S_COURSE_LINK) {
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Some(normalized) = normalize_url(href, Some(base)) else {
            continue;
        };
        let Ok(url) = Url::parse(&normalized) else {
            continue;
        };
        if !is_internal(&url) {
            continue;
        }
        let q = query_map(&url);
        if q.get("id").map(String::as_str) != Some(course_external_id) {
            continue;
        }
        if !q.contains_key("section") {
            continue;
        }
        if !out.contains(&normalized) {
            out.push(normalized);
        }
    }

    out
}

/// Organizational links embedded in course content pages. Restrict traversal
/// to Moodle page/book/folder modules and same-course section pages so ordinary
/// navigation, downloads, and external links are not mistaken for folders.
pub fn parse_nested_page_links(
    html: &str,
    base: &Url,
    course_external_id: &str,
) -> Vec<(String, Url, Vec<String>)> {
    let doc = Html::parse_document(html);
    let mut found = std::collections::BTreeMap::<String, (String, Url, Vec<String>)>::new();
    for link in doc.select(&sel(
        "#region-main a[href], .page-content a[href], .no-overflow a[href]",
    )) {
        let Some(href) = link.value().attr("href") else { continue };
        let Some(normalized) = normalize_url(href, Some(base)) else { continue };
        let Ok(url) = Url::parse(&normalized) else { continue };
        if !is_internal(&url) {
            continue;
        }
        let path = url.path();
        // Folders are handled by the normal material-detail pass. Enqueuing
        // them here as pages as well creates a second, competing path for the
        // same child files and can attach one folder beneath another.
        let module_page = ["/mod/page/view.php", "/mod/book/view.php"]
            .iter()
            .any(|suffix| path == *suffix);
        let course_section = if path == "/course/view.php" {
            let query = query_map(&url);
            query.get("id").map(String::as_str) == Some(course_external_id)
                && query.contains_key("section")
        } else {
            false
        };
        if !module_page && !course_section {
            continue;
        }
        let title = text_of(&link);
        if title.is_empty() || normalized == base.as_str() {
            continue;
        }
        let section_path = nearest_course_section(&link)
            .map(|section| section_path(&section))
            .unwrap_or_default();
        found.entry(normalized).or_insert((title, url, section_path));
    }
    found.into_values().collect()
}

fn collect_activities(
    activities: Vec<ElementRef>,
    course_external_id: &str,
    base: &Url,
    section_path: &[String],
    out: &mut Vec<DiscoveredResource>,
) {
    if activities.is_empty() {
        return;
    }

    for activity in activities {
        let Some(link) = activity.select(&S_MOD_LINK).next() else {
            continue;
        };
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Some(normalized) = normalize_url(href, Some(base)) else {
            continue;
        };
        let Ok(url) = Url::parse(&normalized) else {
            continue;
        };
        // A module link that resolves to an external host is an external tool.
        let external = !is_internal(&url);
        let module_type = module_type_from_path(&url).unwrap_or_else(|| "resource".to_string());
        let title = activity_title(&activity).unwrap_or_else(|| basename(&url));
        if title.is_empty() {
            continue;
        }

        let (published_at, modified_at, due_at) = parse_activity_dates(&activity);
        let available = !is_dimmed(&activity);

        out.push(DiscoveredResource {
            external_id: stable_resource_id(&url),
            course_external_id: course_external_id.to_string(),
            title,
            url: normalized,
            source_page_url: None,
            resource_type: friendly_resource_type(&module_type, None),
            uploaded_at: None,
            published_at,
            modified_at,
            due_at,
            size_bytes: None,
            section: section_path.last().cloned(),
            section_path: section_path.to_vec(),
            is_external: external,
            available,
        });
    }
}

/// Parse the "Opens / Due / Closes" block next to an activity.
fn parse_activity_dates(activity: &ElementRef) -> (Option<String>, Option<String>, Option<String>) {
    let mut published = None;
    let mut modified = None;
    let mut due = None;

    if let Some(dates) = activity.select(&S_ACTIVITY_DATES).next() {
        for child in dates.children().filter_map(ElementRef::wrap) {
            let label = text_of(&child).to_ascii_lowercase();
            let value = time_attr(&child);
            if value.is_none() {
                continue;
            }
            let value = value.unwrap();
            if label.contains("due") || label.contains("closes") || label.contains("close") {
                due = Some(value);
            } else if label.contains("open") || label.contains("from") || label.contains("published") {
                published = published.or(Some(value));
            } else {
                modified = modified.or(Some(value));
            }
        }
    }

    // Fallback: a lone <time> in the activity is treated as a publication time.
    if published.is_none() && due.is_none() {
        published = time_attr(activity);
    }
    (published, modified, due)
}

/// Parse the schedule shown on an activity page (assignment, quiz, …).
///
/// Moodle renders these dates in a handful of shapes depending on theme and
/// version: a labelled table row, a `.activity-dates` block, or a "Dates"
/// definition list. This walks all of them and classifies each date by its
/// adjacent label. It never guesses a date that is not present.
pub fn parse_activity_page(html: &str) -> (Option<String>, Option<String>, Option<String>) {
    let doc = Html::parse_document(html);
    let mut published = None;
    let mut modified = None;
    let mut due = None;

    // Labelled table rows: <tr><th>Due date</th><td><time …></td></tr>
    for row in doc.select(&sel("tr")) {
        let Some(value) = time_attr(&row) else {
            continue;
        };
        let label = text_of(&row).to_ascii_lowercase();
        classify_date(&label, value, &mut published, &mut modified, &mut due);
    }

    // Labelled blocks used by the boost/classic themes.
    for block in doc.select(&sel(
        ".activity-dates, [data-region=\"activity-dates\"], [data-region=\"activity-dates-inner\"], .activity-dates-inner",
    )) {
        for child in block.children().filter_map(ElementRef::wrap) {
            let Some(value) = time_attr(&child) else {
                continue;
            };
            let label = text_of(&child).to_ascii_lowercase();
            classify_date(&label, value, &mut published, &mut modified, &mut due);
        }
    }

    (published, modified, due)
}

fn classify_date(
    label: &str,
    value: String,
    published: &mut Option<String>,
    modified: &mut Option<String>,
    due: &mut Option<String>,
) {
    if label.contains("due")
        || label.contains("closes")
        || label.contains("close")
        || label.contains("deadline")
        || label.contains("cut-off")
        || label.contains("cutoff")
    {
        if due.is_none() {
            *due = Some(value);
        }
    } else if label.contains("last modified")
        || label.contains("last updated")
        || label.contains("modified")
        || label.contains("updated")
    {
        if modified.is_none() {
            *modified = Some(value);
        }
    } else if label.contains("open")
        || label.contains("from")
        || label.contains("published")
        || label.contains("expected")
        || label.contains("available")
    {
        if published.is_none() {
            *published = Some(value);
        }
    }
}

fn collect_inline_files(
    links: Vec<ElementRef>,
    course_external_id: &str,
    base: &Url,
    section_path: &[String],
    out: &mut Vec<DiscoveredResource>,
) {
    for link in links {
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Some(normalized) = normalize_url(href, Some(base)) else {
            continue;
        };
        let Ok(url) = Url::parse(&normalized) else {
            continue;
        };
        let name = {
            let t = text_of(&link);
            if t.is_empty() {
                basename(&url)
            } else {
                t
            }
        };
        if name.is_empty() {
            continue;
        }
        out.push(DiscoveredResource {
            external_id: stable_resource_id(&url),
            course_external_id: course_external_id.to_string(),
            title: name.clone(),
            url: normalized,
            source_page_url: None,
            resource_type: file_type_from_name(&name).to_string(),
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            size_bytes: None,
            section: section_path.last().cloned(),
            section_path: section_path.to_vec(),
            is_external: false,
            available: true,
        });
    }
}

/* ------------------------------------------------------------ forum page */

/// Parse forum discussions. The discussion creation time is the publication
/// timestamp shown to students, which is exactly the "upload" date we want.
pub fn parse_forum_page(
    html: &str,
    course_external_id: &str,
    base: &Url,
    section: Option<&str>,
) -> Vec<DiscoveredResource> {
    let doc = Html::parse_document(html);
    let mut out = Vec::new();

    for discussion in doc.select(&S_DISCUSSION) {
        let Some(link) = discussion.select(&S_DISCUSS_LINK).next() else {
            continue;
        };
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Some(normalized) = normalize_url(href, Some(base)) else {
            continue;
        };
        let Ok(url) = Url::parse(&normalized) else {
            continue;
        };
        let title = {
            let t = text_of(&link);
            if t.is_empty() {
                "Announcement".to_string()
            } else {
                t
            }
        };
        let published = time_attr(&discussion).or_else(|| time_attr(&link));
        out.push(DiscoveredResource {
            external_id: stable_resource_id(&url),
            course_external_id: course_external_id.to_string(),
            title,
            url: normalized,
            source_page_url: None,
            resource_type: "announcement".to_string(),
            uploaded_at: None,
            published_at: published,
            modified_at: None,
            due_at: None,
            size_bytes: None,
            section: section.map(|s| s.to_string()),
            section_path: section.map(|s| vec![s.to_string()]).unwrap_or_default(),
            is_external: false,
            available: true,
        });
    }

    dedupe(&mut out);
    out
}

/* -------------------------------------------------------- resource / folder */

/// Parse files exposed on a resource or folder page, together with any dates.
pub fn parse_file_page(
    html: &str,
    course_external_id: &str,
    base: &Url,
    section: Option<&str>,
) -> Vec<DiscoveredResource> {
    let doc = Html::parse_document(html);
    let mut out = Vec::new();

    for link in doc.select(&S_PLUGINFILE) {
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Some(normalized) = normalize_url(href, Some(base)) else {
            continue;
        };
        let Ok(url) = Url::parse(&normalized) else {
            continue;
        };
        let name = {
            let t = text_of(&link);
            if t.is_empty() {
                basename(&url)
            } else {
                t
            }
        };

        // Dates/sizes often live in a sibling or a wrapping row.
        let container = link
            .ancestors()
            .filter_map(ElementRef::wrap)
            .find(|a| {
                a.value().classes().any(|c| c == "file" || c == "fp-file" || c == "fileuploadsubmittedfile")
                    || a.select(&S_FILESIZE).next().is_some()
                    || a.select(&S_FILEDATE).next().is_some()
            });

        let (size, modified) = match &container {
            Some(c) => {
                let size = c.select(&S_FILESIZE).next().and_then(|e| parse_size(&text_of(&e)));
                let modified = c
                    .select(&S_FILEDATE)
                    .next()
                    .and_then(|e| normalize_timestamp(&text_of(&e)))
                    .or_else(|| time_attr(c));
                (size, modified)
            }
            None => (None, time_attr(&link)),
        };

        out.push(DiscoveredResource {
            external_id: stable_resource_id(&url),
            course_external_id: course_external_id.to_string(),
            title: name.clone(),
            url: normalized,
            source_page_url: None,
            resource_type: file_type_from_name(&name).to_string(),
            uploaded_at: None,
            published_at: None,
            modified_at: modified,
            due_at: None,
            size_bytes: size,
            section: section.map(|s| s.to_string()),
            section_path: section.map(|s| vec![s.to_string()]).unwrap_or_default(),
            is_external: false,
            available: true,
        });
    }

    dedupe(&mut out);
    out
}

/* ------------------------------------------------------------------- misc */

/// Generic "recent activity" parsing, used for the course updates page.
pub fn parse_recent_activity(
    html: &str,
    course_external_id: &str,
    base: &Url,
) -> Vec<DiscoveredResource> {
    let doc = Html::parse_document(html);
    let mut out = Vec::new();

    for activity in doc.select(&sel("div.activity, li.activity")) {
        let Some(link) = activity.select(&S_MOD_LINK).next() else {
            continue;
        };
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Some(normalized) = normalize_url(href, Some(base)) else {
            continue;
        };
        let Ok(url) = Url::parse(&normalized) else {
            continue;
        };
        let module_type = module_type_from_path(&url).unwrap_or_else(|| "resource".to_string());
        let title = activity_title(&activity).unwrap_or_else(|| basename(&url));
        let published = time_attr(&activity);
        out.push(DiscoveredResource {
            external_id: stable_resource_id(&url),
            course_external_id: course_external_id.to_string(),
            title,
            url: normalized,
            source_page_url: None,
            resource_type: friendly_resource_type(&module_type, None),
            uploaded_at: None,
            published_at: published.clone(),
            modified_at: published,
            due_at: None,
            size_bytes: None,
            section: None,
            section_path: Vec::new(),
            is_external: false,
            available: !is_dimmed(&activity),
        });
    }

    dedupe(&mut out);
    out
}

/* ---------------------------------------------------------- readable text */

/// Tags whose whole subtree is presentation/behaviour, never article content.
static S_READABLE_SKIP: Lazy<Selector> = Lazy::new(|| {
    sel("script, style, noscript, template, svg, head, nav, header, footer, aside, form, button, select, option, textarea")
});

/// Block-level tags that each become one paragraph/line of readable text.
static S_READABLE_BLOCK: Lazy<Selector> = Lazy::new(|| {
    sel("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, dt, td, th, figcaption, caption, summary")
});

fn is_block(el: &ElementRef) -> bool {
    el.select(&S_READABLE_BLOCK)
        .any(|d| d.id() == el.id())
}

fn has_block_descendant(el: &ElementRef) -> bool {
    el.select(&S_READABLE_BLOCK).any(|d| d.id() != el.id())
}

pub(crate) fn select_content_root(doc: &Html) -> Option<ElementRef<'_>> {
    for css in [
        "#region-main",
        ".course-content",
        "main",
        "article",
        ".box.generalbox",
        "#content",
        ".content",
    ] {
        if let Some(el) = doc.select(&sel(css)).next() {
            if !text_of(&el).is_empty() {
                return Some(el);
            }
        }
    }
    None
}

fn collect_readable_blocks(el: ElementRef<'_>, out: &mut Vec<String>) {
    for child in el.children().filter_map(ElementRef::wrap) {
        if child.select(&S_READABLE_SKIP).any(|d| d.id() == child.id()) {
            continue;
        }
        // A block element, or a leaf container with only text, is one line.
        // A structural wrapper (one that contains blocks) is recursed into so
        // nested paragraphs are not collapsed or duplicated.
        if is_block(&child) || !has_block_descendant(&child) {
            let text = text_of(&child);
            if !text.is_empty() {
                out.push(text);
            }
        } else {
            collect_readable_blocks(child, out);
        }
    }
}

/// Reduce an authenticated Moodle HTML page to plain, readable text.
///
/// Prefers the page's main content region, then falls back to the whole
/// document. Returns an empty string when there is nothing readable, never
/// invented placeholder text.
pub fn extract_readable_text(html: &str) -> String {
    let doc = Html::parse_document(html);
    let root = select_content_root(&doc).unwrap_or_else(|| doc.root_element());
    let mut blocks: Vec<String> = Vec::new();
    collect_readable_blocks(root, &mut blocks);
    if blocks.is_empty() {
        let text = text_of(&root);
        if !text.is_empty() {
            blocks.push(text);
        }
    }
    blocks.join("\n")
}

/// Does this HTML look like Moodle's login page (i.e. the session expired)?
pub fn looks_like_login_page(html: &str) -> bool {
    let doc = Html::parse_document(html);
    if doc.select(&sel("form#login")).next().is_some() {
        return true;
    }
    if doc
        .select(&sel("body.path-login, #page-login-index"))
        .next()
        .is_some()
    {
        return true;
    }
    false
}

/// Extract the current user's display name and sesskey from an authenticated page.
pub fn parse_session_facts(html: &str) -> (Option<i64>, Option<String>, Option<String>) {
    let user_id = parse_cfg_number(html, "userId");
    let sesskey = parse_cfg_string(html, "sesskey");
    let fullname = parse_user_fullname(html);
    (user_id, sesskey, fullname)
}

fn parse_cfg_number(html: &str, key: &str) -> Option<i64> {
    let needle = format!("\"{key}\":");
    let idx = html.find(&needle)? + needle.len();
    let rest = html[idx..].trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || digits == "0" {
        return None;
    }
    digits.parse().ok()
}

fn parse_cfg_string(html: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\":\"");
    let idx = html.find(&needle)? + needle.len();
    let rest = &html[idx..];
    let end = rest.find('"')?;
    let value = &rest[..end];
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn parse_user_fullname(html: &str) -> Option<String> {
    let doc = Html::parse_document(html);
    let el = doc.select(&sel(".usertext, .userfullname, [data-region=\"user-name\"]")).next()?;
    let t = text_of(&el);
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Extract the Moodle login CSRF token from the login form.
pub fn parse_login_token(html: &str) -> Option<String> {
    let doc = Html::parse_document(html);
    let input = doc
        .select(&sel("form#login input[name=\"logintoken\"]"))
        .next()?;
    input.value().attr("value").map(|s| s.to_string())
}

/* ------------------------------------------------------------------ dedupe */

fn dedupe(items: &mut Vec<DiscoveredResource>) {
    let mut seen = std::collections::HashSet::new();
    items.retain(|r| seen.insert(r.external_id.clone()));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://quanta.bits-pilani.ac.in/course/view.php?id=10").unwrap()
    }

    const COURSE_HTML: &str = r#"
    <div class="course-content">
      <ul class="topics">
        <li class="section main" id="section-1">
          <h3 class="sectionname">Week 1</h3>
          <ul class="section">
            <li class="activity resource modtype_resource" id="module-101">
              <div class="activity-item" data-activityname="Lecture 01">
                <div class="activityinstance">
                  <a class="aalink" href="/mod/resource/view.php?id=101&amp;sesskey=abc">
                    <span class="instancename">Lecture 01<span class="accesshide "> File</span></span>
                  </a>
                </div>
                <div class="activity-dates">
                  <div>Published: <time datetime="2026-10-11T14:35:00+05:30">11 Oct</time></div>
                </div>
              </div>
            </li>
            <li class="activity assign modtype_assign" id="module-102">
              <div class="activity-item">
                <div class="activityinstance">
                  <a href="/mod/assign/view.php?id=102"><span class="instancename">Assignment 1</span></a>
                </div>
                <div class="activity-dates">
                  <div>Due: <time datetime="2026-10-20T23:59:00+05:30">20 Oct</time></div>
                </div>
              </div>
            </li>
            <li class="activity forum modtype_forum" id="module-103">
              <div class="activity-item">
                <div class="activityinstance">
                  <a href="/mod/forum/view.php?id=103"><span class="instancename">Announcements<span class="accesshide"> Forum</span></span></a>
                </div>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </div>"#;

    #[test]
    fn parses_course_activities() {
        let found = parse_course_page(COURSE_HTML, "10", &base());
        assert_eq!(found.len(), 3);
        let lecture = found.iter().find(|r| r.external_id == "mod:resource:101").unwrap();
        assert_eq!(lecture.title, "Lecture 01");
        assert_eq!(lecture.section.as_deref(), Some("Week 1"));
        assert_eq!(lecture.published_at.as_deref(), Some("2026-10-11T14:35:00+05:30"));
        assert_eq!(lecture.url, "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=101");

        let assign = found.iter().find(|r| r.external_id == "mod:assign:102").unwrap();
        assert_eq!(assign.due_at.as_deref(), Some("2026-10-20T23:59:00+05:30"));
        assert_eq!(assign.resource_type, "assignment");

        let forum = found.iter().find(|r| r.external_id == "mod:forum:103").unwrap();
        assert_eq!(forum.title, "Announcements");
        assert_eq!(forum.resource_type, "announcement");
    }

    #[test]
    fn preserves_sibling_sections_and_nested_section_ancestry() {
        let html = r#"
          <ul class="topics">
            <li class="section main" id="section-2">
              <h3 class="sectionname">Worksheets</h3>
              <ul class="section">
                <li class="activity modtype_folder">
                  <div class="activity-item" data-activityname="Worksheets">
                    <a href="/mod/folder/view.php?id=1879"><span class="instancename">Worksheets<span class="accesshide"> Folder</span></span></a>
                  </div>
                </li>
              </ul>
            </li>
            <li class="section main" id="section-3">
              <h3 class="sectionname">Section-1</h3>
              <ul class="section">
                <li class="activity modtype_folder">
                  <div class="activity-item" data-activityname="Section-1 Slides">
                    <a href="/mod/folder/view.php?id=1396"><span class="instancename">Section-1 Slides<span class="accesshide"> Folder</span></span></a>
                  </div>
                </li>
              </ul>
            </li>
            <li class="section main" id="section-6">
              <h3 class="sectionname">Section-4: Consultation Hour</h3>
              <ul class="section">
                <li class="activity modtype_folder">
                  <div class="activity-item" data-activityname="Section-4 Slides">
                    <a href="/mod/folder/view.php?id=1420"><span class="instancename">Section-4 Slides<span class="accesshide"> Folder</span></span></a>
                  </div>
                </li>
              </ul>
              <div class="section main delegated-section" id="section-10">
                <h3 class="sectionname">Lecture Attendance</h3>
                <ul class="section">
                  <li class="activity modtype_attendance">
                    <div class="activity-item"><a href="/mod/attendance/view.php?id=1479"><span class="instancename">S-1 Attendance</span></a></div>
                  </li>
                </ul>
              </div>
            </li>
          </ul>"#;

        let found = parse_course_page(html, "1117", &base());
        assert_eq!(found.len(), 4);
        let worksheets = found.iter().find(|r| r.external_id == "mod:folder:1879").unwrap();
        let section_one = found.iter().find(|r| r.external_id == "mod:folder:1396").unwrap();
        let section_four = found.iter().find(|r| r.external_id == "mod:folder:1420").unwrap();
        let attendance = found.iter().find(|r| r.external_id == "mod:attendance:1479").unwrap();

        assert_eq!(worksheets.section_path, vec!["Worksheets"]);
        assert_eq!(section_one.section_path, vec!["Section-1"]);
        assert_eq!(section_four.section_path, vec!["Section-4: Consultation Hour"]);
        assert_eq!(attendance.section_path, vec!["Section-4: Consultation Hour", "Lecture Attendance"]);
    }

    #[test]
    fn parses_enrolled_courses() {
        let html = r#"
        <div class="course-overview">
          <a href="/course/view.php?id=10">CS F222 Operating Systems</a>
          <a href="/course/view.php?id=11">CS F213 Data Structures</a>
          <a href="/course/view.php?id=11">CS F213 Data Structures (dup)</a>
          <a href="https://quanta.bits-pilani.ac.in/course/view.php?id=1">Site home</a>
        </div>"#;
        let courses = parse_courses(html, &base());
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].external_id, "10");
        assert_eq!(courses[0].name, "CS F222 Operating Systems");
        assert!(courses.iter().all(|c| c.external_id != "1"));
    }

    #[test]
    fn parses_forum_announcements_with_publish_time() {
        let html = r#"
        <table>
          <tr class="discussion">
            <td><a href="/mod/forum/discuss.php?d=55">Mid-semester schedule</a></td>
            <td><time datetime="2026-10-09T09:15:00+05:30">9 Oct</time></td>
          </tr>
        </table>"#;
        let items = parse_forum_page(html, "10", &base(), None);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].resource_type, "announcement");
        assert_eq!(items[0].published_at.as_deref(), Some("2026-10-09T09:15:00+05:30"));
    }

    #[test]
    fn parses_file_page_sizes_and_dates() {
        let html = r#"
        <div class="file">
          <a href="/pluginfile.php/999/mod_resource/content/1/lec08.pdf">lec08.pdf</a>
          <span class="fp-filesize">2.4 MB</span>
          <span class="fp-filedate">11 October 2026, 2:35 PM</span>
        </div>"#;
        let items = parse_file_page(html, "10", &base(), Some("Week 3"));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].resource_type, "pdf");
        assert_eq!(items[0].size_bytes, Some(2516582));
        assert_eq!(items[0].modified_at.as_deref(), Some("2026-10-11T14:35"));
    }

    #[test]
    fn detects_login_page() {
        let login = r#"<body class="path-login"><form id="login"></form></body>"#;
        assert!(looks_like_login_page(login));
        assert!(!looks_like_login_page(COURSE_HTML));
    }

    #[test]
    fn extracts_readable_text_from_the_main_region_only() {
        let html = r#"
        <nav><a href="/x">Skip to main content</a></nav>
        <div id="region-main">
          <div class="box generalbox">
            <h1>Assignment 1</h1>
            <div class="text_to_html">
              <p>Submit the report as a PDF.</p>
              <p>Due 20 October.</p>
            </div>
            <ul><li>Late submissions are penalised.</li></ul>
          </div>
        </div>
        <footer>Copyright BITS</footer>"#;
        let text = extract_readable_text(html);
        assert!(text.contains("Assignment 1"));
        assert!(text.contains("Submit the report as a PDF."));
        assert!(text.contains("Late submissions are penalised."));
        // Paragraphs stay separate lines rather than one blob.
        assert!(text.contains('\n'));
        // Navigation and footer chrome are not part of the content.
        assert!(!text.contains("Skip to main content"));
        assert!(!text.contains("Copyright BITS"));
    }

    #[test]
    fn readable_text_of_a_bare_page_is_its_own_text() {
        let html = r#"<html><body><div class="content"><p>Hello world</p></div></body></html>"#;
        assert_eq!(extract_readable_text(html), "Hello world");
        assert_eq!(extract_readable_text("<html><body></body></html>"), "");
    }

    #[test]
    fn parses_session_facts() {
        let html = r#"<script>M.cfg = {"sesskey":"ABC123","userId":4242,"wwwroot":"x"};</script>
        <span class="usertext">Ada Lovelace</span>"#;
        let (uid, key, name) = parse_session_facts(html);
        assert_eq!(uid, Some(4242));
        assert_eq!(key.as_deref(), Some("ABC123"));
        assert_eq!(name.as_deref(), Some("Ada Lovelace"));
    }

    #[test]
    fn parses_login_csrf_token() {
        let html = r#"<form id="login"><input type="hidden" name="logintoken" value="TOK"></form>"#;
        assert_eq!(parse_login_token(html).as_deref(), Some("TOK"));
    }

    #[test]
    fn timestamps_never_invent_a_time_of_day() {
        assert_eq!(normalize_timestamp("11 October 2026").as_deref(), Some("2026-10-11"));
        assert_eq!(normalize_timestamp("2026-10-11").as_deref(), Some("2026-10-11"));
        assert!(normalize_timestamp("not a date").is_none());
    }

    #[test]
    fn parses_assignment_page_due_date() {
        let html = r#"
        <div class="activity-dates">
          <div>Opens: <time datetime="2026-10-01T09:00:00+05:30">1 Oct</time></div>
          <div>Due: <time datetime="2026-10-20T23:59:00+05:30">20 Oct</time></div>
        </div>"#;
        let (published, _modified, due) = parse_activity_page(html);
        assert_eq!(published.as_deref(), Some("2026-10-01T09:00:00+05:30"));
        assert_eq!(due.as_deref(), Some("2026-10-20T23:59:00+05:30"));
    }

    #[test]
    fn parses_quiz_page_closes_as_due_and_table_rows() {
        let html = r#"
        <table class="table">
          <tr><th>Opens</th><td><time datetime="2026-11-01T10:00:00+05:30">1 Nov</time></td></tr>
          <tr><th>Closes</th><td><time datetime="2026-11-02T10:00:00+05:30">2 Nov</time></td></tr>
        </table>"#;
        let (published, _modified, due) = parse_activity_page(html);
        assert_eq!(published.as_deref(), Some("2026-11-01T10:00:00+05:30"));
        assert_eq!(due.as_deref(), Some("2026-11-02T10:00:00+05:30"));
    }

    #[test]
    fn activity_page_without_dates_returns_nothing() {
        let html = r#"<div class="activity"><p>No schedule here.</p></div>"#;
        assert_eq!(parse_activity_page(html), (None, None, None));
    }

    #[test]
    fn counts_sections_and_finds_section_links() {
        let base = Url::parse("https://quanta.bits-pilani.ac.in/course/view.php?id=10").unwrap();
        let html = r#"
        <li class="section main" id="section-0"><h3 class="sectionname">General</h3></li>
        <div class="section-navigation">
          <a href="/course/view.php?id=10&amp;section=1">Next section</a>
          <a href="/course/view.php?id=10&amp;section=2">Section 2</a>
          <a href="/course/view.php?id=99&amp;section=1">Other course</a>
          <a href="/course/view.php?id=10">Course home</a>
        </div>"#;
        assert_eq!(section_count(html), 1);
        let links = parse_section_links(html, &base, "10");
        assert_eq!(links.len(), 2);
        assert!(links.iter().all(|u| u.contains("id=10")));
    }

    #[test]
    fn discovers_only_nested_moodle_pages_and_keeps_their_section_context() {
        let base = Url::parse("https://quanta.bits-pilani.ac.in/course/view.php?id=10").unwrap();
        let html = r#"
          <div id="region-main">
            <li class="section main"><h3 class="sectionname">Lecture Notes</h3>
              <div class="activity"><a href="/mod/page/view.php?id=20">Recorded Lectures</a></div>
              <div class="activity"><a href="/mod/page/view.php?id=20">Recorded Lectures duplicate</a></div>
              <div class="activity"><a href="/mod/folder/view.php?id=21">Slides Folder</a></div>
              <a href="/mod/resource/view.php?id=30">A file</a>
              <a href="https://example.org/external">External link</a>
              <a href="/course/view.php?id=99&amp;section=2">Other course</a>
            </li>
          </div>"#;
        let links = parse_nested_page_links(html, &base, "10");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].0, "Recorded Lectures");
        assert_eq!(links[0].1.as_str(), "https://quanta.bits-pilani.ac.in/mod/page/view.php?id=20");
        assert_eq!(links[0].2, vec!["Lecture Notes"]);
    }

    #[test]
    fn nested_page_links_keep_all_parent_sections() {
        let base = Url::parse("https://quanta.bits-pilani.ac.in/course/view.php?id=10").unwrap();
        let html = r#"
          <div id="region-main">
            <li class="section main"><h3 class="sectionname">Section-4</h3>
              <div class="section main delegated-section"><h3 class="sectionname">Lecture Attendance</h3>
                <div class="activity"><a href="/mod/page/view.php?id=20">Attendance Notes</a></div>
              </div>
            </li>
          </div>"#;
        let links = parse_nested_page_links(html, &base, "10");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].2, vec!["Section-4", "Lecture Attendance"]);
    }

    #[test]
    fn pagination_links_are_same_origin_and_deduplicated() {
        let base = Url::parse("https://quanta.bits-pilani.ac.in/course/view.php?id=10").unwrap();
        let html = r#"<nav aria-label="pagination"><a href="/course/view.php?id=10&amp;page=1">2</a>
            <a href="/course/view.php?id=10&amp;page=1">Next</a>
            <a href="https://attacker.example/course/view.php?id=10&amp;page=2">external</a></nav>"#;
        let links = parse_pagination_links(html, &base);
        assert_eq!(links.len(), 1);
        assert!(links[0].as_str().contains("page=1"));
    }
}

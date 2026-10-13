//! Recursive discovery of courses and resources from an authenticated session.
//!
//! The crawl is bounded at every level (courses, resources per course, detail
//! fetches, concurrency) and cooperatively cancellable. Failures are recorded
//! per course so a partial scan is always reported as partial, never as
//! complete.

use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::Semaphore;
use url::Url;

use crate::quanta::client::{QuantaClient, QuantaError};
use crate::quanta::parse;
use crate::quanta::{DiscoveredCourse, DiscoveredResource};

#[derive(Debug, Clone)]
pub struct CrawlLimits {
    pub max_courses: usize,
    pub max_resources_per_course: usize,
    pub max_detail_fetches: usize,
    pub concurrency: usize,
}

impl Default for CrawlLimits {
    fn default() -> Self {
        CrawlLimits {
            max_courses: 60,
            max_resources_per_course: 400,
            max_detail_fetches: 600,
            concurrency: 4,
        }
    }
}

#[derive(Debug, Default)]
pub struct Discovery {
    pub courses: Vec<DiscoveredCourse>,
    pub resources: Vec<DiscoveredResource>,
    pub courses_scanned: usize,
    pub courses_failed: usize,
    pub errors: Vec<String>,
    pub auth_expired: bool,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
}

pub type ProgressFn = Arc<dyn Fn(Progress) + Send + Sync>;

fn noop_progress() -> ProgressFn {
    Arc::new(|_| {})
}

fn enqueue_page(
    pending: &mut Vec<(Url, Vec<String>)>,
    visited: &HashSet<String>,
    url: Url,
    path: Vec<String>,
) -> bool {
    if visited.contains(url.as_str()) || pending.iter().any(|(queued, _)| queued == &url) {
        return false;
    }
    pending.push((url, path));
    true
}

fn container_resource_path(item: &DiscoveredResource) -> Vec<String> {
    let mut path = item.section_path.clone();
    if path.is_empty() {
        if let Some(section) = item.section.as_ref() {
            path.push(section.clone());
        }
    }
    if path.last() != Some(&item.title) {
        path.push(item.title.clone());
    }
    path
}

fn append_section_context(path: &mut Vec<String>, section_path: &[String]) {
    let shared_prefix = path
        .iter()
        .zip(section_path)
        .take_while(|(existing, section)| existing == section)
        .count();
    path.extend(section_path[shared_prefix..].iter().cloned());
}

enum Detail {
    /// A forum container replaced by its discussions.
    Forum(Vec<DiscoveredResource>),
    /// A single-file material, enriched in place.
    Single(Box<DiscoveredResource>),
    /// A folder replaced by its child files.
    Multi(Vec<DiscoveredResource>, Vec<String>),
    /// Nothing usable was found; keep the container as-is.
    Keep(Box<DiscoveredResource>),
    Failed(Box<DiscoveredResource>, String, bool),
}

fn is_material(t: &str) -> bool {
    matches!(
        t,
        "pdf"
            | "presentation"
            | "document"
            | "spreadsheet"
            | "archive"
            | "image"
            | "video"
            | "audio"
            | "notebook"
            | "file"
            | "folder"
            | "page"
            | "book"
    )
}

/// Discover everything visible to the authenticated account.
pub async fn discover_all(
    client: Arc<QuantaClient>,
    limits: CrawlLimits,
    cancel: Arc<AtomicBool>,
    progress: ProgressFn,
) -> Discovery {
    let mut result = Discovery::default();
    let origin = client.origin().clone();

    // ---- Phase 1: course list -------------------------------------------
    progress(Progress {
        phase: "Listing courses".into(),
        done: 0,
        total: 0,
    });

    let mut courses = match fetch_courses(&client, &origin).await {
        Ok(c) => c,
        Err(e) => {
            if matches!(e, QuantaError::AuthExpired) {
                result.auth_expired = true;
            }
            result.errors.push(format!("course list: {e}"));
            return result;
        }
    };
    if courses.len() > limits.max_courses {
        result.errors.push(format!(
            "course limit reached: scanned {} of {} courses",
            limits.max_courses,
            courses.len()
        ));
        courses.truncate(limits.max_courses);
    }
    result.courses = courses.clone();

    // ---- Phase 2: course pages ------------------------------------------
    let sem = Arc::new(Semaphore::new(limits.concurrency.max(1)));
    let mut set = tokio::task::JoinSet::new();
    let total_courses = courses.len();

    for course in courses.into_iter() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let client = client.clone();
        let sem = sem.clone();
        let origin = origin.clone();
        let max_res = limits.max_resources_per_course;
        set.spawn(async move {
            let _permit = sem.acquire().await;
            let url = match Url::parse(&course.url) {
                Ok(u) => u,
                Err(e) => return Err((course.external_id, format!("bad course url: {e}"))),
            };
            let mut pending = vec![(url, Vec::<String>::new())];
            let mut visited = HashSet::new();
            let mut found = BTreeMap::new();
            let mut page_errors = Vec::new();
            while let Some((page_url, parent_path)) = pending.pop() {
                if !visited.insert(page_url.to_string()) { continue; }
                if visited.len() > 100 || found.len() >= max_res {
                    break;
                }
                let fetched = match client.fetch(&page_url).await {
                    Ok(fetched) => fetched,
                    Err(e) if matches!(e, QuantaError::AuthExpired) => {
                        return Err((course.external_id, format!("{}: {e}", page_url.path())));
                    }
                    Err(e) => {
                        page_errors.push(format!("{}: {e}", page_url.path()));
                        continue;
                    }
                };
                let mut page_resources = parse::parse_course_page(&fetched.body, &course.external_id, &origin);
                // Moodle pages/books can contain more organizational pages.
                // Folder modules are expanded once in the detail pass below,
                // so their files cannot be discovered with competing paths.
                for (title, next, sections) in parse::parse_nested_page_links(
                    &fetched.body,
                    &page_url,
                    &course.external_id,
                ) {
                    let mut path = parent_path.clone();
                    // Course section links are alternate entry points into the
                    // same course tree, not child folders named by their link
                    // text. Their own section markup supplies the labels.
                    if next.path() != "/course/view.php" {
                        append_section_context(&mut path, &sections);
                        path.push(title);
                    }
                    enqueue_page(&mut pending, &visited, next, path);
                }
                // Pages can link directly to files without a file activity
                // wrapper. These links are resources, while page/book links
                // above are organizational nodes.
                page_resources.extend(parse::parse_file_page(
                    &fetched.body,
                    &course.external_id,
                    &page_url,
                    parent_path.last().map(String::as_str),
                ));
                for mut resource in page_resources {
                    let mut path = parent_path.clone();
                    if !resource.section_path.is_empty() {
                        append_section_context(&mut path, &resource.section_path);
                    } else if let Some(section) = resource.section.as_deref() {
                        if path.last().map(String::as_str) != Some(section) {
                            path.push(section.to_string());
                        }
                    }
                    // A page is represented by the path node and its children,
                    // not as a leaf file in the resource inventory.
                    if resource.resource_type == "page" || resource.resource_type == "book" {
                        continue;
                    }
                    resource.section_path = path;
                    // The page the anchor was parsed on is the listing page for
                    // this resource: the course page, a paginated section page
                    // or an expanded section page. Never an assumed homepage.
                    if resource.source_page_url.is_none() {
                        resource.source_page_url = Some(page_url.to_string());
                    }
                    found.entry(resource.external_id.clone()).or_insert(resource);
                    if found.len() >= max_res { break; }
                }
                for next in parse::parse_pagination_links(&fetched.body, &page_url) {
                    enqueue_page(&mut pending, &visited, next, parent_path.clone());
                }
                for next in parse::parse_section_links(&fetched.body, &page_url, &course.external_id) {
                    if let Ok(next) = Url::parse(&next) {
                        enqueue_page(&mut pending, &visited, next, parent_path.clone());
                    }
                }
            }
            if !pending.is_empty() && (visited.len() >= 100 || found.len() >= max_res) {
                page_errors.push("course traversal limit reached; some nested pages were not scanned".into());
            }
            Ok((course.external_id, found.into_values().collect(), page_errors))
        });
    }

    let mut discovered: Vec<DiscoveredResource> = Vec::new();
    let mut done = 0usize;
    while let Some(joined) = set.join_next().await {
        done += 1;
        progress(Progress {
            phase: "Scanning courses".into(),
            done,
            total: total_courses,
        });
        match joined {
            Ok(Ok((id, mut resources, errors))) => {
                result.courses_scanned += 1;
                if !errors.is_empty() {
                    result.courses_failed += 1;
                    result.errors.extend(errors.into_iter().map(|error| format!("course {id} page: {error}")));
                }
                discovered.append(&mut resources);
            }
            Ok(Err((id, err))) => {
                result.courses_failed += 1;
                result.errors.push(format!("course {id}: {err}"));
            }
            Err(join_err) => {
                result.courses_failed += 1;
                result.errors.push(format!("task failed: {join_err}"));
            }
        }
    }

    if cancel.load(Ordering::Relaxed) {
        result.cancelled = true;
    }

    // ---- Phase 3: details (announcements, files, folders) ---------------
    let (detail_targets, keep): (Vec<_>, Vec<_>) = discovered
        .into_iter()
        .partition(|r| r.resource_type == "announcement" || is_material(&r.resource_type));

    let mut keep = keep;
    let mut replaced: HashSet<String> = HashSet::new();
    let mut extras: Vec<DiscoveredResource> = Vec::new();

    let mut targets = detail_targets;
    if targets.len() > limits.max_detail_fetches {
        result.errors.push(format!(
            "detail limit reached: inspected {} of {} material pages",
            limits.max_detail_fetches,
            targets.len()
        ));
        targets.truncate(limits.max_detail_fetches);
    }

    if !targets.is_empty() {
        let detail_total = targets.len();
        progress(Progress {
            phase: "Reading materials".into(),
            done: 0,
            total: detail_total,
        });

        let mut detail_set = tokio::task::JoinSet::new();
        for item in targets.into_iter() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let client = client.clone();
            let sem = sem.clone();
            let origin = origin.clone();
            let id = item.external_id.clone();
            detail_set.spawn(async move {
                let _permit = sem.acquire().await;
                let url = match Url::parse(&item.url) {
                    Ok(u) => u,
                    Err(_) => return (id, Detail::Keep(Box::new(item))),
                };
                match client.fetch(&url).await {
                    Ok(f) => {
                        let detail = if item.resource_type == "announcement" {
                            let mut discussions = parse::parse_forum_page(
                                &f.body,
                                &item.course_external_id,
                                &origin,
                                item.section.as_deref(),
                            );
                            // Discussions are listed on the forum page itself.
                            for d in &mut discussions {
                                if d.source_page_url.is_none() {
                                    d.source_page_url = Some(url.to_string());
                                }
                            }
                            if discussions.is_empty() {
                                Detail::Keep(Box::new(item))
                            } else {
                                Detail::Forum(discussions)
                            }
                        } else {
                            let mut files = parse::parse_file_page(
                                &f.body,
                                &item.course_external_id,
                                &origin,
                                item.section.as_deref(),
                            );
                            // Files inside a folder are listed on the folder
                            // page, so that page is their source. A single file
                            // below keeps the listing page captured on the
                            // course/section page instead (the folder pattern).
                            for file in &mut files {
                                if file.source_page_url.is_none() {
                                    file.source_page_url = Some(url.to_string());
                                }
                            }
                            match files.len() {
                                0 => {
                                    // Page/book without files: keep, but adopt any date.
                                    let mut kept = item;
                                    if kept.modified_at.is_none() {
                                        kept.modified_at = parse::parse_recent_activity(
                                            &f.body,
                                            &kept.course_external_id,
                                            &origin,
                                        )
                                        .into_iter()
                                        .find_map(|r| r.modified_at);
                                    }
                                    Detail::Keep(Box::new(kept))
                                }
                                1 => {
                                    let file = files.into_iter().next().unwrap();
                                    let mut enriched = item;
                                    enriched.size_bytes = file.size_bytes.or(enriched.size_bytes);
                                    enriched.modified_at =
                                        file.modified_at.or(enriched.modified_at);
                                    enriched.url = file.url;
                                    enriched.resource_type = file.resource_type;
                                    enriched.available = file.available;
                                    Detail::Single(Box::new(enriched))
                                }
                                _ => {
                                    let path = container_resource_path(&item);
                                    Detail::Multi(files, path)
                                }
                            }
                        };
                        (id, detail)
                    }
                    Err(e) => (id, Detail::Failed(Box::new(item), e.to_string(), matches!(e, QuantaError::AuthExpired))),
                }
            });
        }

        let mut detail_done = 0usize;
        while let Some(joined) = detail_set.join_next().await {
            detail_done += 1;
            progress(Progress {
                phase: "Reading materials".into(),
                done: detail_done,
                total: detail_total,
            });
            if let Ok((id, detail)) = joined {
                match detail {
                    Detail::Keep(r) | Detail::Single(r) => keep.push(*r),
                    Detail::Failed(r, error, auth_expired) => {
                        if auth_expired { result.auth_expired = true; }
                        result.errors.push(format!("resource {id}: {error}"));
                        keep.push(*r);
                    }
                    Detail::Forum(items) => {
                        replaced.insert(id);
                        extras.extend(items);
                    }
                    Detail::Multi(mut items, path) => {
                        replaced.insert(id);
                        for resource in &mut items {
                            resource.section_path = path.clone();
                        }
                        extras.extend(items);
                    }
                }
            }
        }
    }

    // Containers that were replaced (forums, folders) must not survive.
    keep.retain(|r| !replaced.contains(&r.external_id));

    // ---- Merge & dedupe --------------------------------------------------
    let mut by_id: BTreeMap<String, DiscoveredResource> = BTreeMap::new();
    for r in keep.into_iter().chain(extras.into_iter()) {
        by_id.entry(r.external_id.clone()).or_insert(r);
    }
    result.resources = by_id.into_values().collect();

    result
}

async fn fetch_courses(
    client: &QuantaClient,
    origin: &Url,
) -> Result<Vec<DiscoveredCourse>, QuantaError> {
    let dashboard = origin.join("/my/").map_err(|e| QuantaError::Client(e.to_string()))?;
    let page = client.fetch(&dashboard).await?;
    let mut courses = parse::parse_courses(&page.body, origin);

    if courses.is_empty() {
        // Some themes only list courses on the dedicated "My courses" page.
        if let Ok(url) = origin.join("/my/courses.php") {
            if let Ok(page) = client.fetch(&url).await {
                courses = parse::parse_courses(&page.body, origin);
            }
        }
    }
    Ok(courses)
}

/// Convenience wrapper used by tests and the engine.
pub async fn discover(
    client: Arc<QuantaClient>,
    limits: CrawlLimits,
    cancel: Arc<AtomicBool>,
) -> Discovery {
    discover_all(client, limits, cancel, noop_progress()).await
}

#[cfg(test)]
mod tests {
    use super::{append_section_context, container_resource_path, enqueue_page};
    use crate::quanta::DiscoveredResource;
    use std::collections::HashSet;
    use url::Url;

    #[test]
    fn page_queue_rejects_duplicates_and_cycles() {
        let root = Url::parse("https://quanta.bits-pilani.ac.in/mod/page/view.php?id=1").unwrap();
        let child = Url::parse("https://quanta.bits-pilani.ac.in/mod/page/view.php?id=2").unwrap();
        let mut pending = vec![(root.clone(), vec!["Lecture Notes".into()])];
        let mut visited = HashSet::new();
        assert!(!enqueue_page(&mut pending, &visited, root.clone(), vec![]));
        assert!(enqueue_page(&mut pending, &visited, child.clone(), vec!["Lecture Notes".into()]));
        assert!(!enqueue_page(&mut pending, &visited, child.clone(), vec![]));
        visited.insert(root.to_string());
        assert!(!enqueue_page(&mut pending, &visited, root, vec![]));
        assert_eq!(pending.len(), 2);
    }

    #[test]
    fn folder_files_keep_their_actual_parent_section_and_container() {
        let folder = DiscoveredResource {
            external_id: "mod:folder:1396".into(),
            course_external_id: "1117".into(),
            title: "Section-1 Slides".into(),
            url: "https://quanta.bits-pilani.ac.in/mod/folder/view.php?id=1396".into(),
            source_page_url: None,
            resource_type: "folder".into(),
            uploaded_at: None,
            published_at: None,
            modified_at: None,
            due_at: None,
            size_bytes: None,
            section: Some("Section-1".into()),
            section_path: vec!["Section-1".into()],
            is_external: false,
            available: true,
        };
        assert_eq!(container_resource_path(&folder), vec!["Section-1", "Section-1 Slides"]);
    }

    #[test]
    fn nested_page_context_does_not_repeat_existing_parent_sections() {
        let mut path = vec!["Section-4".to_string(), "Attendance Notes".to_string()];
        append_section_context(&mut path, &["Section-4".into()]);
        assert_eq!(path, vec!["Section-4", "Attendance Notes"]);

        append_section_context(&mut path, &["Section-4".into(), "Lecture Attendance".into()]);
        assert_eq!(path, vec!["Section-4", "Attendance Notes", "Lecture Attendance"]);
    }
}

//! Material requests, file enrichment and folder replacement policy.
//! Single-file observations keep the module identity and course listing source;
//! multi-file containers yield child identities under the container's full path.
//! A page with no files (including a direct binary response) stays in inventory.

use super::{
    client::{QuantaClient, QuantaError},
    collection::DetailCollection,
    parse, DiscoveredResource,
};
use url::Url;

pub(crate) fn accepts(t: &str) -> bool {
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

pub(crate) fn container_resource_path(item: &DiscoveredResource) -> Vec<String> {
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

pub(crate) async fn collect(
    client: &QuantaClient,
    origin: &Url,
    item: DiscoveredResource,
) -> DetailCollection {
    let url = match Url::parse(&item.url) {
        Ok(url) => url,
        Err(error) => {
            return DetailCollection::failed(item, QuantaError::Client(error.to_string()))
        }
    };
    let fetched = match client.fetch(&url).await {
        Ok(page) => page,
        Err(error) => return DetailCollection::failed(item, error),
    };
    let mut files = parse::parse_file_page(
        &fetched.body,
        &item.course_external_id,
        origin,
        item.section.as_deref(),
    );
    for file in &mut files {
        if file.source_page_url.is_none() {
            file.source_page_url = Some(url.to_string());
        }
    }
    match files.len() {
        0 => {
            let mut kept = item;
            if kept.modified_at.is_none() {
                kept.modified_at =
                    parse::parse_recent_activity(&fetched.body, &kept.course_external_id, origin)
                        .into_iter()
                        .find_map(|resource| resource.modified_at);
            }
            DetailCollection::Keep(Box::new(kept))
        }
        1 => {
            let file = files.into_iter().next().unwrap();
            let mut enriched = item;
            enriched.size_bytes = file.size_bytes.or(enriched.size_bytes);
            enriched.modified_at = file.modified_at.or(enriched.modified_at);
            enriched.url = file.url;
            enriched.resource_type = file.resource_type;
            enriched.available = file.available;
            DetailCollection::Keep(Box::new(enriched))
        }
        _ => {
            let path = container_resource_path(&item);
            for file in &mut files {
                file.section_path = path.clone();
            }
            DetailCollection::Replace(files)
        }
    }
}

//! Announcement requests, parsing and forum-container replacement policy.
//! Empty or failed forums retain their original observation. A nonempty forum
//! yields discussion identities with the forum as their actual listing source.

use super::{
    client::{QuantaClient, QuantaError},
    collection::DetailCollection,
    parse, DiscoveredResource,
};
use url::Url;

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
    let mut discussions = parse::parse_forum_page(
        &fetched.body,
        &item.course_external_id,
        origin,
        item.section.as_deref(),
    );
    for discussion in &mut discussions {
        if discussion.source_page_url.is_none() {
            discussion.source_page_url = Some(url.to_string());
        }
    }
    if discussions.is_empty() {
        DetailCollection::Keep(Box::new(item))
    } else {
        DetailCollection::Replace(discussions)
    }
}

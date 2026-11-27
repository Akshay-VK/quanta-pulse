//! Observations from a concrete material or announcement detail collection.
//! Replacement is decided by the collector; inventory merging preserves kept
//! observations ahead of expanded children, as in the original crawl.

use super::{client::QuantaError, DiscoveredResource};

pub(crate) enum DetailCollection {
    Keep(Box<DiscoveredResource>),
    Replace(Vec<DiscoveredResource>),
    Failed(Box<DiscoveredResource>, String, bool),
}

impl DetailCollection {
    pub(crate) fn failed(item: DiscoveredResource, error: QuantaError) -> Self {
        let expired = matches!(error, QuantaError::AuthExpired);
        Self::Failed(Box::new(item), error.to_string(), expired)
    }

    pub(crate) fn error(&self) -> Option<String> {
        match self {
            Self::Failed(_, error, _) => Some(error.clone()),
            _ => None,
        }
    }
}

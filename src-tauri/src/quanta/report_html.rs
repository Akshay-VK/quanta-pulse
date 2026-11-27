//! Helpers for interpreting visible fields from student self-report HTML.

use scraper::ElementRef;

pub(crate) fn unique<'a>(
    mut elements: impl Iterator<Item = ElementRef<'a>>,
) -> Option<ElementRef<'a>> {
    let first = elements.next()?;
    elements.next().is_none().then_some(first)
}

pub(crate) fn hidden(element: ElementRef<'_>) -> bool {
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

pub(crate) fn readable_text(element: ElementRef<'_>) -> Option<String> {
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

pub(crate) fn positive_id(value: &str) -> Option<i64> {
    value
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
}

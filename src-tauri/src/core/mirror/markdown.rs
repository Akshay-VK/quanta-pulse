//! Markdown snapshots of Quanta's text pages.
//!
//! Announcements, forum posts and Moodle pages have no file to download, but
//! they are exactly what a student wants to search and read offline. Each one is
//! saved as `<course>/Announcements/<yyyy-MM-dd> <title>.md` so it is browsable
//! and sendable alongside the real files.
//!
//! The conversion is deliberately small: the tags a Moodle activity actually
//! uses, with everything else passed through as text. The page's main content
//! region is chosen with the same rule as the in-app preview, so an announcement
//! never captures the course navigation.

use scraper::{ElementRef, Html, Node};

use crate::quanta::parse::select_content_root;

/// HTML to Markdown. Unknown tags contribute their text, never their markup.
pub fn html_to_markdown(html: &str) -> String {
    let doc = Html::parse_document(html);
    let root = select_content_root(&doc).unwrap_or_else(|| doc.root_element());
    let mut out = String::new();
    render_children(root, &mut out, " ");
    tidy(&out)
}

/// Build the file contents: a short front-matter block a human can read, then
/// the converted body.
pub fn snapshot(title: &str, date: Option<&str>, author: Option<&str>, html: &str) -> String {
    let mut out = format!("# {}\n\n", title.trim());
    if let Some(date) = date {
        out.push_str(&format!("- Date: {date}\n"));
    }
    if let Some(author) = author.map(str::trim).filter(|a| !a.is_empty()) {
        out.push_str(&format!("- Author: {author}\n"));
    }
    out.push('\n');
    let body = html_to_markdown(html);
    if body.is_empty() {
        out.push_str("_Quanta served this page without any readable text._\n");
    } else {
        out.push_str(&body);
        out.push('\n');
    }
    out
}

fn render_children(el: ElementRef<'_>, out: &mut String, prefix: &str) {
    for child in el.children() {
        match child.value() {
            Node::Text(text) => out.push_str(&collapse(&text.text)),
            Node::Element(_) => {
                if let Some(child_el) = ElementRef::wrap(child) {
                    render_element(child_el, out, prefix);
                }
            }
            _ => {}
        }
    }
}

fn render_element(el: ElementRef<'_>, out: &mut String, prefix: &str) {
    let name = el.value().name().to_ascii_lowercase();
    match name.as_str() {
        // Presentation and behaviour, never content.
        "script" | "style" | "noscript" | "template" | "svg" | "head" | "nav" | "header"
        | "footer" | "aside" | "form" | "button" | "select" | "option" | "textarea" => {}
        "br" => out.push('\n'),
        "hr" => out.push_str("\n---\n\n"),
        "p" | "div" | "section" | "article" | "dd" | "figcaption" | "caption" | "summary" => {
            if !prefix.trim().is_empty() {
                out.push_str(prefix);
            }
            render_children(el, out, prefix);
            out.push_str("\n\n");
        }
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            let level = name[1..].parse::<usize>().unwrap_or(1).min(6);
            out.push('\n');
            out.push_str(&"#".repeat(level));
            out.push(' ');
            render_children(el, out, "");
            out.push_str("\n\n");
        }
        "blockquote" => {
            let mut inner = String::new();
            render_children(el, &mut inner, "");
            for line in tidy(&inner).lines() {
                out.push_str("> ");
                out.push_str(line);
                out.push('\n');
            }
            out.push('\n');
        }
        "pre" => {
            out.push_str("\n```\n");
            out.push_str(plain_text(el).trim_end());
            out.push_str("\n```\n\n");
        }
        "ul" | "ol" => {
            out.push('\n');
            render_list(el, out, name == "ol", 0);
            out.push('\n');
        }
        "a" => {
            let href = el.value().attr("href").unwrap_or("").trim();
            let text = inline_text(el);
            if href.is_empty() {
                out.push_str(&text);
            } else {
                out.push_str(&format!("[{text}]({href})"));
            }
        }
        "strong" | "b" => out.push_str(&format!("**{}**", inline_text(el))),
        "em" | "i" => out.push_str(&format!("*{}*", inline_text(el))),
        "code" => out.push_str(&format!("`{}`", plain_text(el).trim())),
        "img" => {
            let alt = el.value().attr("alt").unwrap_or("").trim();
            let src = el.value().attr("src").unwrap_or("").trim();
            if !src.is_empty() {
                out.push_str(&format!("![{alt}]({src})"));
            }
        }
        "li" | "td" | "th" => {
            render_children(el, out, prefix);
            if name == "td" || name == "th" {
                out.push_str(" | ");
            }
        }
        _ => render_children(el, out, prefix),
    }
}

fn render_list(el: ElementRef<'_>, out: &mut String, ordered: bool, depth: usize) {
    let mut index = 1;
    for item in el.children().filter_map(ElementRef::wrap) {
        if item.value().name() != "li" {
            continue;
        }
        let indent = "  ".repeat(depth);
        // One bullet, then the item's own blocks indented under it.
        let mut inner = String::new();
        render_children(item, &mut inner, "");
        let marker = if ordered {
            format!("{index}. ")
        } else {
            "- ".to_string()
        };
        let inner = tidy(&inner);
        let mut lines = inner.lines();
        match lines.next() {
            Some(first) => {
                out.push_str(&format!("{indent}{marker}{first}\n"));
                for rest in lines {
                    out.push_str(&format!("{indent}  {rest}\n"));
                }
            }
            None => out.push_str(&format!("{indent}{marker}\n")),
        }
        for nested in item.children().filter_map(ElementRef::wrap) {
            let nested_name = nested.value().name();
            if nested_name == "ul" || nested_name == "ol" {
                render_list(nested, out, nested_name == "ol", depth + 1);
            }
        }
        index += 1;
    }
}

/// Text of an element with its inline markup dropped: used inside a link,
/// emphasis or code span, where nesting the full renderer would be wrong.
fn inline_text(el: ElementRef<'_>) -> String {
    collapse(&plain_text(el))
}

fn plain_text(el: ElementRef<'_>) -> String {
    el.text().collect::<Vec<_>>().join("")
}

/// HTML collapses runs of whitespace; do the same so a wrapped source line does
/// not become a broken Markdown line.
fn collapse(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(c);
        }
    }
    out
}

/// Collapse blank-line runs and trailing spaces, so the file has no ragged gaps.
fn tidy(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut blank = 0;
    for line in s.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_structure_and_links_and_drops_the_chrome() {
        let html = r#"
            <html><body>
              <nav>Skip this navigation</nav>
              <div id="region-main">
                <h2>Quiz 2</h2>
                <p>The answer sheet is <strong>ready</strong>.</p>
                <ul><li>Bring your ID</li><li>See <a href="https://q/x">the notice</a></li></ul>
                <pre>code  here</pre>
              </div>
              <footer>Footer noise</footer>
            </body></html>"#;
        let md = html_to_markdown(html);
        assert!(md.contains("## Quiz 2"), "{md}");
        assert!(md.contains("**ready**"), "{md}");
        assert!(md.contains("- Bring your ID"), "{md}");
        assert!(md.contains("[the notice](https://q/x)"), "{md}");
        assert!(md.contains("```\ncode  here\n```"), "{md}");
        assert!(!md.contains("navigation"), "nav is skipped: {md}");
        assert!(!md.contains("Footer noise"), "footer is skipped: {md}");
    }

    #[test]
    fn snapshot_has_a_readable_header_and_never_invents_text() {
        let md = snapshot(
            "Quiz-2 answer sheet",
            Some("2026-03-04"),
            Some("Course Staff"),
            "<div id='region-main'><p>Distribution on Friday.</p></div>",
        );
        assert!(md.starts_with("# Quiz-2 answer sheet\n"));
        assert!(md.contains("- Date: 2026-03-04"));
        assert!(md.contains("- Author: Course Staff"));
        assert!(md.contains("Distribution on Friday."));

        // An empty body is stated, not invented.
        let empty = snapshot("Nothing", None, None, "<div id='region-main'></div>");
        assert!(empty.contains("without any readable text"));
    }

    #[test]
    fn nested_lists_are_indented_and_ordered_lists_are_numbered() {
        let html = r#"<div id="region-main"><ol>
              <li>First<ul><li>Nested</li></ul></li>
              <li>Second</li>
            </ol></div>"#;
        let md = html_to_markdown(html);
        assert!(md.contains("1. First"), "{md}");
        assert!(md.contains("2. Second"), "{md}");
        assert!(md.contains("  - Nested"), "{md}");
    }

    #[test]
    fn blank_line_runs_are_collapsed() {
        let html = "<div id='region-main'><p>one</p><p></p><p></p><p>two</p></div>";
        let md = html_to_markdown(html);
        assert_eq!(md, "one\n\ntwo");
    }
}

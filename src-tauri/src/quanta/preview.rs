//! Pure helpers for the on-demand resource preview.
//!
//! Nothing here touches the network or the database: the decision of *how* a
//! resource can be shown in-app is derived from metadata Quanta Pulse already
//! stores (the normalised resource type and the direct URLs) and, once a
//! response arrives, from the content type the server actually served. No
//! content or file is ever invented, and an unknown type is reported as
//! unsupported rather than guessed.
//!
//! Also contains a tiny dependency-free base64 encoder so a fetched binary
//! body can be handed to the webview without pulling in a new crate.

use url::Url;

/// How the frontend should render a fetched resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewKind {
    Pdf,
    Image,
    Audio,
    Video,
    /// HTML/text that is reduced to readable text before display.
    Text,
    Unsupported,
}

impl PreviewKind {
    /// The renderer key sent to the frontend for binary kinds, or `None` for
    /// text/unsupported (which the frontend handles from the tag, not a mode).
    pub fn mode(self) -> Option<&'static str> {
        match self {
            PreviewKind::Pdf => Some("pdf"),
            PreviewKind::Image => Some("image"),
            PreviewKind::Audio => Some("audio"),
            PreviewKind::Video => Some("video"),
            PreviewKind::Text | PreviewKind::Unsupported => None,
        }
    }

    /// A conservative MIME used only when the server does not supply one.
    pub fn default_mime(self) -> &'static str {
        match self {
            PreviewKind::Pdf => "application/pdf",
            PreviewKind::Image => "image/png",
            PreviewKind::Audio => "audio/mpeg",
            PreviewKind::Video => "video/mp4",
            PreviewKind::Text => "text/plain",
            PreviewKind::Unsupported => "application/octet-stream",
        }
    }

    pub fn is_binary(self) -> bool {
        self.mode().is_some()
    }
}

/// The lower-case file extension of a URL's last path segment, when it looks
/// like a normal extension (letters/digits, at most five characters).
pub fn extension_of(url: &Url) -> Option<String> {
    let name = url.path_segments()?.filter(|s| !s.is_empty()).last()?;
    let (_, ext) = name.rsplit_once('.')?;
    let ext = ext.trim().to_ascii_lowercase();
    if ext.is_empty() || ext.len() > 5 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(ext)
}

/// File types we know we cannot render in-app. Fetching these would only waste
/// bandwidth, so the caller can answer "unsupported" without a request.
pub fn is_unpreviewable_extension(ext: &str) -> bool {
    matches!(
        ext,
        "doc" | "docx"
            | "odt"
            | "rtf"
            | "ppt"
            | "pptx"
            | "odp"
            | "xls"
            | "xlsx"
            | "ods"
            | "zip"
            | "rar"
            | "7z"
            | "tar"
            | "gz"
            | "ipynb"
            | "exe"
            | "dmg"
            | "apk"
    )
}

fn kind_for_extension(ext: &str) -> Option<PreviewKind> {
    Some(match ext {
        "pdf" => PreviewKind::Pdf,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif" => PreviewKind::Image,
        "mp3" | "wav" | "m4a" | "ogg" | "oga" | "flac" | "aac" => PreviewKind::Audio,
        "mp4" | "webm" | "mov" | "m4v" | "ogv" | "mkv" => PreviewKind::Video,
        "txt" | "md" | "csv" | "json" | "xml" | "html" | "htm" => PreviewKind::Text,
        _ => return None,
    })
}

fn kind_for_type(file_type: &str) -> PreviewKind {
    match file_type {
        "pdf" => PreviewKind::Pdf,
        "image" => PreviewKind::Image,
        "audio" => PreviewKind::Audio,
        "video" => PreviewKind::Video,
        // Text-like Moodle activities are fetched (as HTML) and reduced to
        // readable text. Assignments/quizzes show their schedule and brief.
        "announcement" | "page" | "book" | "label" | "assignment" | "quiz"
        | "external link" | "external tool" => PreviewKind::Text,
        _ => PreviewKind::Unsupported,
    }
}

/// Decide how a resource can be previewed from stored metadata alone.
///
/// The URL extension is trusted first: a Moodle "resource" module is typed
/// generically as `file` even when the underlying file is a PDF, and the
/// extension survives where the coarse type does not.
pub fn preview_kind(file_type: &str, url: Option<&Url>) -> PreviewKind {
    if let Some(ext) = url.and_then(extension_of) {
        if let Some(kind) = kind_for_extension(&ext) {
            return kind;
        }
    }
    kind_for_type(&file_type.trim().to_ascii_lowercase())
}

/// Refine a metadata-only decision using the content type the server actually
/// served. The server's MIME is authoritative when it names a concrete,
/// browser-renderable kind; a `text/*` response only downgrades a decision that
/// was not already a strong binary kind (so an HTML `.pdf` link stays a PDF
/// decision rather than silently becoming text).
pub fn refine_with_content_type(kind: PreviewKind, content_type: Option<&str>) -> PreviewKind {
    let Some(ct) = content_type else { return kind };
    let ct = ct.split(';').next().unwrap_or(ct).trim().to_ascii_lowercase();
    if ct.is_empty() || ct == "application/octet-stream" || ct == "binary/octet-stream" {
        return kind;
    }
    if ct == "application/pdf" {
        return PreviewKind::Pdf;
    }
    if ct.starts_with("image/") {
        return PreviewKind::Image;
    }
    if ct.starts_with("audio/") {
        return PreviewKind::Audio;
    }
    if ct.starts_with("video/") {
        return PreviewKind::Video;
    }
    if ct.starts_with("text/") || ct == "application/xhtml+xml" || ct == "application/json" {
        if kind.is_binary() {
            return kind;
        }
        return PreviewKind::Text;
    }
    kind
}

/// Truncate to at most `max` characters on a UTF-8 boundary, reporting whether
/// anything was dropped.
pub fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    if text.chars().count() <= max {
        return (text.to_string(), false);
    }
    (text.chars().take(max).collect(), true)
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 (RFC 4648, with padding). Implemented locally so the preview
/// command needs no new dependency.
pub fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(BASE64_ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            BASE64_ALPHABET[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn extracts_extensions_ignoring_query_and_short_paths() {
        assert_eq!(
            extension_of(&u("https://x/pluginfile.php/1/mod_resource/content/0/lecture.PDF?forcedownload=1"))
                .as_deref(),
            Some("pdf")
        );
        assert_eq!(
            extension_of(&u("https://x/mod/resource/view.php?id=9")).as_deref(),
            Some("php")
        );
        // A `.php` extension is not renderable, so the type still decides.
        assert_eq!(
            preview_kind("pdf", Some(&u("https://x/mod/resource/view.php?id=9"))),
            PreviewKind::Pdf
        );
        assert_eq!(extension_of(&u("https://x/")), None);
        assert_eq!(extension_of(&u("https://x/file.notanextension")), None);
    }

    #[test]
    fn url_extension_beats_the_coarse_resource_type() {
        // Moodle types a PDF resource module as the generic "file".
        assert_eq!(
            preview_kind("file", Some(&u("https://x/pluginfile.php/1/a/lecture.pdf"))),
            PreviewKind::Pdf
        );
        assert_eq!(
            preview_kind("resource", Some(&u("https://x/pluginfile.php/1/a/slides.pptx"))),
            PreviewKind::Unsupported
        );
    }

    #[test]
    fn type_drives_the_decision_when_the_url_has_no_extension() {
        assert_eq!(preview_kind("announcement", Some(&u("https://x/mod/forum/discuss.php?d=1"))), PreviewKind::Text);
        assert_eq!(preview_kind("assignment", Some(&u("https://x/mod/assign/view.php?id=1"))), PreviewKind::Text);
        assert_eq!(preview_kind("video", Some(&u("https://x/mod/video/view.php?id=1"))), PreviewKind::Video);
        assert_eq!(preview_kind("folder", Some(&u("https://x/mod/folder/view.php?id=1"))), PreviewKind::Unsupported);
    }

    #[test]
    fn served_content_type_refines_but_never_downgrades_a_binary_kind() {
        assert_eq!(
            refine_with_content_type(PreviewKind::Unsupported, Some("application/pdf; charset=binary")),
            PreviewKind::Pdf
        );
        assert_eq!(
            refine_with_content_type(PreviewKind::Unsupported, Some("text/html; charset=utf-8")),
            PreviewKind::Text
        );
        // An HTML error page served for a `.pdf` URL must not hide the file.
        assert_eq!(
            refine_with_content_type(PreviewKind::Pdf, Some("text/html")),
            PreviewKind::Pdf
        );
        assert_eq!(refine_with_content_type(PreviewKind::Unsupported, None), PreviewKind::Unsupported);
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // Bytes above 0x7f must round-trip through the standard alphabet.
        assert_eq!(base64_encode(&[0xff, 0x00, 0x80]), "/wCA");
    }

    #[test]
    fn truncation_is_character_safe() {
        let (text, truncated) = truncate_chars("héllo", 3);
        assert_eq!(text, "hél");
        assert!(truncated);
        let (text, truncated) = truncate_chars("short", 10);
        assert_eq!(text, "short");
        assert!(!truncated);
    }
}

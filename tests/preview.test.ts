import { describe, expect, it } from "vitest";
import { canPreview, extensionOf, previewMode } from "../src/lib/preview";

describe("extensionOf", () => {
  it("reads the extension of the last path segment", () => {
    expect(extensionOf("https://x/pluginfile.php/1/a/lecture.PDF?forcedownload=1")).toBe("pdf");
    expect(extensionOf("/mod/resource/view.php?id=9")).toBe("php");
  });

  it("returns null when there is no usable extension", () => {
    expect(extensionOf("https://x/folder/")).toBeNull();
    expect(extensionOf("https://x/file.notanextension")).toBeNull();
    expect(extensionOf("")).toBeNull();
  });
});

describe("previewMode", () => {
  it("uses the URL extension first, so a generic 'file' type still previews", () => {
    expect(previewMode("file", "https://quanta.bits-pilani.ac.in/pluginfile.php/1/a/lecture.pdf")).toBe(
      "pdf",
    );
    expect(previewMode("file", "https://quanta.bits-pilani.ac.in/pluginfile.php/1/a/diagram.png")).toBe(
      "image",
    );
    expect(previewMode("file", "https://quanta.bits-pilani.ac.in/pluginfile.php/1/a/clip.mp4")).toBe(
      "video",
    );
  });

  it("falls back to the resource type for endpoint URLs", () => {
    expect(previewMode("announcement", "/mod/forum/discuss.php?d=1")).toBe("text");
    expect(previewMode("assignment", "/mod/assign/view.php?id=1")).toBe("text");
  });

  it("refuses to claim an unsupported resource is previewable", () => {
    expect(previewMode("folder", "/mod/folder/view.php?id=1")).toBeNull();
    expect(previewMode("file", "/a/slides.pptx")).toBeNull();
    expect(previewMode("document", "/a/report.docx")).toBeNull();
    expect(canPreview("folder", "/mod/folder/view.php?id=1")).toBe(false);
    expect(canPreview("pdf", "/a/lecture.pdf")).toBe(true);
  });

  it("never offers an in-app preview for resources hosted outside Quanta", () => {
    expect(previewMode("external link", "https://example.org/notes.pdf")).toBeNull();
    expect(previewMode("pdf", "https://example.org/lecture.pdf")).toBeNull();
    // The real Quanta host still previews.
    expect(previewMode("pdf", "https://quanta.bits-pilani.ac.in/a/lecture.pdf")).toBe("pdf");
  });
});

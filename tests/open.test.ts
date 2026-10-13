// Central resource-navigation rules: a plain click opens the original listing
// page when one is known, and never silently masquerades a raw file open as a
// source-page open. The fallback to the direct file is only ever the explicit
// "Open File" action.

import { describe, expect, it } from "vitest";
import { eventLinks, primaryUrl, resourceLinks } from "../src/lib/open";

describe("resourceLinks", () => {
  it("keeps the direct file URL and the listing page apart", () => {
    const links = resourceLinks({
      url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=5",
      sourcePageUrl: "https://quanta.bits-pilani.ac.in/course/view.php?id=2&section=3",
    });
    expect(links.fileUrl).toBe("https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=5");
    expect(links.sourcePageUrl).toBe(
      "https://quanta.bits-pilani.ac.in/course/view.php?id=2&section=3",
    );
  });

  it("treats a missing listing page as unknown", () => {
    const links = resourceLinks({ url: "https://x/file.pdf" });
    expect(links.sourcePageUrl).toBeNull();
    expect(links.fileUrl).toBe("https://x/file.pdf");
  });
});

describe("eventLinks", () => {
  it("normalises the event URL fields and leaves absent URLs null", () => {
    const links = eventLinks({
      resourceUrl: "https://x/file.pdf",
      sourcePageUrl: "https://x/course.php?id=2",
    });
    expect(links).toEqual({
      sourcePageUrl: "https://x/course.php?id=2",
      fileUrl: "https://x/file.pdf",
    });
    expect(eventLinks({ resourceUrl: null }).fileUrl).toBeNull();
  });
});

describe("primaryUrl", () => {
  it("prefers the listing page over the direct file", () => {
    expect(
      primaryUrl({
        sourcePageUrl: "https://x/course.php?id=2",
        fileUrl: "https://x/file.pdf",
      }),
    ).toBe("https://x/course.php?id=2");
  });

  it("falls back to the direct file only when no listing page is known", () => {
    expect(primaryUrl({ sourcePageUrl: null, fileUrl: "https://x/file.pdf" })).toBe(
      "https://x/file.pdf",
    );
  });

  it("returns null only when neither URL exists", () => {
    expect(primaryUrl({ sourcePageUrl: null, fileUrl: null })).toBeNull();
  });
});
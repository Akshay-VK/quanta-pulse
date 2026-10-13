import { describe, expect, it } from "vitest";
import {
  describeUpload,
  formatBytes,
  formatCompact,
  formatDate,
  isDateOnly,
  parseTimestamp,
  relativeLabel,
} from "../src/lib/format";
import type { Resource } from "../src/lib/types";

function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    externalResourceId: "r1",
    courseId: 1,
    courseName: "Discrete Maths",
    title: "Lecture 4",
    url: "https://quanta.bits-pilani.ac.in/mod/resource/view.php?id=1",
    sourcePageUrl: null,
    resourceType: "PDF",
    uploadedAt: null,
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: "2026-10-11T09:05:00+05:30",
    lastSeenAt: "2026-10-11T09:05:00+05:30",
    lastCheckedAt: "2026-10-11T10:00:00+05:30",
    contentFingerprint: "abc",
    availabilityStatus: "available",
    sizeBytes: 2048,
    section: "Week 1",
    isExternal: false,
    ...overrides,
  };
}

describe("isDateOnly", () => {
  it("accepts a bare calendar date", () => {
    expect(isDateOnly("2026-10-11")).toBe(true);
  });
  it("rejects a full timestamp", () => {
    expect(isDateOnly("2026-10-11T09:05:00+05:30")).toBe(false);
  });
});

describe("parseTimestamp", () => {
  it("returns null for empty input", () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("   ")).toBeNull();
  });

  it("treats a date-only value as local midnight", () => {
    const d = parseTimestamp("2026-10-11");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9); // October (0-based)
    expect(d!.getDate()).toBe(11);
  });

  it("keeps the instant for an offset timestamp", () => {
    const d = parseTimestamp("2026-10-11T09:05:00+05:30");
    expect(d!.toISOString()).toBe(new Date("2026-10-11T09:05:00+05:30").toISOString());
  });

  it("rejects garbage", () => {
    expect(parseTimestamp("not-a-date")).toBeNull();
  });
});

describe("formatCompact", () => {
  it("shows only the date when no time is known", () => {
    // Never invents a time of day for date-only values.
    expect(formatCompact("2026-10-11")).toBe("11 Oct 2026");
  });

  it("shows date and time for a full timestamp", () => {
    const out = formatCompact(new Date(2026, 9, 11, 14, 35).toISOString());
    expect(out).toBe("11 Oct 2026, 14:35");
  });

  it("renders a dash for missing values", () => {
    expect(formatCompact(null)).toBe("\u2014");
    expect(formatDate(undefined)).toBe("\u2014");
  });
});

describe("relativeLabel", () => {
  const now = new Date(2026, 9, 11, 12, 0, 0);

  it("describes the past", () => {
    expect(relativeLabel(new Date(2026, 9, 11, 10, 0).toISOString(), now)).toBe("2 hours ago");
  });
  it("describes the future", () => {
    expect(relativeLabel(new Date(2026, 9, 12, 12, 0).toISOString(), now)).toBe("in 1 day");
  });
  it("collapses sub-minute differences", () => {
    expect(relativeLabel(new Date(2026, 9, 11, 11, 59, 40).toISOString(), now)).toBe("just now");
  });
  it("is empty for missing input", () => {
    expect(relativeLabel(null, now)).toBe("");
  });
});

describe("describeUpload", () => {
  it("prefers the true upload timestamp", () => {
    const d = describeUpload(resource({ uploadedAt: "2026-10-10T08:00:00+05:30" }));
    expect(d.source).toBe("uploaded");
    expect(d.note).toBeUndefined();
    expect(d.label).toBe("10 Oct 2026, 08:00");
  });

  it("falls back to published and says so", () => {
    const d = describeUpload(resource({ publishedAt: "2026-10-09T00:00:00+05:30" }));
    expect(d.source).toBe("published");
    expect(d.note).toBe("published");
  });

  it("falls back to modified and says so", () => {
    const d = describeUpload(resource({ modifiedAt: "2026-10-08T00:00:00+05:30" }));
    expect(d.source).toBe("modified");
    expect(d.note).toBe("last modified");
  });

  it("never labels the detection time as an upload time", () => {
    const d = describeUpload(resource());
    expect(d.source).toBe("unavailable");
    expect(d.label).toBe("Upload date unavailable");
    // Detection time is still exposed separately, but not as the upload.
    expect(d.detected).toBe("11 Oct 2026, 09:05");
  });

  it("does not invent a time for a date-only upload", () => {
    const d = describeUpload(resource({ uploadedAt: "2026-10-10" }));
    expect(d.label).toBe("10 Oct 2026");
  });
});

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("is empty for zero or missing", () => {
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(null)).toBe("");
  });
});

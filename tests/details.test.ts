import { describe, expect, it } from "vitest";
import { changePresentation, scanPresentation, todayPresentation } from "../src/lib/details";
import { resource } from "./helpers/data";
import type { ChangeEvent, ScanRun } from "../src/lib/types";

describe("historical detail presentation", () => {
  it("presents Today status and missing upload metadata from the selected resource", () => {
    const details = todayPresentation(resource(), new Set(["updated"]));
    expect(details.title).toBe("Lecture 4");
    expect(details.statusTag).toEqual({ kind: "updated", label: "Updated" });
    expect(details.properties).toContainEqual({ label: "Uploaded", value: "Upload date unavailable" });
    expect(todayPresentation(resource({ availabilityStatus: "unavailable" }), new Set(["new"])).statusTag).toEqual({ kind: "unavailable", label: "Unavailable" });
  });
  it("retains recorded metadata without inventing a resource, date or link", () => {
    const event: ChangeEvent = { id: 90, resourceId: null, courseId: null, courseName: null,
      resourceTitle: null, resourceUrl: null, sourcePageUrl: null, resourceType: null,
      uploadedAt: null, changeType: "updated", title: "Archived change", description: "Recorded explanation",
      detectedAt: "2026-10-14T09:05:00Z", read: false };
    const details = changePresentation(event);
    expect(details.title).toBe("Archived change");
    expect(details.statusTag).toEqual({ kind: "updated", label: "Updated" });
    expect(details.note).toBe("Recorded explanation");
    expect(details.properties).toContainEqual({ label: "Uploaded", value: "Upload date unavailable" });
    expect(details.properties.some(({ label }) => label === "File" || label === "Page")).toBe(false);
  });
  it("keeps scan counts and the actual error summary", () => {
    const scan: ScanRun = { id: 7, startedAt: "2026-10-14T09:05:00Z", completedAt: null,
      status: "partial", discoveredCount: 20, newCount: 2, updatedCount: 1, unavailableCount: 0,
      coursesScanned: 5, coursesFailed: 2, errorSummary: "Course 3 timed out; Course 4 unavailable", isBaseline: false };
    const details = scanPresentation(scan);
    expect(details.properties).toContainEqual({ label: "Status", value: "Completed with errors" });
    expect(details.properties).toContainEqual({ label: "Courses", value: "3/5" });
    expect(details.properties).toContainEqual({ label: "Errors", value: "Course 3 timed out; Course 4 unavailable" });
  });
});

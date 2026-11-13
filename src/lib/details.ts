// Property rows for the peek panel, built from a resource. Values are always
// real data; a missing date is described, never invented.

import type { ChangeEvent, Resource, ScanRun } from "./types";
import { describeUpload, formatBytes, formatCompact, relativeLabel } from "./format";
import type { StatusKind } from "../components/ui/StatusTag";
import type { ViewId } from "./nav";
import { eventKindMeta } from "./events";
import { formatSectionPath } from "./sectionPath";

export interface DetailProperty {
  label: string;
  value: string;
  /** When set, the value row offers a copy button for this text. */
  copy?: string | null;
  /** Render the value in a monospace font. */
  mono?: boolean;
}

export function resourceDetails(resource: Resource): DetailProperty[] {
  const upload = describeUpload(resource);
  const available = resource.availabilityStatus === "available";
  const props: DetailProperty[] = [
    { label: "Course", value: resource.courseName ?? "\u2014" },
    { label: "Section", value: formatSectionPath(resource) },
    { label: "Type", value: resource.resourceType || "\u2014" },
  ];
  if (resource.sizeBytes) {
    props.push({ label: "Size", value: formatBytes(resource.sizeBytes) });
  }
  props.push({
    label: "Uploaded",
    value:
      upload.source === "unavailable"
        ? "Upload date unavailable"
        : `${upload.label}${upload.note ? ` (${upload.note})` : ""}`,
  });
  props.push({
    label: "Detected",
    value: `${formatCompact(resource.firstSeenAt)} (${relativeLabel(resource.firstSeenAt)})`,
  });
  props.push({
    label: "Availability",
    value: available ? "Available" : resource.availabilityStatus,
  });
  props.push({ label: "File", value: resource.url, copy: resource.url });
  if (resource.sourcePageUrl) {
    props.push({ label: "Page", value: resource.sourcePageUrl, copy: resource.sourcePageUrl });
  }
  return props;
}
/** Identity is independent of a row's DOM lifetime and of read/open actions. */
export type DetailIdentity = `resource:${number}` | `change:${number}` | `scan:${number}`;
export type DetailSubject =
  | { kind: "resource"; resource: Resource }
  | { kind: "change"; change: ChangeEvent; resource?: Resource | null }
  | { kind: "scan"; scan: ScanRun };
export type DetailSelection = DetailSubject & { owner: ViewId; identity: DetailIdentity };

/** A virtualized/tree adapter can restore an active item before heading fallback. */
export type RestoreDetailFocus = () => boolean;
export interface DetailsAdapter {
  selected: DetailSelection | null;
  selectResource: (resource: Resource, origin: HTMLElement, restoreFocus?: RestoreDetailFocus) => void;
  selectChange: (change: ChangeEvent, origin: HTMLElement, resource?: Resource | null, restoreFocus?: RestoreDetailFocus) => void;
  selectScan: (scan: ScanRun, origin: HTMLElement, restoreFocus?: RestoreDetailFocus) => void;
  /** Clear only this view's selection, on context change or removal from results. */
  clear: () => void;
}

export function detailIdentity(subject: DetailSubject): DetailIdentity {
  switch (subject.kind) {
    case "resource": return `resource:${subject.resource.id}`;
    case "change": return `change:${subject.change.id}`;
    case "scan": return `scan:${subject.scan.id}`;
  }
}

/** Historical facts stay inspectable even when their resource no longer exists. */
export function changeDetails(event: ChangeEvent): DetailProperty[] {
  return [
    { label: "Course", value: event.courseName ?? "—" },
    { label: "Type", value: event.resourceType ?? "—" },
    { label: "Change", value: eventKindMeta(event.changeType).label },
    { label: "Detected", value: formatCompact(event.detectedAt) },
    { label: "Uploaded", value: event.uploadedAt ? formatCompact(event.uploadedAt) : "Upload date unavailable" },
    ...(event.resourceUrl ? [{ label: "File", value: event.resourceUrl, copy: event.resourceUrl }] : []),
    ...(event.sourcePageUrl ? [{ label: "Page", value: event.sourcePageUrl, copy: event.sourcePageUrl }] : []),
  ];
}

/** Pure presentation shared by resource, recorded-change and scan adapters. */
export interface DetailPresentation {
  statusTag?: { kind: StatusKind; label: string } | null;
  title: string;
  properties: DetailProperty[];
  note?: string | null;
}
export function changePresentation(event: ChangeEvent): DetailPresentation {
  const kinds: Record<string, StatusKind> = {
    new: "new", updated: "updated", announcement: "note", deadline: "deadline",
    unavailable: "unavailable", restored: "restored",
  };
  return {
    title: event.resourceTitle ?? event.title,
    properties: changeDetails(event),
    note: event.description,
    statusTag: kinds[event.changeType]
      ? { kind: kinds[event.changeType], label: eventKindMeta(event.changeType).label } : null,
  };
}

interface ScanStatusMeta {
  kind: StatusKind;
  label: string;
  running?: boolean;
}

/** Recorded scan status shared by the History row and its details. */
export function scanStatusMeta(status: string): ScanStatusMeta {
  switch (status) {
    case "running":
      return { kind: "new", label: "Running", running: true };
    case "ok":
      return { kind: "restored", label: "Completed" };
    case "partial":
      return { kind: "updated", label: "Completed with errors" };
    case "cancelled":
      return { kind: "deadline", label: "Failed" };
    default:
      return { kind: "deadline", label: status };
  }
}

/** Recorded scan properties displayed by the shared details panel. */
export function scanPresentation(scan: ScanRun): DetailPresentation {
  const { label: status } = scanStatusMeta(scan.status);
  return {
    title: `Scan of ${formatCompact(scan.startedAt)}`,
    properties: [
      { label: "Started", value: formatCompact(scan.startedAt) },
      { label: "Status", value: status },
      { label: "Found", value: String(scan.discoveredCount) },
      { label: "New", value: String(scan.newCount) },
      { label: "Updated", value: String(scan.updatedCount) },
      { label: "Unavailable", value: String(scan.unavailableCount) },
      { label: "Courses", value: `${Math.max(0, scan.coursesScanned - scan.coursesFailed)}/${scan.coursesScanned}` },
      { label: "Baseline", value: scan.isBaseline ? "Yes" : "No" },
      ...(scan.errorSummary ? [{ label: "Errors", value: scan.errorSummary }] : []),
    ],
  };
}

/** Today adapts its real resource and recorded event kinds to the shared panel. */
export function todayPresentation(resource: Resource, kinds?: ReadonlySet<string>): DetailPresentation {
  const statusTag: DetailPresentation["statusTag"] = resource.availabilityStatus !== "available"
    ? { kind: "unavailable", label: "Unavailable" }
    : kinds?.has("announcement") ? { kind: "note", label: "Announcement" }
    : kinds?.has("updated") ? { kind: "updated", label: "Updated" }
    : kinds?.has("new") ? { kind: "new", label: "New" } : null;
  return {
    title: resource.title,
    properties: resourceDetails(resource),
    statusTag,
    note: resource.availabilityStatus !== "available" ? "Missing for 2 scans in a row. It may come back." : null,
  };
}

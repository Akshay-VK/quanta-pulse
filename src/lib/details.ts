// Property rows for the peek panel, built from a resource. Values are always
// real data; a missing date is described, never invented.

import type { Resource } from "./types";
import { describeUpload, formatBytes, formatCompact, relativeLabel } from "./format";
import { formatSectionPath } from "./sectionPath";

export interface DetailProperty {
  label: string;
  value: string;
  /** When set, the value row offers a copy button for this text. */
  copy?: string | null;
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
import { validCalendarDate, validCalendarInstant } from "./agenda";
import type { AcademicCoverage, AcademicDate, AcademicPage, AssignmentObservation, Course, DueFilter, DueResource, Resource } from "./types";

export function assignmentModuleId(resource: Resource): number | null {
  return resource.resourceType === "assignment" ? moduleFromUrl(resource.url) : null;
}

function moduleFromUrl(value: string): number | null {
  try {
    const url = new URL(value);
    const id = url.searchParams.get("id") ?? "";
    const ids = [...url.searchParams.keys()];
    return url.origin === "https://quanta.bits-pilani.ac.in" && !url.username && !url.password &&
      url.pathname === "/mod/assign/view.php" && ids.length === 1 && /^\d+$/.test(id) &&
      Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
  } catch {
    return null;
  }
}

export interface AssignmentDetails {
  observation: AssignmentObservation;
  coverage: AcademicCoverage;
}

export function assignmentDetails(pages: AcademicPage<AssignmentObservation>[], resources: Resource[], now: Date, maxAgeMinutes: number) {
  const byModule = new Map<string, AssignmentDetails | null>();
  for (const { courseId, coverage, records } of pages) {
    if (!coverage || coverage.permission !== "permitted" || !coverage.lastSuccessfulAt ||
      coverage.coverage === "unsupported" || coverage.coverage === "denied") continue;
    for (const observation of records) {
      if (observation.source.visibility !== "visible" || !observation.courseModuleId ||
        moduleFromUrl(observation.source.sourceUrl) !== observation.courseModuleId) continue;
      const key = `${courseId}:${observation.courseModuleId}`;
      const fresh = (stamp: string) => {
        const age = now.getTime() - Date.parse(stamp);
        return age >= 0 && age <= maxAgeMinutes * 60_000;
      };
      const stale = coverage.stale || !fresh(observation.source.observedAt) || !fresh(coverage.lastSuccessfulAt);
      byModule.set(key, byModule.has(key) ? null : { observation, coverage: { ...coverage, stale } });
    }
  }
  const details = new Map<number, AssignmentDetails>();
  for (const resource of resources) {
    const id = assignmentModuleId(resource);
    if (id === null) continue;
    const entry = byModule.get(`${resource.courseId}:${id}`);
    if (entry && (entry.observation.resourceId == null || entry.observation.resourceId === resource.id)) {
      details.set(resource.id, entry);
    }
  }
  return details;
}

export function assignmentDue(due: AcademicDate): { value: string; kind: DueResource["dateKind"] } | null {
  if (due.kind === "dateOnly" && validCalendarDate(due.value)) return { value: due.value, kind: "date" };
  if (due.kind === "instant" && validCalendarInstant(due.value)) return { value: due.value, kind: "instant" };
  return null;
}

export function projectAssignmentDates(
  items: DueResource[], resources: Resource[], courses: Course[], filter: DueFilter, details: Map<number, AssignmentDetails>,
): DueResource[] {
  if (!details.size) return items;
  const rows = new Map(items.map(item => [item.resource.id, item]));
  const paused = new Set(courses.filter(course => course.monitoringStatus === "paused").map(course => course.id));
  const search = filter.search?.trim().toLowerCase();
  for (const resource of resources) {
    const detailsForResource = details.get(resource.id);
    if (!detailsForResource) continue;
    const { observation, coverage } = detailsForResource;
    const coursePaused = resource.courseId != null && paused.has(resource.courseId);
    if (filter.courseId ? resource.courseId !== filter.courseId : coursePaused) continue;
    if (filter.resourceType && resource.resourceType !== filter.resourceType) continue;
    if (search && ![resource.title, resource.courseName, resource.sectionPath?.join(" ")]
      .some(value => value?.toLowerCase().includes(search))) continue;
    const date = assignmentDue(observation.due);
    if (date) rows.set(resource.id, { resource: rows.get(resource.id)?.resource ?? resource,
      dateKind: date.kind, coursePaused, projectedDueAt: date.value });
    else if (observation.due.kind === "unset" && !coverage.stale) rows.delete(resource.id);
  }
  return [...rows.values()];
}

const statuses: Record<AssignmentObservation["submissionStatus"], string> = {
  unknown: "Unknown", unsubmitted: "Unsubmitted", draft: "Draft", submitted: "Submitted", reopened: "Reopened",
  notRequired: "Not required", notYetOpen: "Not yet open",
};

export function assignmentProperties({ observation, coverage }: AssignmentDetails, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, dateStyle: "medium", timeStyle: "short",
  });
  const displayInstant = (value: string) => validCalendarInstant(value) ? formatter.format(new Date(value)) : value;
  function displayDate(date: AcademicDate | undefined, unavailable = "Unknown"): string {
    if (!date || date.kind === "unknown") return unavailable;
    if (date.kind === "unset") return "No date set";
    if (date.kind === "unsupported") return "Unsupported source format";
    if (date.kind === "ambiguous") return `${date.value} (time unverified)`;
    return date.kind === "instant" ? displayInstant(date.value) : date.value;
  }

  const facts = observation.details;
  const dueSource = facts?.dueProvenance === "extension" ? "Extension" :
    facts?.dueProvenance === "base" ? "Base date" : "Student assignment page";
  return [
    { label: "Submission", value: statuses[observation.submissionStatus] ?? statuses.unknown },
    ...(observation.attemptNumber == null ? [] : [{ label: "Attempt", value: String(observation.attemptNumber + 1) }]),
    ...(facts?.mode === "team" ? [{ label: "Team confirmations", value: facts.pendingTeamConfirmations == null ? "Unknown" : String(facts.pendingTeamConfirmations) }] : []),
    { label: "Due", value: displayDate(observation.due) },
    ...(observation.due.kind === "unknown" ? [] : [{ label: "Deadline source", value: dueSource }]),
    ...(facts?.dueProvenance === "extension" && facts.effectiveDue && facts.effectiveDue.kind !== "unknown"
      ? [{ label: "Due before extension", value: displayDate(facts.effectiveDue) }] : []),
    ...(facts?.baseDue && facts.baseDue.kind !== "unknown" && facts.dueProvenance !== "base" ? [{ label: "Base due", value: displayDate(facts.baseDue) }] : []),
    ...(facts?.opening && facts.opening.kind !== "unknown" ? [{ label: "Opens", value: displayDate(facts.opening) }] : []),
    ...(facts?.extension && facts.extension.kind !== "unknown" && facts.dueProvenance !== "extension" ? [{ label: "Extension", value: displayDate(facts.extension) }] : []),
    { label: "Cut-off", value: displayDate(facts?.cutOff, "Unavailable from source") },
    ...(facts?.gradingDue && facts.gradingDue.kind !== "unknown" ? [{ label: "Grading due", value: displayDate(facts.gradingDue) }] : []),
    ...(facts?.gradingStatus ? [{ label: "Grading", value: facts.gradingStatus }] : []),
    ...(facts?.timeLimitSeconds == null ? [] : [{ label: "Time limit", value: facts.timeLimitSeconds === 0 ? "No limit" : `${facts.timeLimitSeconds} s` }]),
    { label: "Coverage", value: coverage.stale ? (coverage.coverage === "complete" ? "Stale snapshot" : `Stale · ${coverage.coverage}`) : "Complete" },
    { label: "Observed", value: displayInstant(observation.source.observedAt) },
    ...(facts?.description ? [{ label: "Description", value: facts.description }] : []),
    ...(facts?.attachments?.length ? [{ label: "Reference attachments", value: facts.attachments.map(attachment => attachment.title).join(", ") }] : []),
    ...(facts?.releasedFeedback ? [{ label: "Released feedback", value: facts.releasedFeedback }] : []),
  ];
}

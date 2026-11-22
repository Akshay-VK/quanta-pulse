import type { GradeObservation } from "./types";

export function gradeValue(grade: GradeObservation): string {
  switch (grade.source.visibility) {
    case "hidden": return "Hidden";
    case "unreleased": return "Unreleased";
    case "unknown": return "Unknown";
    case "visible":
      if (grade.displayValue) return grade.displayValue;
      if (grade.details?.valueStatus === "blank") return "Blank";
      if (grade.details?.valueStatus === "ungraded") return "Ungraded";
      return "Unknown";
  }
}

export function gradeReportUrl(externalCourseId: string): string | null {
  return /^[1-9]\d*$/.test(externalCourseId)
    ? `https://quanta.bits-pilani.ac.in/grade/report/user/index.php?id=${externalCourseId}`
    : null;
}

/** Group rows by stable source category and show nested categories as breadcrumbs. */
export function gradeGroups(records: GradeObservation[]) {
  const categories = new Map(records
    .filter(record => record.itemKind === "category" && !record.gradeItemId)
    .map(record => [record.source.sourceId, record]));
  const groups = new Map<string | null, GradeObservation[]>();
  for (const record of records) {
    if (categories.has(record.source.sourceId) || record.itemKind === "courseTotal") continue;
    const key = record.parentSourceId && categories.has(record.parentSourceId) ? record.parentSourceId : null;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return Array.from(groups, ([key, rows]) => {
    const path: string[] = [];
    const seen = new Set<string>();
    let category = key ? categories.get(key) : undefined;
    while (category && !seen.has(category.source.sourceId)) {
      seen.add(category.source.sourceId);
      path.unshift(category.title);
      category = category.parentSourceId ? categories.get(category.parentSourceId) : undefined;
    }
    return { key, title: path.join(" / ") || "Grade items", rows };
  });
}

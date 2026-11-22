import { ExternalLink, RotateCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useGradeReport } from "../../hooks/useGradeReport";
import { resolveTimezone } from "../../lib/agenda";
import { gradeGroups, gradeReportUrl, gradeValue } from "../../lib/grades";
import type { AcademicCoverage, Course, GradeObservation } from "../../lib/types";

function coverageLabel(coverage: AcademicCoverage | null | undefined) {
  if (!coverage) return "Grade source awaiting verification";
  if (coverage.permission === "restricted") return "Grade report access is restricted";
  switch (coverage.coverage) {
    case "complete": return coverage.stale ? "Stale · session expired" : "Complete report";
    case "partial": return coverage.stale ? "Stale · partial report" : "Partial report";
    case "unsupported": return "Unsupported grade report";
    case "denied": return "Grade report access is restricted";
    case "offline": return coverage.stale && coverage.lastSuccessfulAt ? "Stale · report unavailable" : "Grade report unavailable";
    case "cancelled": return coverage.stale && coverage.lastSuccessfulAt ? "Stale · check cancelled" : "Grade report check cancelled";
    case "failed": return coverage.stale && coverage.lastSuccessfulAt ? "Stale · check failed" : "Grade report check failed";
  }
}

function GradeRow({ grade }: { grade: GradeObservation }) {
  const visible = grade.source.visibility === "visible";
  const fields = visible ? [
    ["Range", grade.rangeDisplay],
    ["Weight", grade.weightDisplay],
    ["Percentage", grade.details?.percentageDisplay],
    ["Letter grade", grade.details?.letterDisplay],
    ["Feedback", grade.feedback],
  ].filter(([, value]) => Boolean(value)) : [];
  const label = <>
    <span className="course-grade-title">{grade.title}</span>
    {grade.omitted && <span className="course-grade-omitted">Missing from latest report</span>}
    <span className="course-grade-value">{gradeValue(grade)}</span>
  </>;
  if (!fields.length) return <div className="course-grade-row">{label}</div>;
  return (
    <details>
      <summary className="course-grade-row">{label}</summary>
      <dl className="course-grade-properties">
        {fields.map(([name, value]) => (
          <div key={name}><dt>{name}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </details>
  );
}

export function CourseGrades({ course, onOpen, timeZone }: {
  course: Course;
  onOpen: (url: string) => void;
  timeZone?: string;
}) {
  const { page, status, reload } = useGradeReport(course.id);
  const coverage = page?.coverage;
  const reportUrl = gradeReportUrl(course.externalCourseId);
  const records = coverage?.permission === "permitted" && coverage.coverage !== "unsupported" ? page?.records ?? [] : [];
  const total = records.find(grade => grade.itemKind === "courseTotal");
  const groups = gradeGroups(records);
  const lastSuccess = coverage?.lastSuccessfulAt;
  const date = lastSuccess ? new Date(lastSuccess) : null;
  const timestamp = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium", timeStyle: "short", timeZone: resolveTimezone(timeZone),
    }).format(date)
    : null;

  return (
    <section className="course-grades" aria-label="Course grade report">
      <div className="course-grade-header">
        <div className="course-grade-source" role="status">
          <strong>{status === "loading" ? "Loading local grades…" : status === "locked" ? "Verify your Quanta session to view grades"
            : status === "failed" ? "Couldn’t load local grades" : coverageLabel(coverage)}</strong>
          {timestamp && <span>Last complete report <time dateTime={lastSuccess ?? undefined}>{timestamp}</time></span>}
          {status === "ready" && !coverage && !page?.context.collectorsEnabled && <span>Automatic grade collection is disabled.</span>}
        </div>
        <div className="course-grade-actions">
          <Button size="sm" onClick={reload} aria-label="Reload local grades" leadingIcon={<RotateCw aria-hidden="true" />}>Reload</Button>
          {reportUrl && <Button size="sm" onClick={() => onOpen(reportUrl)} leadingIcon={<ExternalLink aria-hidden="true" />}>Open in Quanta</Button>}
        </div>
      </div>
      {total ? <div className="course-grade-total"><GradeRow grade={total} /></div>
        : records.length > 0 && <p className="course-grade-empty">Course total unavailable from the report.</p>}
      {groups.map(group => (
        <section key={group.key ?? ""} className="course-grade-group">
          <h3>{group.title}</h3>
          <ul>{group.rows.map(grade => <li key={grade.source.sourceId}><GradeRow grade={grade} /></li>)}</ul>
        </section>
      ))}
      {status === "ready" && coverage?.coverage === "complete" && records.length === 0
        && <p className="course-grade-empty">The report contains no grade items.</p>}
    </section>
  );
}

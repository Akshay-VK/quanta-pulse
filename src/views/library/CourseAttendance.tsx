import { useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useLocalAcademicReport } from "../../hooks/useLocalAcademicReport";
import { resolveTimezone } from "../../lib/agenda";
import { api } from "../../lib/api";
import {
  attendanceActivities, attendanceCourseSource, attendanceCoverage, attendanceScope, attendanceSource, attendanceStates,
  type ScopedAttendance,
} from "../../lib/attendance";

function ObservedAt({ value, timeZone }: { value: string; timeZone?: string }) {
  const observed = new Date(value);
  if (Number.isNaN(observed.getTime())) return null;
  const display = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: resolveTimezone(timeZone),
  }).format(observed);
  return <time dateTime={value}>{display}</time>;
}

function ScopedReport({ report, timeZone }: { report: ScopedAttendance; timeZone?: string }) {
  const { details } = report;
  const rows = details.sessions;
  const weakIds = rows.some(row => row.sessionId === null);
  return (
    <section className="course-attendance-snapshot" aria-label="Selected attendance report">
      <div className="course-attendance-context">
        <div>
          <h3>{details.title}</h3>
          <p>{attendanceScope(details)}</p>
        </div>
        <div className="course-attendance-meta">
          <strong>{details.complete ? "Complete for selected scope" : `Partial scope · Page ${details.page} of ${details.totalPages}`}</strong>
          <span>Observed <ObservedAt value={report.source.observedAt} timeZone={timeZone} /></span>
        </div>
      </div>
      {(report.summaryDisplay !== null || report.maximumDisplay !== null) && (
        <dl className="course-attendance-summary">
          {report.summaryDisplay !== null && <div><dt>{details.summaryLabel ?? "Source summary"}</dt><dd>{report.summaryDisplay}</dd></div>}
          {report.maximumDisplay !== null && <div><dt>Denominator</dt><dd>{report.maximumDisplay}</dd></div>}
        </dl>
      )}
      <div className="course-attendance-session-heading">
        <h4>Sessions</h4>
        {weakIds && <span>Scoped snapshot</span>}
      </div>
      {rows.length === 0 && <p className="course-attendance-empty">This report shows no sessions.</p>}
      <ul className="course-attendance-sessions">
        {rows.map((row, index) => (
          <li key={row.sessionId ?? index} className="course-attendance-session">
            <div><span className="course-attendance-date">{row.dateDisplay}</span>{row.description && <strong>{row.description}</strong>}</div>
            <div>
              {row.statusDisplay && <strong>{row.statusDisplay}</strong>}
              {(row.state !== "recorded" || !row.statusDisplay) && <span>{attendanceStates[row.state]}</span>}
            </div>
            <div className="course-attendance-points">
              {row.pointsDisplay !== null && <span>Points <strong>{row.pointsDisplay}</strong></span>}
              {row.maximumDisplay !== null && <span>Maximum <strong>{row.maximumDisplay}</strong></span>}
            </div>
            {row.remarks && <p className="course-attendance-remarks">{row.remarks}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CourseAttendance({ courseId, courseUrl, onOpen, timeZone }: {
  courseId: number;
  courseUrl: string;
  onOpen: (url: string) => void;
  timeZone?: string;
}) {
  const { page, status, reload } = useLocalAcademicReport(courseId, api.academicAttendance);
  const [activityId, setActivityId] = useState("");
  const [scopeId, setScopeId] = useState("");
  const coverage = page?.coverage;
  const activities = attendanceActivities(coverage?.permission === "permitted" ? page?.records ?? [] : []);
  const activity = activities.find(item => item.id === activityId) ?? activities[0];
  const report = activity?.reports.find(item => item.source.sourceId === scopeId) ?? activity?.reports[0];
  const source = report && attendanceSource(report);
  const courseSource = coverage?.coverage === "unsupported" && attendanceCourseSource(courseUrl);
  const statusLabel = status === "loading" ? "Loading local attendance…" :
    status === "locked" ? "Verify your Quanta session to view attendance" :
      status === "failed" ? "Couldn’t load local attendance" : attendanceCoverage(coverage);

  return (
    <section className="course-attendance" aria-label="Course attendance report">
      <div className="course-grade-header">
        <div className="course-grade-source" role="status">
          <strong>{statusLabel}</strong>
          {coverage && <span>Latest check <ObservedAt value={coverage.observedAt} timeZone={timeZone} /></span>}
          {status === "ready" && !coverage && !page?.context.collectorsEnabled && <span>Automatic attendance collection is disabled.</span>}
        </div>
        <div className="course-grade-actions">
          <Button size="sm" onClick={reload} aria-label="Reload local attendance" leadingIcon={<RotateCw aria-hidden="true" />}>Reload</Button>
          {source && <Button size="sm" onClick={() => onOpen(source)} leadingIcon={<ExternalLink aria-hidden="true" />}>Open in Quanta</Button>}
          {!source && courseSource && <Button size="sm" onClick={() => onOpen(courseSource)} leadingIcon={<ExternalLink aria-hidden="true" />}>Open course in Quanta</Button>}
        </div>
      </div>
      {activity && report ? (
        <>
          <div className="course-attendance-filters">
            <label>Activity
              <select aria-label="Attendance activity" value={activity.id} onChange={event => { setActivityId(event.target.value); setScopeId(""); }}>
                {activities.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <label>Report range
              <select aria-label="Attendance range" value={report.source.sourceId} onChange={event => setScopeId(event.target.value)}>
                {activity.reports.map(item => <option key={item.source.sourceId} value={item.source.sourceId}>{attendanceScope(item.details)}</option>)}
              </select>
            </label>
          </div>
          <ScopedReport report={report} timeZone={timeZone} />
        </>
      ) : status === "ready" && coverage?.permission === "permitted" &&
        <p className="course-attendance-empty">No scoped attendance reports available.</p>}
    </section>
  );
}

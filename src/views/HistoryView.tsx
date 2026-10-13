import { useRef, useState } from "react";
import { formatCompact, relativeLabel } from "../lib/format";
import { eventKindMeta } from "../lib/events";
import { eventLinks } from "../lib/open";
import type { ChangeEvent, ScanRun } from "../lib/types";
import PageHeader from "../components/PageHeader";
import OpenActions from "../components/OpenActions";
import ClearActivityButton from "../components/ClearActivityButton";

interface Props {
  scans: ScanRun[];
  events: ChangeEvent[];
  onOpen: (url: string) => void;
  onMarkAllRead: () => Promise<void>;
  onClearAll: () => Promise<void>;
}

function ScanStatus({ status, isBaseline }: { status: string; isBaseline: boolean }) {
  const ok = status === "ok" || status === "success";
  return (
    <span className={`status-text ${ok ? "text-ok" : "text-danger"}`}>
      <span className="dot" />
      {status}
      {isBaseline && <span className="faint small"> · baseline</span>}
    </span>
  );
}

export default function HistoryView({ scans, events, onOpen, onMarkAllRead, onClearAll }: Props) {
  const [markingRead, setMarkingRead] = useState(false);
  const readRequest = useRef(false);

  async function markAllRead() {
    if (readRequest.current || !events.some((event) => !event.read)) return;
    readRequest.current = true;
    setMarkingRead(true);
    try {
      await onMarkAllRead();
    } catch {
      // The app shell reports backend failures in its shared toast.
    } finally {
      readRequest.current = false;
      setMarkingRead(false);
    }
  }

  return (
    <div>
      <PageHeader title="History" subtitle="Change log for your monitored courses">
        <ClearActivityButton scope="History" onConfirm={onClearAll} />
      </PageHeader>

      <div className="section-title">Recent changes</div>
      <div className="history-actions">
        <button
          className="btn-link"
          type="button"
          onClick={() => void markAllRead()}
          disabled={markingRead || !events.some((event) => !event.read)}
        >
          {markingRead ? "Marking read…" : "Mark all as read"}
        </button>
      </div>
      {events.length === 0 ? (
        <div className="empty">No changes recorded yet.</div>
      ) : (
        <>
          <table className="grid">
            <thead>
              <tr>
                <th>Detected</th>
                <th>Change</th>
                <th>Resource</th>
                <th>Course</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const meta = eventKindMeta(e.changeType);
                return (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatCompact(e.detectedAt)}
                      <div className="faint small">{relativeLabel(e.detectedAt)}</div>
                    </td>
                    <td>
                      <span className={`label ${meta.id}`}>{meta.label}</span>
                      {!e.read && <span className="unread-dot" style={{ marginLeft: 6 }} />}
                    </td>
                    <td>
                      {e.resourceTitle ?? e.title}
                      {e.sectionPath && e.sectionPath.length > 0 && (
                        <div className="faint small">{e.sectionPath.join(" → ")}</div>
                      )}
                    </td>
                    <td className="muted">{e.courseName ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <OpenActions links={eventLinks(e)} onOpen={onOpen} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div className="section-title" style={{ marginTop: 24 }}>
        Scan history
      </div>
      {scans.length === 0 ? (
        <div className="empty">No scans yet.</div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th className="num">Found</th>
              <th className="num">New</th>
              <th className="num">Updated</th>
              <th className="num">Unavailable</th>
              <th className="num">Courses</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((s) => (
              <tr key={s.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {formatCompact(s.startedAt)}
                </td>
                <td>
                  <ScanStatus status={s.status} isBaseline={s.isBaseline} />
                </td>
                <td className="num muted">{s.discoveredCount}</td>
                <td className="num muted">{s.newCount}</td>
                <td className="num muted">{s.updatedCount}</td>
                <td className="num muted">{s.unavailableCount}</td>
                <td className="num muted">
                  {s.coursesScanned}
                  {s.coursesFailed > 0 && <span className="faint"> / {s.coursesFailed} failed</span>}
                </td>
                <td className="muted small" style={{ maxWidth: 260 }}>
                  {s.errorSummary ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

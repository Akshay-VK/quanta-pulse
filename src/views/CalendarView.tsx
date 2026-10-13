// Calendar-based daily activity browser.
//
// One canonical source drives everything: change events. The visible month is
// fetched with `events_range` (dots on each local-calendar day) and the
// selected day's summary uses `daily_digest`, which scopes its sync metadata to
// the chosen local date. Both group by local calendar days, never UTC strings.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  buildMonthGrid,
  clampDayToMonth,
  dayKeyOf,
  dayKeyToDate,
  dotKinds,
  eventKindMeta,
  groupEventsByDay,
  isSameMonth,
  monthLabel,
  longDayLabel,
  todayKey,
  type YearMonth,
} from "../lib/events";
import { formatCompact, formatTimeOfDay, relativeLabel } from "../lib/format";
import { eventLinks } from "../lib/open";
import type { ChangeEvent, Course, Digest } from "../lib/types";
import PageHeader from "../components/PageHeader";
import OpenActions from "../components/OpenActions";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

interface Props {
  /** App-level change events — a new identity arrives after every refresh/sync. */
  events: ChangeEvent[];
  courses: Course[];
  onOpen: (url: string) => void;
}

function initialState() {
  const now = new Date();
  return {
    cursor: { year: now.getFullYear(), month: now.getMonth() } as YearMonth,
    selected: todayKey(),
  };
}

export default function CalendarView({ events, courses, onOpen }: Props) {
  const [{ cursor, selected }, setState] = useState(initialState);
  const [monthEvents, setMonthEvents] = useState<ChangeEvent[] | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const selectedDay = Number(selected.split("-")[2]) || 1;

  // Fetch the visible month (for activity dots) whenever it or the data changes.
  useEffect(() => {
    let cancelled = false;
    setMonthEvents(null);
    const from = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const to = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    void (async () => {
      try {
        const events = await api.eventsRange(from, to);
        if (!cancelled) setMonthEvents(events);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cursor, events]);

  // Fetch the selected day's summary whenever its key (or the data) changes.
  useEffect(() => {
    let cancelled = false;
    setDigest(null);
    void (async () => {
      try {
        const digest = await api.dailyDigest(selected);
        if (!cancelled) setDigest(digest);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, events]);

  const byDay = useMemo(() => groupEventsByDay(monthEvents ?? []), [monthEvents]);
  const weeks = useMemo(() => buildMonthGrid(cursor), [cursor]);

  /** Select a day, moving the visible month to it when it lies outside. */
  function select(key: string) {
    setState((prev) => {
      const d = dayKeyToDate(key);
      const next: YearMonth = { year: d.getFullYear(), month: d.getMonth() };
      return { cursor: isSameMonth(d, prev.cursor) ? prev.cursor : next, selected: key };
    });
  }

  /** Previous/next month, preserving the day-of-month when possible. */
  function shiftMonth(delta: number) {
    setState((prev) => {
      const base = new Date(prev.cursor.year, prev.cursor.month + delta, 1);
      const next: YearMonth = { year: base.getFullYear(), month: base.getMonth() };
      return { cursor: next, selected: clampDayToMonth(next.year, next.month, selectedDay) };
    });
  }

  /** The Today button selects the actual local date. */
  function goToday() {
    const key = todayKey();
    const d = dayKeyToDate(key);
    setState({ cursor: { year: d.getFullYear(), month: d.getMonth() }, selected: key });
  }

  /** Move the selection by whole days, crossing month edges when needed. */
  function moveBy(deltaDays: number) {
    setState((prev) => {
      const d = dayKeyToDate(prev.selected);
      d.setDate(d.getDate() + deltaDays);
      const key = dayKeyOf(d);
      const next: YearMonth = { year: d.getFullYear(), month: d.getMonth() };
      return { cursor: isSameMonth(d, prev.cursor) ? prev.cursor : next, selected: key };
    });
  }

  // Roving tabindex: after an arrow/keyboard move, focus the newly selected day.
  useEffect(() => {
    const btn = dayButtons.current.get(selected);
    if (btn && document.activeElement?.closest(".calendar")) btn.focus();
  }, [selected]);

  const digestReady = digest && digest.items.length > 0;

  return (
    <div>
      <PageHeader
        title="Activity calendar"
        subtitle="Browse detected changes day by day — click any date to inspect it"
      />

      {error && <div className="alert error">{error}</div>}

      <div className="calendar-layout">
        <section className="calendar" aria-label="Month calendar">
          <div className="calendar-head">
            <button type="button" className="btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <h2 className="calendar-title mono">{monthLabel(cursor)}</h2>
            <button type="button" className="btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
              ›
            </button>
            <button type="button" className="btn calendar-today" onClick={goToday}>
              Today
            </button>
          </div>

          <div className="calendar-weekdays" role="row">
            {WEEKDAYS.map((d) => (
              <div key={d} className="calendar-weekday" role="columnheader">
                {d}
              </div>
            ))}
          </div>

          <div className="calendar-grid" role="grid" aria-label={`${monthLabel(cursor)} calendar`}>
            {weeks.flat().map((date) => {
              const inMonth = isSameMonth(date, cursor);
              const key = dayKeyOf(date);
              const isToday = key === todayKey();
              const isSelected = key === selected;
              const kinds = dotKinds(byDay.get(key) ?? []);
              const count = (byDay.get(key) ?? []).length;
              const label = `${longDayLabel(key)}${
                count ? `, ${count} change${count === 1 ? "" : "s"}` : ", no activity"
              }${isToday ? ", today" : ""}`;
              return (
                <div key={key} role="gridcell">
                  <button
                    ref={(el) => {
                      if (el) dayButtons.current.set(key, el);
                      else dayButtons.current.delete(key);
                    }}
                    type="button"
                    className={`calendar-day${inMonth ? "" : " out-month"}${isToday ? " today" : ""}${
                      isSelected ? " selected" : ""
                    }`}
                    aria-label={label}
                    aria-selected={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => select(key)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        moveBy(-1);
                      } else if (e.key === "ArrowRight") {
                        e.preventDefault();
                        moveBy(1);
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        moveBy(-7);
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        moveBy(7);
                      } else if (e.key === "PageUp") {
                        e.preventDefault();
                        shiftMonth(-1);
                      } else if (e.key === "PageDown") {
                        e.preventDefault();
                        shiftMonth(1);
                      } else if (e.key === "Home") {
                        e.preventDefault();
                        goToday();
                      }
                    }}
                  >
                    <span className="calendar-day-num mono">{date.getDate()}</span>
                    {count > 0 && (
                      <span className="calendar-dots" aria-hidden="true">
                        {kinds.map((kind) => (
                          <span key={kind} className={`cal-dot ${eventKindMeta(kind).dot}`} />
                        ))}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="calendar-legend">
            <Legend label="New upload" tone="text-cyan" dot="ev-new" />
            <Legend label="Announcement" tone="text-violet" dot="ev-announcement" />
            <Legend label="Updated" tone="text-amber" dot="ev-updated" />
            <Legend label="Deadline" tone="text-amber" dot="ev-deadline" />
            <Legend label="Unavailable" tone="text-danger" dot="ev-unavailable" />
          </div>
        </section>

        <section className="day-panel" aria-label="Selected day activity" aria-live="polite">
          <h2 className="day-title mono">{longDayLabel(selected)}</h2>

          {!digest ? (
            <div className="empty">Loading daily summary…</div>
          ) : (
            <>
              <dl className="day-summary">
                <div className="kv">
                  <dt className="k">
                    <span className="cal-dot ev-new" aria-hidden="true" /> New uploads
                  </dt>
                  <dd className="num text-cyan">{digest.newCount}</dd>
                </div>
                <div className="kv">
                  <dt className="k">
                    <span className="cal-dot ev-updated" aria-hidden="true" /> Updated resources
                  </dt>
                  <dd className="num text-amber">{digest.updatedCount}</dd>
                </div>
                <div className="kv">
                  <dt className="k">
                    <span className="cal-dot ev-announcement" aria-hidden="true" /> Announcements
                  </dt>
                  <dd className="num text-violet">{digest.announcementCount}</dd>
                </div>
                <div className="kv">
                  <dt className="k">
                    <span className="cal-dot ev-deadline" aria-hidden="true" /> Deadlines
                  </dt>
                  <dd className="num text-amber">{digest.deadlineCount}</dd>
                </div>
                <div className="kv">
                  <dt className="k">
                    <span className="cal-dot ev-unavailable" aria-hidden="true" /> Unavailable resources
                  </dt>
                  <dd className={`num ${digest.unavailableCount > 0 ? "text-danger" : ""}`}>
                    {digest.unavailableCount}
                  </dd>
                </div>
                <div className="kv">
                  <dt className="k">Courses that could not be scanned</dt>
                  <dd className={`num ${digest.coursesFailed > 0 ? "text-danger" : ""}`}>
                    {digest.coursesFailed}
                  </dd>
                </div>
                <div className="kv">
                  <dt className="k">Last successful sync</dt>
                  <dd>
                    {digest.lastSuccessAt
                      ? `${formatCompact(digest.lastSuccessAt)} (${relativeLabel(digest.lastSuccessAt)})`
                      : "none"}
                  </dd>
                </div>
              </dl>

              <div className="section-title day-events-title">Events</div>
              {!digestReady ? (
                <div className="empty">No activity recorded for this day.</div>
              ) : (
                <table className="grid">
                  <tbody>
                    {digest.items.map((e) => {
                      const meta = eventKindMeta(e.changeType);
                      const course = e.courseId != null ? courseById.get(e.courseId) : undefined;
                      const code = course?.shortName ?? null;
                      const full = course?.name ?? e.courseName;
                      return (
                        <tr key={e.id}>
                          <td style={{ width: 120 }}>
                            <span className={`label ${meta.id}`}>{meta.label}</span>
                          </td>
                          <td>
                            <span title={e.description ?? undefined}>{e.resourceTitle ?? e.title}</span>
                            {(code || full) && (
                              <div className="faint small mono">
                                {code && <span className="text-cyan">{code}</span>}
                                {code && full && <span>{" · "}</span>}
                                {full && <span>{full}</span>}
                                {e.sectionPath && e.sectionPath.length > 0 && <div>{e.sectionPath.join(" → ")}</div>}
                              </div>
                            )}
                          </td>
                          <td className="muted mono" style={{ whiteSpace: "nowrap" }}>
                            {formatTimeOfDay(e.detectedAt)}
                            <div className="faint small">{relativeLabel(e.detectedAt)}</div>
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <OpenActions links={eventLinks(e)} onOpen={onOpen} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Legend({ label, tone, dot }: { label: string; tone: string; dot: string }) {
  return (
    <span className={`calendar-legend-item ${tone}`}>
      <span className={`cal-dot ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

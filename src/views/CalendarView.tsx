// Calendar: activity by day plus a digest of the selected day.
//
// The visible month is fetched with `events_range` (dots on each local-calendar
// day) and the selected day's summary with `daily_digest`, which scopes its sync
// metadata to the chosen local date. Both group by local calendar days, never
// UTC strings.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import {
  EVENT_KINDS,
  addMonths,
  buildMonthGrid,
  clampDayToMonth,
  dayKeyOf,
  dayKeyToDate,
  dotKinds,
  eventKindMeta,
  groupEventsByDay,
  isSameMonth,
  localDayKey,
  longDayLabel,
  monthLabel,
  summarizeEvents,
  todayKey,
  type EventCounts,
  type YearMonth,
} from "../lib/events";
import { formatCompact, formatTimeOfDay, relativeLabel } from "../lib/format";
import { courseTitle } from "../lib/courseName";
import { eventLinks, primaryUrl } from "../lib/open";
import type { ChangeEvent, Course, Digest } from "../lib/types";
import PageHeader from "../components/PageHeader";
import ResourceRow from "../components/ResourceRow";
import StatBlock from "../components/StatBlock";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { IconButton } from "../components/ui/IconButton";
import { Skeleton } from "../components/ui/Skeleton";
import type { StatusKind } from "../components/ui/StatusTag";

export interface CalendarViewProps {
  courses: Course[];
  onOpen: (url: string) => void;
  onOpenScan: () => void;
  /** Opens a course page from a row's course pill. */
  onOpenCourse?: (courseId: number) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const STATUS_KIND: Record<string, StatusKind> = {
  new: "new",
  updated: "updated",
  deadline: "deadline",
  announcement: "note",
  unavailable: "unavailable",
  restored: "restored",
};

function noop(): void {
  return undefined;
}

function openLabel(changeType: string): string {
  if (changeType === "deadline") return "Open course";
  if (changeType === "announcement") return "Read post";
  return "Open file";
}

function monthBounds({ year, month }: YearMonth): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}` };
}

interface ViewState {
  cursor: YearMonth;
  selected: string;
}

function initialView(): ViewState {
  const now = new Date();
  return { cursor: { year: now.getFullYear(), month: now.getMonth() }, selected: todayKey() };
}

/** "13 October, 4 new, 1 deadline" for a day cell's aria-label. */
function dayAriaLabel(key: string, events: ChangeEvent[]): string {
  const counts = summarizeEvents(events);
  const order: [keyof EventCounts, string][] = [
    ["new", "new"],
    ["updated", "updated"],
    ["announcement", "announcement"],
    ["deadline", "deadline"],
    ["unavailable", "unavailable"],
    ["restored", "restored"],
  ];
  const parts: string[] = [];
  for (const [kind, word] of order) {
    const n = counts[kind] as number;
    if (n > 0) parts.push(`${n} ${word}${n === 1 ? "" : "s"}`);
  }
  return `${longDayLabel(key)}, ${parts.length > 0 ? parts.join(", ") : "no activity"}`;
}

export default function CalendarView({ courses, onOpen, onOpenScan, onOpenCourse }: CalendarViewProps) {
  const [{ cursor, selected }, setView] = useState<ViewState>(initialView);
  const [monthEvents, setMonthEvents] = useState<ChangeEvent[] | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [monthError, setMonthError] = useState(false);
  const [dayError, setDayError] = useState(false);
  const [reload, setReload] = useState(0);

  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const panelRef = useRef<HTMLHeadingElement>(null);
  const focusSelected = useRef(false);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  useEffect(() => {
    let cancelled = false;
    setMonthEvents(null);
    setMonthError(false);
    const { from, to } = monthBounds(cursor);
    void api
      .eventsRange(from, to)
      .then((events) => {
        if (!cancelled) setMonthEvents(events);
      })
      .catch(() => {
        if (!cancelled) setMonthError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, reload]);

  useEffect(() => {
    let cancelled = false;
    setDigest(null);
    setDayError(false);
    void api
      .dailyDigest(selected)
      .then((next) => {
        if (!cancelled) setDigest(next);
      })
      .catch(() => {
        if (!cancelled) setDayError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, reload]);

  const byDay = useMemo(() => groupEventsByDay(monthEvents ?? []), [monthEvents]);
  const weeks = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const today = todayKey();

  useEffect(() => {
    if (!focusSelected.current) return;
    focusSelected.current = false;
    dayButtons.current.get(selected)?.focus();
  }, [selected]);

  /** Select a day, moving the visible month to it when it lies outside. */
  function select(key: string) {
    // The grid remounts when the month switches, so focus must follow the
    // selection for the clicked cell not to lose it.
    focusSelected.current = true;
    setView((prev) => {
      const d = dayKeyToDate(key);
      return {
        cursor: isSameMonth(d, prev.cursor)
          ? prev.cursor
          : { year: d.getFullYear(), month: d.getMonth() },
        selected: key,
      };
    });
  }

  /** Previous/next month, preserving the day-of-month when possible. */
  function shiftMonth(delta: number) {
    setView((prev) => {
      const next = addMonths(prev.cursor, delta);
      const day = dayKeyToDate(prev.selected).getDate();
      return { cursor: next, selected: clampDayToMonth(next.year, next.month, day) };
    });
  }

  function goToday() {
    const key = todayKey();
    setView(() => {
      const d = dayKeyToDate(key);
      return { cursor: { year: d.getFullYear(), month: d.getMonth() }, selected: key };
    });
  }

  /** Move the selection by whole days, following it across month edges. */
  function moveBy(deltaDays: number) {
    focusSelected.current = true;
    setView((prev) => {
      const d = dayKeyToDate(prev.selected);
      d.setDate(d.getDate() + deltaDays);
      return {
        cursor: isSameMonth(d, prev.cursor)
          ? prev.cursor
          : { year: d.getFullYear(), month: d.getMonth() },
        selected: dayKeyOf(d),
      };
    });
  }

  const lastSync = digest?.lastSuccessAt ?? null;
  const scannedToday = lastSync != null && localDayKey(lastSync) === selected;

  return (
    <div>
      {/* The month is named in the toolbar below; repeating it as a caption
          above the title read as a duplicate heading. */}
      <PageHeader title="Calendar" />

      {(monthError || dayError) && (
        <Banner kind="error" action={{ label: "Try again", onClick: () => setReload((n) => n + 1) }}>
          Could not load calendar
        </Banner>
      )}

      <div className="cal-layout">
        <section className="cal-main" aria-label="Month calendar">
          <div className="cal-header">
            <h2 className="cal-month-title">{monthLabel(cursor)}</h2>
            <IconButton label="Previous month" size={32} onClick={() => shiftMonth(-1)}>
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            <IconButton label="Next month" size={32} onClick={() => shiftMonth(1)}>
              <ChevronRight aria-hidden="true" />
            </IconButton>
            <span className="cal-header-spacer" />
            <Button variant="secondary" size="sm" onClick={goToday}>
              Today
            </Button>
          </div>

          <div className="cal-weekdays">
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-weekday">
                {d}
              </div>
            ))}
          </div>

          {/* Remount per month so the grid cross-fades (dot-in keyframes) on
            * change, never sliding. Reduced motion zeroes the duration. */}
          <div
            key={`${cursor.year}-${cursor.month}`}
            className="cal-grid"
            style={{ animation: "dot-in var(--dur-base) var(--ease-inout)" }}
            role="grid"
            aria-label={`${monthLabel(cursor)} calendar`}
          >
            {weeks.map((week, index) => (
              <div className="cal-row" role="row" key={`week-${index}`}>
                {week.map((date) => {
                  const inMonth = isSameMonth(date, cursor);
                  const key = dayKeyOf(date);
                  const isToday = key === today;
                  const isSelected = key === selected;
                  const events = inMonth ? byDay.get(key) ?? [] : [];
                  const kinds = inMonth ? dotKinds(events, 3) : [];
                  const count = events.length;
                  return (
                    <button
                      key={key}
                      ref={(el) => {
                        if (el) dayButtons.current.set(key, el);
                        else dayButtons.current.delete(key);
                      }}
                      type="button"
                      role="gridcell"
                      className={`cal-day${inMonth ? "" : " outside"}${isToday ? " cal-day-today" : ""}${
                        isSelected ? " selected" : ""
                      }`}
                      aria-label={dayAriaLabel(key, events) + (isToday ? ", today" : "")}
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
                          focusSelected.current = true;
                          shiftMonth(-1);
                        } else if (e.key === "PageDown") {
                          e.preventDefault();
                          focusSelected.current = true;
                          shiftMonth(1);
                        } else if (e.key === "Home") {
                          e.preventDefault();
                          focusSelected.current = true;
                          goToday();
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          panelRef.current?.focus();
                        }
                      }}
                    >
                      <span className="cal-num">{date.getDate()}</span>
                      {count > 0 && (
                        <span className="cal-dots" aria-hidden="true">
                          {kinds.map((kind) => (
                            <span key={kind} className={`cal-dot ${eventKindMeta(kind).dot}`} />
                          ))}
                          {count > 3 && (
                            <span className="cal-more">
                              {count - 3 > 99 ? "99+" : `+${count - 3}`}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="cal-legend">
            {EVENT_KINDS.map((kind) => (
              <span key={kind.id} className="cal-legend-item">
                <span className={`cal-dot ${kind.dot}`} aria-hidden="true" />
                {kind.label}
              </span>
            ))}
          </div>
        </section>

        <section className="cal-panel" aria-label="Selected day activity" aria-live="polite">
          <h2 className="cal-panel-title" tabIndex={-1} ref={panelRef}>
            {longDayLabel(selected)}
          </h2>

          {dayError ? null : digest === null ? (
            <Skeleton rows={4} />
          ) : (
            <>
              <div className="stat-grid">
                <StatBlock label="New" value={digest.newCount} />
                <StatBlock label="Updated" value={digest.updatedCount} />
                <StatBlock label="Announcements" value={digest.announcementCount} />
                <StatBlock label="Deadlines" value={digest.deadlineCount} />
                <StatBlock label="Unavailable" value={digest.unavailableCount} />
                <StatBlock label="Courses failed" value={digest.coursesFailed} />
              </div>

              {digest.coursesFailed > 0 && (
                <Banner kind="error" action={{ label: "View scan", onClick: onOpenScan }}>
                  {digest.coursesFailed} course{digest.coursesFailed === 1 ? "" : "s"} failed in the last
                  scan
                </Banner>
              )}

              <p className="cal-sync-line">
                Last successful sync{" "}
                {lastSync ? `${formatCompact(lastSync)} (${relativeLabel(lastSync)})` : "None yet"}
              </p>

              {digest.items.length === 0 ? (
                <EmptyState
                  title="No activity on this day"
                  body={scannedToday ? undefined : "No scans ran on this day"}
                />
              ) : (
                digest.items.map((e) => {
                  const meta = eventKindMeta(e.changeType);
                  const course = e.courseId != null ? courseById.get(e.courseId) : undefined;
                  const primary = primaryUrl(eventLinks(e));
                  return (
                    <ResourceRow
                      key={e.id}
                      title={e.resourceTitle ?? e.title}
                      type={e.resourceType}
                      courseId={e.courseId}
                      courseCode={courseTitle(e.courseId, course?.shortName ?? e.courseName ?? course?.name)}
                      courseName={e.courseName}
                      unread={!e.read}
                      selected={false}
                      unavailable={e.changeType === "unavailable"}
                      status={{ kind: STATUS_KIND[e.changeType] ?? "new", label: meta.label }}
                      timeLabel={formatTimeOfDay(e.detectedAt)}
                      onCourse={
                        e.courseId != null && onOpenCourse
                          ? () => onOpenCourse(e.courseId as number)
                          : undefined
                      }
                      openLabel={openLabel(e.changeType)}
                      showOpen={Boolean(primary)}
                      density="compact"
                      onSelect={noop}
                      onOpen={primary ? () => onOpen(primary) : undefined}
                      menu={[
                        ...(e.resourceUrl
                          ? [
                              {
                                id: "open-file",
                                label: "Open file",
                                icon: <ExternalLink aria-hidden="true" />,
                                onSelect: () => onOpen(e.resourceUrl as string),
                              },
                            ]
                          : []),
                        ...(e.sourcePageUrl
                          ? [
                              {
                                id: "open-page",
                                label: "Open Quanta page",
                                icon: <ExternalLink aria-hidden="true" />,
                                onSelect: () => onOpen(e.sourcePageUrl as string),
                              },
                            ]
                          : []),
                        {
                          id: "copy",
                          label: "Copy link",
                          icon: <Copy aria-hidden="true" />,
                          onSelect: () =>
                            void navigator.clipboard?.writeText(e.sourcePageUrl ?? e.resourceUrl ?? ""),
                        },
                      ]}
                    />
                  );
                })
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

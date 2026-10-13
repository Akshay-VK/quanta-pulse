interface Props {
  newCount: number;
  updatedCount: number;
  deadlineCount: number;
  unavailableCount: number;
  courseCount: number;
}

export default function Summary({
  newCount,
  updatedCount,
  deadlineCount,
  unavailableCount,
  courseCount,
}: Props) {
  const caughtUp = newCount === 0 && updatedCount === 0 && unavailableCount === 0;
  return (
    <div className="summary" aria-label="Activity summary">
      <div className="stat tone-cyan">
        <b>{newCount}</b>
        <span>new</span>
      </div>
      <div className="stat tone-amber">
        <b>{updatedCount}</b>
        <span>updated</span>
      </div>
      <div className="stat tone-amber">
        <b>{deadlineCount}</b>
        <span>upcoming deadlines</span>
      </div>
      <div className="stat tone-red">
        <b>{unavailableCount}</b>
        <span>unavailable</span>
      </div>
      <div className="stat tone-violet">
        <b>{courseCount}</b>
        <span>courses monitored</span>
      </div>
      {caughtUp && (
        <div className="caught-up">
          <span className="status-dot ok" />
          You&rsquo;re all caught up.
        </div>
      )}
    </div>
  );
}
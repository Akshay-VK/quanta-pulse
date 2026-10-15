import { cx } from "../lib/cx";

/**
 * The 2px sync bar at the top of <main>. Determinate when a percentage is
 * known, otherwise an indeterminate sweep. Decorative: SyncStatus carries the
 * announced state.
 */
export default function SyncProgress({
  running,
  progress = 0,
}: {
  running: boolean;
  progress?: number;
}) {
  if (!running) return null;
  const determinate = progress > 0;
  const percent = progress <= 1 ? progress * 100 : progress;
  return (
    <div
      className={cx("sync-progress", determinate ? "running" : "indeterminate")}
      aria-hidden="true"
    >
      <div
        className="sync-progress-inner"
        style={determinate ? { width: `${Math.min(100, percent)}%` } : undefined}
      />
    </div>
  );
}
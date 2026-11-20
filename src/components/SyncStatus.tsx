import { formatCompact, formatTimeOfDay } from "../lib/format";
import { cx } from "../lib/cx";
import { Tooltip } from "./ui/Tooltip";
import type { SyncStatus as SyncStatusModel } from "../lib/types";

/** Sidebar monitoring status and the time of the last successful scan. */
export default function SyncStatus({
  sync,
  onOpenScans,
  sessionExpired = false,
}: {
  sync: SyncStatusModel | null;
  onOpenScans?: () => void;
  sessionExpired?: boolean;
}) {
  const expired = sessionExpired || sync?.authState === "expired";
  const failed = Boolean(sync?.lastError);
  const running = Boolean(sync?.running);
  const dot = expired || failed ? "danger" : running ? "warn" : "ok";
  const copy = expired ? "Session expired" : running ? "Scanning" : failed ? "Scan failed" : sync ? "Monitoring" : "Checking…";
  const tooltip = [
    copy,
    sync?.lastSuccessAt ? `Last scan: ${formatCompact(sync.lastSuccessAt)}` : null,
    sync?.nextScheduledAt ? `Next scan: ${formatCompact(sync.nextScheduledAt)}` : null,
  ].filter(Boolean).join("\n");

  const content = (
    <>
      <span className={cx("sync-dot", dot, running && "pulsing")} aria-hidden="true" />
      <span className="sync-copy">{copy}</span>
      {sync?.lastSuccessAt && <span className="sync-time">{formatTimeOfDay(sync.lastSuccessAt)}</span>}
    </>
  );

  return (
    <Tooltip content={tooltip}>
      {failed && onOpenScans ? (
        <button type="button" className="sync-status" aria-label={copy} onClick={onOpenScans}>{content}</button>
      ) : (
        <div className="sync-status" role="status" aria-label={copy}>{content}</div>
      )}
    </Tooltip>
  );
}

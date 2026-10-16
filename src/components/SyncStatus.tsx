import { useEffect, useState } from "react";
import { formatCompact, relativeLabel } from "../lib/format";
import { cx } from "../lib/cx";
import { Tooltip } from "./ui/Tooltip";
import type { SyncStatus as SyncStatusModel } from "../lib/types";
import { useMirror } from "../hooks/useMirror";
import DownloadsPopover from "./DownloadsPopover";
import { formatBytes } from "../lib/format";

/**
 * The sidebar sync line: a coloured dot plus a short status. `onOpenScans` is
 * called when the status is an error, so the failure can be inspected.
 */
export default function SyncStatus({
  sync,
  onOpenScans,
}: {
  sync: SyncStatusModel | null;
  onOpenScans?: () => void;
}) {
  const [, setTick] = useState(0);
  const mirror = useMirror();

  // Keep the relative time honest without a re-fetch.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  let dot = "ok";
  let copy: string;
  let clickable = false;

  if (!sync) {
    copy = "Checking…";
  } else if (sync.running) {
    dot = "warn";
    copy = sync.phase && sync.phase !== "Starting" ? sync.phase : "Scanning";
  } else if (sync.authState === "expired") {
    dot = "danger";
    copy = "Session expired";
  } else if (sync.lastError) {
    dot = "danger";
    copy = "Last scan failed";
    clickable = Boolean(onOpenScans);
  } else {
    copy = sync.lastSuccessAt
      ? `Synced ${relativeLabel(sync.lastSuccessAt)}`
      : "Not synced yet";
  }

  const tooltip = sync
    ? [
        sync.lastSuccessAt ? `Last sync: ${formatCompact(sync.lastSuccessAt)}` : null,
        sync.nextScheduledAt ? `Next scan: ${formatCompact(sync.nextScheduledAt)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // Second line while the mirror has work. A finished scan does not stop the
  // queue, so this reads the queue state and not `sync.running`.
  const stats = mirror?.stats;
  const active = stats ? stats.queued + stats.downloading : 0;
  const downloadLine =
    stats && active > 0
      ? `Downloading ${stats.downloading} of ${active} · ${formatBytes(Math.max(0, stats.bytesTotal - stats.bytesDone))} remaining`
      : null;

  const body = (
    <div
      className="sync-status"
      onClick={clickable ? onOpenScans : undefined}
      style={clickable ? { cursor: "pointer" } : undefined}
    >
      <span className={cx("sync-dot", dot, sync?.running && "pulsing")} aria-hidden="true" />
      <span className="sync-copy">{copy}</span>
      {downloadLine && (
        <>
          <span className="sync-copy sync-downloading" aria-live="polite">
            {downloadLine}
          </span>
          <DownloadsPopover />
        </>
      )}
    </div>
  );

  return <Tooltip content={tooltip}>{body}</Tooltip>;
}
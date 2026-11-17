import { RotateCcw, ChevronDown } from "lucide-react";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Popover } from "./ui/Popover";
import { formatBytes } from "../lib/format";
import { useMirror } from "../hooks/useMirror";
import { api } from "../lib/api";

export default function DownloadsPopover() {
  const mirror = useMirror();
  const stats = mirror?.stats;
  if (!mirror || !stats) return null;

  const pending = stats.downloading + stats.queued;
  const paused = stats.state === "paused";
  const active = [...mirror.downloads.values()].filter((item) => item.state === "queued" || item.state === "downloading");
  const failed = [...mirror.downloads.values()].filter((item) => item.state === "failed");

  return (
    <Popover
      label="Downloads"
      align="end"
      trigger={
        <IconButton label="Open downloads" size={28} tooltip={false}>
          <ChevronDown aria-hidden="true" />
          {pending > 0 && <span className="downloads-badge">{pending}</span>}
        </IconButton>
      }
    >
      <div className="downloads-popover">
        <div className="popover-header">
          <h3>Downloads</h3>
        </div>

        <div className="popover-stats">
          <div className="stat-row">
            <span className="stat-label">Active</span>
            <span className="stat-value">{stats.downloading}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Queued</span>
            <span className="stat-value">{stats.queued}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Completed</span>
            <span className="stat-value">{stats.done}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Failed</span>
            <span className="stat-value stat-bad">{stats.failed}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Remaining</span>
            <span className="stat-value">
              {formatBytes(stats.bytesTotal - stats.bytesDone) || "0 B"}
            </span>
          </div>
        </div>

        {active.length > 0 && (
          <div className="downloads-active">
            {active.map((item) => (
              <div key={item.resourceId} className="download-row">
                <span className="mono">Resource {item.resourceId}</span>
                <progress value={item.bytesDone} max={item.bytesTotal ?? item.bytesDone ?? 1} />
                <span className="muted">
                  {formatBytes(item.bytesDone)}
                  {item.bytesTotal ? ` / ${formatBytes(item.bytesTotal)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {pending > 0 && (
          <div className="popover-actions">
            <Button
              variant={paused ? "primary" : "secondary"}
              size="sm"
              onClick={() => void (paused ? mirror.resume() : mirror.pause())}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
          </div>
        )}

        {failed.length > 0 && (
          <div className="popover-failed">
            {failed.map((item) => (
              <div key={item.resourceId} className="download-failed-row">
                <span className="mono">Resource {item.resourceId}</span>
                {item.error && <span className="muted">{item.error}</span>}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void mirror.retryDownload(item.resourceId)}
                >
                  <RotateCcw aria-hidden="true" />
                  Retry
                </Button>
              </div>
            ))}
            <Button
              variant="primary"
              size="sm"
              className="retry-all"
              onClick={() => void mirror.retryFailed()}
            >
              <RotateCcw aria-hidden="true" />
              Retry all
            </Button>
          </div>
        )}

        <div className="downloads-footer">
          <Button variant="ghost" size="sm" onClick={() => void api.openAppFolder("mirror")}>
            Open folder
          </Button>
        </div>
      </div>
    </Popover>
  );
}

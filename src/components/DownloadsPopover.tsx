import { RotateCcw, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Popover } from "./ui/Popover";
import { formatBytes } from "../lib/format";
import { useMirror } from "../hooks/useMirror";

/**
 * The downloads popover: queue progress, the Pause/Resume control and the
 * failed count with 'Retry all'. Anchored to the chevron beside the sidebar's
 * second sync line, so it only mounts while the mirror has something to say.
 */
export default function DownloadsPopover() {
  const mirror = useMirror();
  const [expandedFailed, setExpandedFailed] = useState(false);
  const stats = mirror?.stats;
  if (!mirror || !stats) return null;

  const pending = stats.downloading + stats.queued;
  const paused = stats.state === "paused";

  return (
    <Popover
      label="Downloads"
      align="end"
      trigger={
        <IconButton label="Open downloads" size={28} tooltip={false}>
          <ChevronDown aria-hidden="true" />
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

        {stats.failed > 0 && (
          <div className="popover-failed">
            <Button
              variant="ghost"
              size="sm"
              className="failed-toggle"
              aria-expanded={expandedFailed}
              onClick={() => setExpandedFailed((v) => !v)}
            >
              {stats.failed} failed {expandedFailed ? "▲" : "▼"}
            </Button>
            {expandedFailed && (
              <div className="failed-list">
                <p className="failed-note">
                  These files could not be downloaded. Fix the issue and retry.
                </p>
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
          </div>
        )}
      </div>
    </Popover>
  );
}

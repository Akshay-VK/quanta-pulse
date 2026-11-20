import { Download, FolderOpen, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { FileTypeIcon } from "./ui/FileTypeIcon";
import { IconButton } from "./ui/IconButton";
import { Popover } from "./ui/Popover";
import { useMirror } from "../hooks/useMirror";
import { api } from "../lib/api";
import type { MirrorDownloadProgress, Resource } from "../lib/types";

function DownloadName({ item, resource }: { item: MirrorDownloadProgress; resource?: Resource }) {
  const title = resource?.title ?? `Resource ${item.resourceId}`;
  return (
    <>
      <FileTypeIcon type={resource?.resourceType ?? null} />
      <span className="download-name" title={title}>{title}</span>
    </>
  );
}

export default function DownloadsPopover({ resources = [] }: { resources?: Resource[] }) {
  const mirror = useMirror();
  if (!mirror) return null;

  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const active = [...mirror.downloads.values()].filter((item) => item.state === "queued" || item.state === "downloading");
  const failed = [...mirror.downloads.values()].filter((item) => item.state === "failed");
  const count = active.length + failed.length;

  return (
    <Popover
      label="Downloads"
      className="downloads-popover-surface"
      align="end"
      trigger={
        <IconButton className="downloads-trigger" label="Open downloads" size={28} tooltip={false}>
          <Download aria-hidden="true" />
          {count > 0 && <span className="downloads-badge">{count}</span>}
        </IconButton>
      }
    >
      <div className="downloads-popover">
        <h3 className="downloads-title">Downloads</h3>
        {active.length > 0 && (
          <section className="downloads-group" aria-label="Active">
            <h4>Active</h4>
            {active.map((item) => {
              const total = item.bytesTotal;
              const percent = total && total > 0 ? Math.min(100, Math.round(item.bytesDone / total * 100)) : undefined;
              const label = byId.get(item.resourceId)?.title ?? `Resource ${item.resourceId}`;
              return (
                <div key={item.resourceId} className="download-popover-active">
                  <div className="download-popover-item">
                    <DownloadName item={item} resource={byId.get(item.resourceId)} />
                    <span className="download-meta">
                      {item.state === "queued" ? "Queued" : percent != null ? `${percent}%` : "Downloading"}
                    </span>
                  </div>
                  {item.state === "downloading" && (
                    <progress aria-label={`Download progress for ${label}`} value={percent} max={100} />
                  )}
                </div>
              );
            })}
          </section>
        )}
        {failed.length > 0 && (
          <section className="downloads-group" aria-label="Failed">
            <h4>Failed</h4>
            {failed.map((item) => (
              <div key={item.resourceId} className="download-popover-item">
                <DownloadName item={item} resource={byId.get(item.resourceId)} />
                <span className="download-meta download-meta-failed" title={item.error ?? undefined}>Failed</span>
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<RotateCcw aria-hidden="true" />}
                  onClick={() => void mirror.retryDownload(item.resourceId).catch(() => {})}
                >
                  Retry
                </Button>
              </div>
            ))}
          </section>
        )}
        {count === 0 && <p className="downloads-empty">No active downloads</p>}
        <div className="downloads-footer">
          <Button variant="ghost" size="sm" leadingIcon={<FolderOpen aria-hidden="true" />} onClick={() => void api.openAppFolder("mirror")}>
            Open folder
          </Button>
        </div>
      </div>
    </Popover>
  );
}

import { materialSource } from "../lib/materialActions";
import { useEffect, useState } from "react";
import { ExternalLink, X, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "../lib/api";
import { fileTone } from "../lib/filetype";
import { formatBytes } from "../lib/format";
import { cx } from "../lib/cx";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

import { Skeleton } from "./ui/Skeleton";
import { FileTypeIcon } from "./ui/FileTypeIcon";
import type { Resource, ResourcePreview } from "../lib/types";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string; auth: boolean }
  | { status: "ready"; preview: ResourcePreview; objectUrl: string | null };

function base64ToArrayBuffer(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function binaryObjectUrl(preview: Extract<ResourcePreview, { kind: "binary" }>): string {
  return URL.createObjectURL(
    new Blob([base64ToArrayBuffer(preview.data)], { type: preview.mime }),
  );
}

function isAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("session expired") || m.includes("sign in") || m.includes("auth");
}

/**
 * On-demand, in-app preview of one resource. Content is fetched through the
 * authenticated Rust session only while the dialog is open and is never
 * persisted. Preview leases in `state.rs` are unchanged.
 */
export default function PreviewDialog({
  resource,
  open,
  onOpenChange,
  onOpen,
  onOpenLocal,
  onRevealLocal,
}: {
  resource: Resource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (url: string) => void;
  onOpenLocal?: (resourceId: number) => void;
  onRevealLocal?: (resourceId: number) => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open || !resource) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setState({ status: "loading" });
    setZoom(1);
    api
      .previewResource(resource.id)
      .then((preview) => {
        if (cancelled) return;
        if (preview.kind === "binary") {
          createdUrl = binaryObjectUrl(preview);
          setState({ status: "ready", preview, objectUrl: createdUrl });
        } else {
          setState({ status: "ready", preview, objectUrl: null });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", message, auth: isAuthError(message) });
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, resource, retryKey]);

  if (!resource) return null;

  const retry = () => setRetryKey((k) => k + 1);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      className="preview-dialog"
      labelledBy="preview-title"
    >
      <div className="preview-head">
        <FileTypeIcon type={resource.resourceType} />
        <span className="preview-title" id="preview-title" title={resource.title}>
          {resource.title}
        </span>
        <span className={cx("file-tone", fileTone(resource.resourceType))}>
          <span className="file-dot" aria-hidden="true" />
          {resource.resourceType || "File"}
        </span>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<ExternalLink aria-hidden="true" />}
          onClick={() => materialSource(resource) && onOpen(materialSource(resource)!)}
        >
          Open in Quanta
        </Button>
        <IconButton label="Close preview" size={28} onClick={() => onOpenChange(false)}>
          <X aria-hidden="true" />
        </IconButton>
      </div>

      <div className="preview-body">{renderBody(state, resource, onOpen, retry, zoom, setZoom, onOpenLocal, onRevealLocal)}</div>
    </Dialog>
  );
}

function renderBody(
  state: PreviewState,
  resource: Resource,
  onOpen: (url: string) => void,
  retry: () => void,
  zoom: number,
  setZoom: (n: number) => void,
  onOpenLocal?: (resourceId: number) => void,
  onRevealLocal?: (resourceId: number) => void,
) {
  if (state.status === "loading") {
    return (
      <div className="preview-skeleton">
        <Skeleton rows={6} />
        <span className="preview-loading-label">Opening {resource.title}…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="preview-status preview-error" role="alert">
        <p>Couldn't load the preview</p>
        <p className="preview-error-detail">{state.message}</p>
        <Button variant="secondary" onClick={retry}>
          {state.auth ? "Reconnect" : "Retry"}
        </Button>
        <Button variant="secondary" onClick={() => materialSource(resource) && onOpen(materialSource(resource)!)}>
          Open in Quanta
        </Button>
      </div>
    );
  }

  const { preview, objectUrl } = state;
  const fallbackActions = (
    <>
      {onOpenLocal ? (
        <Button variant="secondary" onClick={() => onOpenLocal(resource.id)}>Open saved copy</Button>
      ) : (
        <Button variant="secondary" onClick={() => materialSource(resource) && onOpen(materialSource(resource)!)}>Open in Quanta</Button>
      )}
      {onRevealLocal && (
        <Button variant="secondary" onClick={() => onRevealLocal(resource.id)}>Show in folder</Button>
      )}
    </>
  );
  switch (preview.kind) {
    case "text":
      return preview.text.trim() ? (
        <pre className="preview-text preview-reading-column">{preview.text}</pre>
      ) : (
        <div className="preview-status">
          This page has no readable text. Open the original to see it in full.
        </div>
      );
    case "binary":
      return renderBinary(preview, objectUrl, zoom, setZoom);
    case "unsupported":
      return (
        <div className="preview-status preview-unsupported">
          <p>{preview.reason || "Preview isn't available for this file."}</p>
          {fallbackActions}
        </div>
      );
    case "tooLarge":
      return (
        <div className="preview-status preview-oversized">
          <p>This file is too large to preview in-app{preview.sizeBytes ? ` (${formatBytes(preview.sizeBytes)})` : ""}.</p>
          {fallbackActions}
        </div>
      );
  }
}

function renderBinary(
  preview: Extract<ResourcePreview, { kind: "binary" }>,
  objectUrl: string | null,
  zoom: number,
  setZoom: (n: number) => void,
) {
  if (!objectUrl) return <div className="preview-status">Preparing preview&hellip;</div>;
  switch (preview.mode) {
    case "pdf":
      // ponytail: the WebView's native PDF viewer already has thumbnails, search
      // and page navigation; add pdf.js (D06) only if custom in-app rail/search
      // is required and native packaged proof shows a gap.
      return (
        <div className="preview-pdf">
          <iframe className="preview-frame" src={objectUrl} title="PDF preview" />
        </div>
      );
    case "image":
      return (
        <div className="preview-image-wrap">
          <div className="preview-zoom-controls">
            <IconButton label="Zoom in" size={28} onClick={() => setZoom(Math.min(4, zoom + 0.25))}>
              <ZoomIn aria-hidden="true" />
            </IconButton>
            <IconButton label="Zoom out" size={28} onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}>
              <ZoomOut aria-hidden="true" />
            </IconButton>
            <Button variant="secondary" size="sm" onClick={() => setZoom(1)}>100%</Button>
          </div>
          <img className="preview-image" src={objectUrl} alt="Resource preview" style={{ transform: `scale(${zoom})`, transformOrigin: "center" }} />
        </div>
      );
    case "audio":
      return (
        <audio className="preview-media" controls src={objectUrl}>
          Your browser cannot play this audio.
        </audio>
      );
    case "video":
      return (
        <video className="preview-media" controls src={objectUrl}>
          Your browser cannot play this video.
        </video>
      );
  }
}

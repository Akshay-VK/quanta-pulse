import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { api } from "../lib/api";
import { fileTone } from "../lib/filetype";
import { formatBytes } from "../lib/format";
import { cx } from "../lib/cx";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Banner } from "./ui/Banner";
import { Skeleton } from "./ui/Skeleton";
import { FileTypeIcon } from "./ui/FileTypeIcon";
import type { Resource, ResourcePreview } from "../lib/types";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
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
}: {
  resource: Resource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (url: string) => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    if (!open || !resource) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setState({ status: "loading" });
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
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, resource]);

  if (!resource) return null;

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
          onClick={() => onOpen(resource.url)}
        >
          Open in Quanta
        </Button>
        <IconButton label="Close preview" size={28} onClick={() => onOpenChange(false)}>
          <X aria-hidden="true" />
        </IconButton>
      </div>

      <div className="preview-body">{renderBody(state, resource, onOpen)}</div>
    </Dialog>
  );
}

function renderBody(
  state: PreviewState,
  resource: Resource,
  onOpen: (url: string) => void,
) {
  if (state.status === "loading") {
    return (
      <div className="preview-skeleton">
        <Skeleton rows={6} />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Banner
        kind="error"
        action={{ label: "Open in Quanta instead", onClick: () => onOpen(resource.url) }}
      >
        {state.message}
      </Banner>
    );
  }

  const { preview, objectUrl } = state;
  switch (preview.kind) {
    case "text":
      return preview.text.trim() ? (
        <pre className="preview-text">{preview.text}</pre>
      ) : (
        <div className="preview-status">
          This page has no readable text. Open the original to see it in full.
        </div>
      );
    case "binary":
      return renderBinary(preview, objectUrl);
    case "unsupported":
      return (
        <Banner
          kind="error"
          action={{ label: "Open in Quanta instead", onClick: () => onOpen(resource.url) }}
        >
          {preview.reason}
        </Banner>
      );
    case "tooLarge":
      return (
        <Banner
          kind="error"
          action={{ label: "Open in Quanta instead", onClick: () => onOpen(resource.url) }}
        >
          This file is too large to preview in-app
          {preview.sizeBytes ? ` (${formatBytes(preview.sizeBytes)})` : ""}.
        </Banner>
      );
  }
}

function renderBinary(
  preview: Extract<ResourcePreview, { kind: "binary" }>,
  objectUrl: string | null,
) {
  if (!objectUrl) return <div className="preview-status">Preparing preview&hellip;</div>;
  switch (preview.mode) {
    case "pdf":
      return <iframe className="preview-frame" src={objectUrl} title="PDF preview" />;
    case "image":
      return <img className="preview-image" src={objectUrl} alt="Resource preview" />;
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

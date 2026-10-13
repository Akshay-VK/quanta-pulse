import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { fileTone } from "../lib/filetype";
import { formatBytes } from "../lib/format";
import type { Resource, ResourcePreview } from "../lib/types";

interface Props {
  resource: Resource;
  onClose: () => void;
  onOpen: (url: string) => void;
}

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: ResourcePreview; objectUrl: string | null };

function base64ToArrayBuffer(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

function binaryObjectUrl(preview: Extract<ResourcePreview, { kind: "binary" }>): string {
  return URL.createObjectURL(
    new Blob([base64ToArrayBuffer(preview.data)], { type: preview.mime }),
  );
}

/**
 * Integrated, on-demand preview of a single resource. Content is fetched
 * through the authenticated Rust session only when this panel opens and is
 * never persisted. When a type cannot be rendered (or is too large) the panel
 * says so plainly and offers the original resource in the browser.
 */
export default function ResourcePreviewPanel({ resource, onClose, onOpen }: Props) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
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
  }, [resource.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const listing =
    resource.sourcePageUrl && resource.sourcePageUrl !== resource.url
      ? resource.sourcePageUrl
      : null;

  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div
        className="preview-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview: ${resource.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="preview-head">
          <div className="preview-head-main">
            <span className="preview-title" title={resource.title}>
              {resource.title}
            </span>
            <span className={`file-type ${fileTone(resource.resourceType)}`}>
              <span className="file-dot" aria-hidden="true" />
              {resource.resourceType}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="Close preview"
          >
            Close
          </button>
        </div>

        <div className="preview-body">{renderBody(state, resource, onOpen)}</div>

        <div className="preview-actions">
          <button type="button" className="btn" onClick={() => onOpen(resource.url)}>
            Open Original Resource
          </button>
          {listing && (
            <button type="button" className="btn" onClick={() => onOpen(listing)}>
              Open Listing Page
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function renderBody(state: PreviewState, resource: Resource, onOpen: (url: string) => void) {
  if (state.status === "loading") {
    return <div className="preview-status">Loading preview…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="preview-status">
        <div className="alert error">{state.message}</div>
        <p className="hint">
          You can still{" "}
          <button type="button" className="btn-link" onClick={() => onOpen(resource.url)}>
            open the original resource
          </button>{" "}
          in your browser.
        </p>
      </div>
    );
  }

  const { preview, objectUrl } = state;
  switch (preview.kind) {
    case "text":
      return (
        <div>
          {preview.text.trim() ? (
            <pre className="preview-text">{preview.text}</pre>
          ) : (
            <div className="preview-status">
              This page has no readable text. Open the original resource to see it in full.
            </div>
          )}
          {preview.truncated && (
            <p className="hint" style={{ padding: "0 16px 16px" }}>
              Preview truncated. Open the original for the complete content.
            </p>
          )}
        </div>
      );
    case "binary":
      return renderBinary(preview, objectUrl);
    case "unsupported":
      return (
        <div className="preview-status">
          <p>{preview.reason}</p>
          <p className="faint small">Use “Open Original Resource” to view it outside the app.</p>
        </div>
      );
    case "tooLarge":
      return (
        <div className="preview-status">
          <p>
            This file is too large to preview in-app
            {preview.sizeBytes ? ` (${formatBytes(preview.sizeBytes)})` : ""}.
          </p>
          <p className="faint small">Use “Open Original Resource” to download it.</p>
        </div>
      );
  }
}

function renderBinary(
  preview: Extract<ResourcePreview, { kind: "binary" }>,
  objectUrl: string | null,
) {
  if (!objectUrl) return <div className="preview-status">Preparing preview…</div>;
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

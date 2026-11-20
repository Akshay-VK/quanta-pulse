import { useEffect, useRef, useState } from "react";
import { CircleAlert, ExternalLink, FileQuestionMark, FolderOpen, Minus, Plus, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { formatBytes } from "../lib/format";
import { materialSource } from "../lib/materialActions";
import { base64ToBytes } from "../lib/pdfPreview";
import type { Resource, ResourcePreview, SessionResetResult } from "../lib/types";
import { Button } from "./ui/Button";
import { CoursePill } from "./ui/CoursePill";
import { Dialog } from "./ui/Dialog";
import { FileTypeIcon } from "./ui/FileTypeIcon";
import { IconButton } from "./ui/IconButton";
import { Kbd } from "./ui/Kbd";
import { Skeleton } from "./ui/Skeleton";
import MediaPreview from "./MediaPreview";
import PdfPreview from "./PdfPreview";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string; auth: boolean }
  | { status: "ready"; preview: ResourcePreview; objectUrl: string | null };

function isAuthError(message: string): boolean {
  return /session expired|sign in|auth/i.test(message);
}

function PreviewLoading({ title }: { title: string }) {
  return (
    <div className="preview-loading" role="status">
      <div className="preview-skeleton" aria-hidden="true"><Skeleton rows={6} /></div>
      <div className="preview-loading-label"><span className="spinner" aria-hidden="true" /> Opening {title}…</div>
    </div>
  );
}

function PreviewMessage({ title, detail, error, children }: {
  title: string;
  detail: string;
  error?: boolean;
  children?: React.ReactNode;
}) {
  const MessageIcon = error ? CircleAlert : FileQuestionMark;
  return (
    <div className={`preview-status${error ? " preview-error" : ""}`} role={error ? "alert" : undefined}>
      <span className="preview-message-icon"><MessageIcon size={20} aria-hidden="true" /></span>
      <p className="preview-message-title">{title}</p>
      <p className="preview-error-detail">{detail}</p>
      <div className="preview-message-actions">{children}</div>
    </div>
  );
}

function Hint({ keys, children }: { keys: string; children: React.ReactNode }) {
  return <span className="preview-hint"><Kbd keys={keys} /> {children}</span>;
}

function ImagePreview({ url, title, zoom }: { url: string; title: string; zoom: number }) {
  const stage = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setBounds(entry.contentRect));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit = natural.width && natural.height && bounds.width && bounds.height
    ? Math.min(1, bounds.width / natural.width, bounds.height / natural.height)
    : 0;
  return <div className="preview-image-wrap" ref={stage}>
    <img className={`preview-image${fit ? " preview-image-fitted" : ""}`} src={url} alt={title}
      onLoad={({ currentTarget }) => setNatural({ width: currentTarget.naturalWidth, height: currentTarget.naturalHeight })}
      style={fit ? { width: natural.width * fit * zoom, height: natural.height * fit * zoom } : undefined} />
  </div>;
}

/** The Quick Look shell, with locally rendered stage variants. */
export default function PreviewDialog({
  resource,
  open,
  onOpenChange,
  onOpen,
  onOpenLocal,
  onRevealLocal,
  onReconnect,
  onMarkRead,
  saved,
}: {
  resource: Resource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (url: string) => void;
  onOpenLocal?: (resourceId: number) => void;
  onRevealLocal?: (resourceId: number) => void;
  onReconnect?: () => Promise<SessionResetResult>;
  onMarkRead?: () => void;
  saved?: boolean;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState("");
  const [reconnecting, setReconnecting] = useState(false);

  const resourceId = resource?.id;
  useEffect(() => {
    if (!open || resourceId == null) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setState({ status: "loading" });
    setZoom(1);
    setPage("");
    void api.previewResource(resourceId).then((preview) => {
      if (cancelled) return;
      if (preview.kind === "binary" && preview.mode !== "pdf") {
        createdUrl = URL.createObjectURL(new Blob([base64ToBytes(preview.data)], { type: preview.mime }));
      }
      setState({ status: "ready", preview, objectUrl: createdUrl });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "error", message, auth: isAuthError(message) });
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, resourceId, retryKey]);

  if (!resource) return null;

  const source = materialSource(resource);
  const canOpenCopy = Boolean(onOpenLocal && (saved ?? true));
  const openSource = () => { if (source) onOpen(source); };
  const openCopy = () => onOpenLocal?.(resource.id);
  const retry = () => setRetryKey((key) => key + 1);
  const adjustZoom = (delta: number) => setZoom((current) => Math.round(Math.min(4, Math.max(0.25, current + delta)) * 100) / 100);
  const preview = state.status === "ready" ? state.preview : null;
  const mode = preview?.kind === "binary" ? preview.mode : preview?.kind;
  const media = mode === "audio" || mode === "video";
  const loading = <PreviewLoading title={resource.title} />;
  const unsupported = (title: string, detail: string) => (
    <PreviewMessage title={title} detail={detail}>
      {canOpenCopy
        ? <Button variant="primary" onClick={openCopy}>Open saved copy</Button>
        : source && <Button variant="secondary" onClick={openSource}>Open in Quanta</Button>}
      {canOpenCopy && onRevealLocal && <Button onClick={() => onRevealLocal(resource.id)}>Show in folder</Button>}
    </PreviewMessage>
  );

  async function reconnect() {
    if (!onReconnect || reconnecting) return;
    setReconnecting(true);
    try {
      const result = await onReconnect();
      if (result.status === "connected") retry();
      else setState({ status: "error", auth: true, message: result.message });
    } catch (error) {
      setState({ status: "error", auth: true, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setReconnecting(false);
    }
  }

  const showOriginal = source && (mode === "text" || !canOpenCopy);
  const showCopy = canOpenCopy && (mode === "pdf" || mode === "image" || media);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="preview-dialog" labelledBy="preview-title">
      <div className="preview-shell" onKeyDown={(event) => {
        if (event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o" && canOpenCopy) openCopy();
        else if (event.altKey || event.metaKey || event.ctrlKey) return;
        else if (event.key === " " && !media && !(event.target instanceof HTMLButtonElement)) onOpenChange(false);
        else if (event.key.toLowerCase() === "e" && onMarkRead) onMarkRead();
        else if (event.key.toLowerCase() === "r" && state.status === "error" && !state.auth) retry();
        else if (event.key === "+" && mode === "image") adjustZoom(0.25);
        else if (event.key === "-" && mode === "image") adjustZoom(-0.25);
        else if (event.key === "0" && mode === "image") setZoom(1);
        else return;
        event.preventDefault();
      }}>
        <header className="preview-head">
          <FileTypeIcon type={resource.resourceType} />
          <b className="preview-title" id="preview-title" title={resource.title}>{resource.title}</b>
          {resource.courseName && <CoursePill courseId={resource.courseId} code={resource.courseName} />}
          <span className="preview-head-spacer" />
          {page && <span className="preview-position">{page}</span>}
          {mode === "image" && <div className="preview-zoom-controls" aria-label="Image zoom">
            <IconButton label="Zoom out" onClick={() => adjustZoom(-0.25)} disabled={zoom <= 0.25}><Minus aria-hidden="true" /></IconButton>
            <Button size="sm" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
            <IconButton label="Zoom in" onClick={() => adjustZoom(0.25)} disabled={zoom >= 4}><Plus aria-hidden="true" /></IconButton>
          </div>}
          {showCopy && <Button size="sm" leadingIcon={<ExternalLink aria-hidden="true" />}
            trailingIcon={<span aria-hidden="true"><Kbd keys="Mod+O" /></span>} aria-label="Open saved copy" onClick={openCopy}>Open copy</Button>}
          {showOriginal && <Button size="sm" leadingIcon={<ExternalLink aria-hidden="true" />} onClick={openSource}>Open in Quanta</Button>}
          <button className="preview-close" type="button" aria-label="Close preview" onClick={() => onOpenChange(false)}><Kbd keys="Esc" /></button>
        </header>

        <div className={`preview-body${mode === "text" ? " preview-body-text" : ""}`} data-dialog-primary tabIndex={0}>
          {state.status === "loading" && loading}
          {state.status === "error" && <PreviewMessage title="Couldn't load the preview" detail={state.message} error>
            {!state.auth && <Button variant="primary" leadingIcon={<RotateCcw aria-hidden="true" />} onClick={retry}>Retry</Button>}
            {state.auth && <Button variant="primary"
              leadingIcon={<ExternalLink aria-hidden="true" />} loading={reconnecting}
              onClick={() => onReconnect ? void reconnect() : openSource()}>{reconnecting ? "Reconnecting…" : "Reconnect"}</Button>}
          </PreviewMessage>}
          {state.status === "ready" && (() => {
            const { preview, objectUrl } = state;
            if (preview.kind === "text") return preview.text.trim()
              ? <div className="preview-text preview-reading-column">{preview.text}</div>
              : <PreviewMessage title="No readable text" detail="Open the original to see this page in full." />;
            if (preview.kind === "unsupported") return unsupported("Preview isn't available for this file", preview.reason || "This file format can’t be previewed.");
            if (preview.kind === "tooLarge") return unsupported("This file is too large to preview", preview.sizeBytes
              ? `${formatBytes(preview.sizeBytes)} exceeds the preview limit of ${formatBytes(preview.limitBytes)}.`
              : "The file exceeds the size limit for previews.");
            if (preview.mode === "pdf") return <PdfPreview data={preview.data} loading={loading} onPage={setPage}
              unsupported={unsupported("Preview isn't available for this file", "This PDF can’t be displayed in this version of the app.")} />;
            if (!objectUrl) return loading;
            if (preview.mode === "audio" || preview.mode === "video") return <MediaPreview mode={preview.mode} url={objectUrl} />;
            return <ImagePreview key={objectUrl} url={objectUrl} title={resource.title} zoom={zoom} />;
          })()}
        </div>

        <footer className="preview-footer">
          {mode === "pdf" && page && <><Hint keys="← →">Page</Hint><Hint keys="/">Search</Hint></>}
          {mode === "image" && <><Hint keys="+ −">Zoom</Hint><Hint keys="0">Fit</Hint></>}
          {media && <><Hint keys="Space">Play / pause</Hint><Hint keys="← →">Seek 10s</Hint></>}
          {onMarkRead && mode === "pdf" && <Hint keys="E">Mark read</Hint>}
          {state.status === "loading" ? <Hint keys="Esc">Cancel</Hint>
            : media || state.status === "error" || mode === "unsupported" || mode === "tooLarge"
              ? <Hint keys="Esc">Close</Hint> : <Hint keys="Space">Close</Hint>}
          {state.status === "error" && !state.auth && <Hint keys="R">Retry</Hint>}
          {canOpenCopy && !showCopy && <Hint keys="Mod+O"><FolderOpen size={12} aria-hidden="true" /> Open saved copy</Hint>}
          <span className="preview-head-spacer" />
          {saved && <span className="preview-position">Saved on this device</span>}
        </footer>
      </div>
    </Dialog>
  );
}

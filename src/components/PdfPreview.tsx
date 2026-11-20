import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { IconButton } from "./ui/IconButton";
import { Kbd } from "./ui/Kbd";
import { base64ToBytes, findPdfMatches, type PdfMatch } from "../lib/pdfPreview";

type DocumentState = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; document: PDFDocumentProxy };

function usePdfDocument(data: string): DocumentState {
  const [state, setState] = useState<DocumentState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;

    void Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ]).then(async ([pdf, { default: workerUrl }]) => {
      if (cancelled) return;
      // Explicitly create the module worker so a blocked worker can reach the
      // unsupported state without PDF.js switching to its fake worker.
      const port = new Worker(workerUrl, { type: "module" });
      let worker: InstanceType<typeof pdf.PDFWorker> | undefined;
      const workerFailure = new Promise<never>((_, reject) => {
        port.addEventListener("error", reject, { once: true });
      });
      try {
        worker = pdf.PDFWorker.create({ port });
        const task = pdf.getDocument({ data: base64ToBytes(data), worker, useWasm: false });
        destroy = async () => {
          try {
            await task.destroy();
          } finally {
            worker?.destroy();
            port.terminate();
          }
        };
        const document = await Promise.race([task.promise, workerFailure]);
        if (!cancelled) setState({ kind: "ready", document });
      } catch {
        port.terminate();
        worker?.destroy();
        if (!cancelled) setState({ kind: "failed" });
      }
    }).catch(() => {
      if (!cancelled) setState({ kind: "failed" });
    });

    return () => {
      cancelled = true;
      void destroy?.().catch(() => {});
    };
  }, [data]);

  return state;
}

function PdfCanvas({
  document,
  number,
  width,
  height,
  match,
}: {
  document: PDFDocumentProxy;
  number: number;
  width: number;
  height: number;
  match?: PdfMatch;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bounds, setBounds] = useState<{ width: number; height: number; page: PDFPageProxy }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    setFailed(false);
    setBounds(undefined);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) {
      setFailed(true);
      return;
    }

    void document.getPage(number).then((page) => {
      if (cancelled) return;
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(width / original.width, height / original.height);
      const viewport = page.getViewport({ scale });
      const pixels = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.ceil(viewport.width * pixels);
      canvas.height = Math.ceil(viewport.height * pixels);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      render = page.render({ canvas, canvasContext: context, viewport, transform: [pixels, 0, 0, pixels, 0, 0] });
      return render.promise.then(() => {
        if (!cancelled) setBounds({ width: viewport.width, height: viewport.height, page });
      });
    }).catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, number, width, height]);

  return (
    <div className="pdf-canvas-wrap">
      <canvas ref={canvasRef} role="img" aria-label={`PDF page ${number}`} hidden={failed || !bounds} />
      {failed && <span className="pdf-page-error">Page {number} couldn’t be displayed</span>}
      {bounds && match?.boxes.length && <svg aria-hidden="true" className="pdf-highlight" viewBox={`0 0 ${bounds.width} ${bounds.height}`}>
        {match.boxes.map(({ x, y, width: matchWidth, height: matchHeight }, index) => {
          const original = bounds.page.getViewport({ scale: 1 });
          const viewport = bounds.page.getViewport({ scale: bounds.width / original.width });
          const box = viewport.convertToViewportRectangle([x, y, x + matchWidth, y + matchHeight]);
          return <rect key={index} x={Math.min(box[0], box[2])} y={Math.min(box[1], box[3])}
            width={Math.abs(box[2] - box[0])} height={Math.abs(box[3] - box[1])} />;
        })}
      </svg>}
    </div>
  );
}

function PdfPages({ document, onPage }: { document: PDFDocumentProxy; onPage: (page: string) => void }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PdfMatch[]>([]);
  const [matching, setMatching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 420, height: 552 });

  useEffect(() => {
    onPage(`Page ${page} / ${document.numPages}`);
  }, [document.numPages, page, onPage]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        width: Math.min(420, Math.max(1, entry.contentRect.width - 24)),
        height: Math.min(552, Math.max(1, entry.contentRect.height - 24)),
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const term = query.trim();
    setMatches([]);
    setMatchIndex(0);
    setSearchFailed(false);
    setMatching(Boolean(term));
    if (!term) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void findPdfMatches(document, term, () => cancelled).then((result) => {
        if (cancelled) return;
        setMatches(result);
        if (result.length) setPage(result[0].page);
      }).catch(() => { if (!cancelled) setSearchFailed(true); }).finally(() => { if (!cancelled) setMatching(false); });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [document, query]);

  function goTo(next: number) {
    setPage(Math.max(1, Math.min(document.numPages, next)));
  }

  function moveMatch(direction: number) {
    if (!matches.length || matching) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next);
    goTo(matches[next].page);
  }

  useEffect(() => {
    const shell = stageRef.current?.closest(".preview-shell");
    if (!shell) return;
    const handleShortcut = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.target instanceof HTMLInputElement
        || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "/") searchRef.current?.focus();
      else if (event.key === "ArrowLeft") setPage((current) => Math.max(1, current - 1));
      else if (event.key === "ArrowRight") setPage((current) => Math.min(document.numPages, current + 1));
      else if (["n", "p"].includes(event.key.toLowerCase()) && matches.length && !matching) {
        const next = (matchIndex + (event.key.toLowerCase() === "n" ? 1 : -1) + matches.length) % matches.length;
        setMatchIndex(next);
        setPage(matches[next].page);
      } else return;
      event.preventDefault();
    };
    shell.addEventListener("keydown", handleShortcut);
    return () => shell.removeEventListener("keydown", handleShortcut);
  }, [document.numPages, matchIndex, matches, matching]);

  const firstThumbnail = Math.max(1, Math.min(page - 2, document.numPages - 4));
  const thumbnails = Array.from({ length: Math.min(5, document.numPages) }, (_, index) => firstThumbnail + index);

  return (
    <div className="preview-pdf">
      <div className="pdf-search">
        <Search size={16} aria-hidden="true" />
        <input ref={searchRef} aria-label="Search in document" value={query} placeholder="Search in document"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") moveMatch(event.shiftKey ? -1 : 1); }} />
        <span className="pdf-match-count" role="status">
          {matching ? "Searching…" : searchFailed ? "Search unavailable" : matches.length ? `${matchIndex + 1} of ${matches.length}` : query.trim() ? "No matches" : ""}
        </span>
        <button type="button" className="preview-hint" disabled={!matches.length} onClick={() => moveMatch(1)}><Kbd keys="N" /> Next</button>
        <button type="button" className="preview-hint" disabled={!matches.length} onClick={() => moveMatch(-1)}><Kbd keys="P" /> Previous</button>
      </div>
      <div className="pdf-spread">
        <nav className="pdf-thumbnails" aria-label="PDF pages">
          <IconButton label="Previous page" onClick={() => goTo(page - 1)} disabled={page === 1}><ChevronUp /></IconButton>
          {thumbnails.map((number) => (
            <button key={number} type="button" className="pdf-thumbnail" aria-label={`Go to page ${number}`}
              aria-current={page === number ? "page" : undefined} onClick={() => goTo(number)}>
              <PdfCanvas document={document} number={number} width={70} height={90} />
            </button>
          ))}
          <IconButton label="Next page" onClick={() => goTo(page + 1)} disabled={page === document.numPages}><ChevronDown /></IconButton>
        </nav>
        <div className="pdf-stage" ref={stageRef} tabIndex={0} aria-label="PDF document">
          <PdfCanvas document={document} number={page} {...stageSize}
            match={matches[matchIndex]?.page === page ? matches[matchIndex] : undefined} />
        </div>
      </div>
    </div>
  );
}

export default function PdfPreview({ data, loading, unsupported, onPage }: {
  data: string;
  loading: React.ReactNode;
  unsupported: React.ReactNode;
  onPage: (page: string) => void;
}) {
  const state = usePdfDocument(data);
  if (state.kind === "loading") return loading;
  if (state.kind === "failed") return unsupported;
  return <PdfPages document={state.document} onPage={onPage} />;
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Resource } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: { previewResource: vi.fn() },
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  const getPage = vi.fn(async (page: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 420 * scale,
      height: 552 * scale,
      convertToViewportRectangle: (rect: number[]) => rect,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    getTextContent: async () => ({
      items: [{
        str: page === 2 ? "A pointer" : "Arrays only",
        transform: [1, 0, 0, 1, 20, 50],
        width: 64,
        height: 12,
      }],
    }),
  }));
  return {
    PDFWorker: { create: () => ({ destroy: vi.fn() }) },
    getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage }), destroy: async () => {} }),
  };
});
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "/pdf-worker.mjs" }));

import { api } from "../src/lib/api";
import PreviewDialog from "../src/components/PreviewDialog";
import { TooltipProvider } from "../src/components/ui/Tooltip";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function buildResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 7,
    externalResourceId: "mod:resource:7",
    courseId: 1,
    courseName: "Discrete Mathematics",
    title: "Lecture 04 — Graph theory",
    url: "https://quanta.bits-pilani.ac.in/pluginfile.php/1/mod_resource/content/0/lecture04.pdf",
    sourcePageUrl: "https://quanta.bits-pilani.ac.in/course/view.php?id=1",
    resourceType: "pdf",
    uploadedAt: null,
    publishedAt: null,
    modifiedAt: null,
    dueAt: null,
    firstSeenAt: "2026-10-10T09:05:00+05:30",
    lastSeenAt: null,
    lastCheckedAt: null,
    contentFingerprint: null,
    availabilityStatus: "available",
    sizeBytes: null,
    section: null,
    isExternal: false,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.previewResource).mockReset();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(
    () => "blob:mock",
  );
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function dialog(): HTMLElement {
  return document.querySelector(".dialog-content") as HTMLElement;
}

function button(label: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe("QuickLook", () => {
  it("shows loading label with title", async () => {
    vi.mocked(api.previewResource).mockReturnValue(new Promise(() => {}));
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open onOpenChange={() => {}} onOpen={() => {}} />
        </TooltipProvider>,
      );
    });
    expect(dialog().textContent).toContain("Opening Lecture 04");
  });

  it("revoke object url on unmount", async () => {
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "binary",
      mode: "image",
      mime: "image/png",
      data: "iVBORw0KGgo=",
      sourceUrl: "https://quanta.bits-pilani.ac.in/x.png",
      sizeBytes: 4,
    });
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open onOpenChange={() => {}} onOpen={() => {}} />
        </TooltipProvider>,
      );
    });
    await flush();
    act(() => root.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("retry on error", async () => {
    vi.mocked(api.previewResource).mockRejectedValue("network down");
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open onOpenChange={() => {}} onOpen={() => {}} />
        </TooltipProvider>,
      );
    });
    await flush();
    const retry = [...dialog().querySelectorAll("button")].find((b) => b.textContent === "Retry") as HTMLButtonElement;
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "unsupported",
      reason: "nope",
      sourceUrl: "x",
      contentType: null,
    });
    await act(async () => retry.click());
    await flush();
    expect(api.previewResource).toHaveBeenCalledTimes(2);
  });

  it("auth error shows Reconnect", async () => {
    vi.mocked(api.previewResource).mockRejectedValue("Your Quanta session expired. Sign in again.");
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open onOpenChange={() => {}} onOpen={() => {}} />
        </TooltipProvider>,
      );
    });
    await flush();
    expect(dialog().textContent).toContain("Reconnect");
  });

  it("Escape closes", async () => {
    vi.mocked(api.previewResource).mockResolvedValue({ kind: "unsupported", reason: "nope", sourceUrl: "x", contentType: null });
    let open = true;
    const onOpenChange = vi.fn((n: boolean) => { open = n; });
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open={open} onOpenChange={onOpenChange} onOpen={() => {}} />
        </TooltipProvider>,
      );
    });
    await flush();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders a local PDF canvas, navigates thumbnails, and finds document text", async () => {
    vi.stubGlobal("Worker", class extends EventTarget { terminate() {} });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "binary", mode: "pdf", mime: "application/pdf", data: "JVBERi0=",
      sourceUrl: "https://quanta.bits-pilani.ac.in/x.pdf", sizeBytes: 8,
    });
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open onOpenChange={() => {}} onOpen={() => {}} />
        </TooltipProvider>,
      );
    });
    await flush();
    await act(async () => {
      await vi.waitFor(() => expect(dialog().textContent).toContain("Page 1 / 3"));
    });
    await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="Go to page 3"]')?.click());
    expect(dialog().textContent).toContain("Page 3 / 3");
    const search = dialog().querySelector<HTMLInputElement>('[aria-label="Search in document"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "pointer");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    expect(dialog().textContent).toContain("1 of 1");
    expect(dialog().textContent).toContain("Page 2 / 3");
    expect(dialog().querySelector(".pdf-stage canvas")?.getAttribute("aria-label")).toBe("PDF page 2");
    expect(dialog().querySelector("iframe")).toBeNull();
  });

  it("offers real saved-copy actions for unsupported files", async () => {
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "unsupported", reason: "Preview isn't available for this file", sourceUrl: "x", contentType: null,
    });
    const onOpenLocal = vi.fn();
    const onRevealLocal = vi.fn();
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open onOpenChange={() => {}} onOpen={() => {}} onOpenLocal={onOpenLocal} onRevealLocal={onRevealLocal} />
        </TooltipProvider>,
      );
    });
    await flush();
    await act(async () => { button("Open saved copy").click(); });
    await act(async () => { button("Show in folder").click(); });
    expect(onOpenLocal).toHaveBeenCalledWith(7);
    expect(onRevealLocal).toHaveBeenCalledWith(7);
  });

  it("states that the preview could not load and keeps a retry", async () => {
    vi.mocked(api.previewResource).mockRejectedValue("network down");
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog resource={buildResource()} open onOpenChange={() => {}} onOpen={() => {}} />
        </TooltipProvider>,
      );
    });
    await flush();
    expect(dialog().textContent).toContain("Couldn't load the preview");
  });
});

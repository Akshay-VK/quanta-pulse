// Preview dialog scenario test: the authenticated fetch result is rendered
// in-app for text and binary kinds, unsupported/error states explain
// themselves, and the original resource is always reachable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Resource } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: { previewResource: vi.fn() },
}));

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

async function render(
  resource: Resource,
  handlers: { onOpen?: (u: string) => void } = {},
) {
  const onOpen = handlers.onOpen ?? vi.fn();
  await act(async () => {
    root.render(
      <TooltipProvider>
        <PreviewDialog resource={resource} open onOpenChange={() => {}} onOpen={onOpen} />
      </TooltipProvider>,
    );
  });
  await flush();
  return { onOpen };
}

/** The dialog is portalled, so its content lives outside `container`. */
function dialog(): HTMLElement {
  return document.querySelector(".dialog-content") as HTMLElement;
}

describe("PreviewDialog", () => {
  it("renders extracted text and opens the original resource", async () => {
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "text",
      text: "Assignment 1\nSubmit the report as a PDF.",
      truncated: false,
      sourceUrl: "https://quanta.bits-pilani.ac.in/mod/assign/view.php?id=1",
      contentType: "text/html",
    });
    const resource = buildResource();
    const { onOpen } = await render(resource);

    expect(api.previewResource).toHaveBeenCalledWith(7);
    expect(dialog().querySelector(".preview-text")?.textContent).toContain("Assignment 1");

    const openBtn = [...dialog().querySelectorAll("button")].find(
      (b) => b.textContent === "Open in Quanta",
    ) as HTMLButtonElement;
    await act(async () => openBtn.click());
    expect(onOpen).toHaveBeenCalledWith(resource.url);
  });

  it("renders a PDF in an embedded frame from decoded bytes", async () => {
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "binary",
      mode: "pdf",
      mime: "application/pdf",
      data: "JVBERi0=",
      sourceUrl: "https://quanta.bits-pilani.ac.in/x.pdf",
      sizeBytes: 6,
    });
    await render(buildResource());

    const frame = dialog().querySelector("iframe.preview-frame") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("src")).toBe("blob:mock");
  });

  it("explains an unsupported type instead of pretending to preview it", async () => {
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "unsupported",
      reason: "Files of type .pptx can't be previewed in the app.",
      sourceUrl: "https://quanta.bits-pilani.ac.in/x.pptx",
      contentType: null,
    });
    await render(buildResource({ resourceType: "presentation" }));
    expect(dialog().textContent).toContain("can't be previewed");
    expect(dialog().textContent).toContain("Open in Quanta instead");
  });

  it("surfaces a fetch error and still offers the original", async () => {
    vi.mocked(api.previewResource).mockRejectedValue(
      "Your Quanta session expired. Sign in again to preview resources.",
    );
    await render(buildResource());
    expect(dialog().textContent).toContain("session expired");
  });

  it("closes on Escape", async () => {
    vi.mocked(api.previewResource).mockResolvedValue({
      kind: "unsupported",
      reason: "nope",
      sourceUrl: "https://x",
      contentType: null,
    });
    let open = true;
    const onOpenChange = vi.fn((next: boolean) => {
      open = next;
    });
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewDialog
            resource={buildResource()}
            open={open}
            onOpenChange={onOpenChange}
            onOpen={() => {}}
          />
        </TooltipProvider>,
      );
    });
    await flush();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

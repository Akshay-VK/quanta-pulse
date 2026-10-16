// B8: the mirror surfaces in the UI. Every per-resource state gets its own
// icon, tone and announced tooltip, and the resource actions follow the local
// copy: 'Open local copy' when one exists, 'Download and open' when it does not,
// the plain external label when the resource cannot have one.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ResourceRow from "../src/components/ResourceRow";
import PeekPanel, { type PeekDetails } from "../src/components/PeekPanel";
import { MirrorStatusIcon } from "../src/components/ui/MirrorStatusIcon";
import { TooltipProvider } from "../src/components/ui/Tooltip";
import { MIRROR_STATUS, isMirrorStatus, mirrorTip } from "../src/lib/mirrorState";
import type { LocalFileStatus } from "../src/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const STATES = ["ok", "downloading", "queued", "failed", "skipped", "kept"] as const;

function local(status: string, error: string | null = null): LocalFileStatus {
  return { resourceId: 1, status, error };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(<TooltipProvider>{node}</TooltipProvider>);
  });
}

describe("mirror state labels", () => {
  it("knows every status the backend can send", () => {
    for (const state of STATES) expect(isMirrorStatus(state)).toBe(true);
    expect(isMirrorStatus("nonsense")).toBe(false);
  });

  it("gives every state a label, a tip and a tone", () => {
    for (const state of STATES) {
      const meta = MIRROR_STATUS[state];
      expect(meta.label).toBeTruthy();
      expect(meta.tip).toBeTruthy();
      expect(meta.tone).toBeTruthy();
    }
  });

  it("names the failure reason in the tooltip, but not for other states", () => {
    expect(mirrorTip(local("failed", "HTTP 500"))).toBe("Download failed: HTTP 500");
    expect(mirrorTip(local("failed"))).toBe("Download failed");
    expect(mirrorTip(local("ok"))).toBe("Saved on this computer");
    expect(mirrorTip(null)).toBeNull();
  });
});

describe("MirrorStatusIcon", () => {
  it("announces every state in its aria-label and title", async () => {
    for (const state of STATES) {
      await render(<MirrorStatusIcon file={local(state)} />);
      const icon = container.querySelector(".mirror-icon");
      expect(icon?.getAttribute("aria-label")).toBe(MIRROR_STATUS[state].tip);
      // The tone class carries the colour, so it must match the state's tone.
      expect(icon?.className).toContain(`mirror-${MIRROR_STATUS[state].tone}`);
    }
  });

  it("spins only while a download is running", async () => {
    await render(<MirrorStatusIcon file={local("downloading")} />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("mirror-spin");

    await render(<MirrorStatusIcon file={local("queued")} />);
    expect(container.querySelector("svg")?.getAttribute("class") ?? "").not.toContain("mirror-spin");
  });
});

describe("ResourceRow local copy actions", () => {
  async function row(localStatus?: LocalFileStatus | null) {
    await render(
      <ResourceRow
        title="Lecture 1.pdf"
        type="PDF"
        courseId={1}
        courseCode="CS F222"
        courseName="Discrete Structures"
        unread={false}
        selected={false}
        unavailable={false}
        timeLabel="09:05"
        openLabel="Open in Quanta"
        local={localStatus}
        onOpenLocal={() => {}}
        onOpen={() => {}}
        onSelect={() => {}}
        menu={[]}
      />,
    );
  }

  it("shows the status icon only when there is a local copy row", async () => {
    await row(null);
    expect(container.querySelector(".row-mirror")).toBeNull();

    await row(local("ok"));
    expect(container.querySelector(".row-mirror .mirror-icon")).toBeTruthy();
  });

  it("opens the local copy when one is saved", async () => {
    await row(local("ok"));
    expect(container.querySelector(".row-actions button")?.getAttribute("aria-label")).toBe(
      "Open local copy",
    );
  });

  it("offers 'Download and open' when the resource has no copy yet", async () => {
    await row(local("queued"));
    expect(container.querySelector(".row-actions button")?.getAttribute("aria-label")).toBe(
      "Download and open",
    );
  });

  it("keeps the external label for a resource that cannot have a copy", async () => {
    await row(undefined);
    expect(container.querySelector(".row-actions button")?.getAttribute("aria-label")).toBe(
      "Open in Quanta",
    );
  });
});

describe("PeekPanel local copy group", () => {
  const base: PeekDetails = {
    title: "Lecture 1.pdf",
    properties: [{ label: "Course", value: "CS F222" }],
  };

  async function panel(localStatus: PeekDetails["local"], onOpenLocal?: () => void) {
    await render(
      <PeekPanel
        open
        onClose={() => {}}
        details={{ ...base, local: localStatus, onOpenLocal }}
      />,
    );
  }

  it("is absent when the resource has no local copy row", async () => {
    await panel(undefined);
    expect(container.querySelector(".peek-group-title")).toBeNull();
  });

  it("lists the saved copy's size, path and status", async () => {
    await panel({
      status: "ok",
      error: null,
      sizeBytes: 2048,
      path: "CS F222/Lecture 1.pdf",
    });
    expect(container.querySelector(".peek-group-title")?.textContent).toBe("Local copy");
    const text = container.querySelector(".peek-properties:last-of-type")?.textContent ?? "";
    expect(text).toContain("Saved");
    expect(text).toContain("2.0 KB");
    expect(text).toContain("CS F222/Lecture 1.pdf");
  });

  it("offers 'Open local copy' only when the copy can be opened", async () => {
    await panel({ status: "ok", error: null, sizeBytes: 10, path: "a.pdf" }, () => {});
    expect(
      [...container.querySelectorAll(".peek-local-actions button")].map((b) => b.textContent),
    ).toContain("Open local copy");

    await panel({ status: "downloading", error: null, sizeBytes: null, path: null }, () => {});
    expect(
      [...container.querySelectorAll(".peek-local-actions button")].map((b) => b.textContent),
    ).not.toContain("Open local copy");
  });

  it("names the failure reason in the Why row", async () => {
    await panel({
      status: "failed",
      error: "HTTP 500",
      sizeBytes: null,
      path: null,
    });
    expect(container.textContent).toContain("Failed");
    expect(container.textContent).toContain("HTTP 500");
  });
});

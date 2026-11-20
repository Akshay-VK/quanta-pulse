// Peek panel focus contract: focus moves to the panel title when details open
// and returns to the row that opened it when they close.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import PeekPanel, { type PeekDetails } from "../src/components/PeekPanel";
import { TooltipProvider } from "../src/components/ui/Tooltip";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const DETAILS: PeekDetails = {
  title: "Lecture 14: Inheritance",
  properties: [{ label: "Course", value: "CS F213" }],
  primaryAction: { label: "Open file", onClick: () => {} },
};

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

/** Mirrors the shell: a row that hands its element over as the return target. */
function Harness() {
  const [open, setOpen] = useState(false);
  const lastRow = useRef<HTMLElement | null>(null);

  return (
    <TooltipProvider>
      <button
        type="button"
        onClick={(event) => {
          lastRow.current = event.currentTarget;
          setOpen(true);
        }}
      >
        Lecture 14
      </button>
      <PeekPanel
        open={open}
        details={open ? DETAILS : null}
        onClose={() => {
          setOpen(false);
          lastRow.current?.focus();
        }}
      />
    </TooltipProvider>
  );
}

describe("PeekPanel focus", () => {
  it("moves focus to the panel title on open and back to the row on close", async () => {
    await act(async () => {
      root.render(<Harness />);
    });

    const row = container.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      row.focus();
      row.click();
    });

    const title = document.querySelector<HTMLElement>(".peek-title");
    expect(title).toBeTruthy();
    expect(document.activeElement).toBe(title);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close details"]')?.click();
    });
    expect(document.querySelector(".peek")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("stays closed until there are details", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PeekPanel open={false} details={null} onClose={vi.fn()} />
        </TooltipProvider>,
      );
    });
    expect(document.querySelector(".peek")).toBeNull();
  });
});

describe("PeekPanel variants", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof import("react-dom/client").createRoot>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.remove();
  });

  async function show(details: PeekDetails) {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    root = createRoot(container);
    const { TooltipProvider } = await import("../src/components/ui/Tooltip");
    await act(async () => {
      root.render(
        <TooltipProvider>
          <PeekPanel open details={details} onClose={() => {}} />
        </TooltipProvider>,
      );
    });
  }

  it("renders the 44px header with Material, Esc keycap and close icon", async () => {
    await show({ title: "T", properties: [] });
    expect(container.querySelector(".peek-header")?.textContent).toContain("Material");
    expect(container.querySelector(".peek-header kbd")?.textContent).toBe("Esc");
    expect(container.querySelector('[aria-label="Close details"]')).toBeTruthy();
  });

  it("renders the saved variant", async () => {
    await show({
      title: "Lecture 04 · Data structures.pdf",
      typeLabel: "PDF",
      properties: [{ label: "Status", value: "Saved on this device" }],
      primaryAction: { label: "Preview", onClick: () => {} },
      secondaryAction: { label: "Open saved copy", onClick: () => {} },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Saved on this device");
    expect(text).toContain("Preview");
    expect(text).toContain("Open saved copy");
  });

  it("renders the unsaved variant", async () => {
    await show({
      title: "Lecture 04 · Data structures.pdf",
      typeLabel: "PDF",
      properties: [{ label: "Status", value: "Not saved" }],
      primaryAction: { label: "Download and open", onClick: () => {} },
      secondaryAction: { label: "Download", onClick: () => {} },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Not saved");
    expect(text).toContain("Download and open");
    expect(text).toContain("Download");
  });

  it("renders the downloading variant with progress, cancel and disabled actions", async () => {
    await show({
      title: "Lecture 04 · Data structures.pdf",
      typeLabel: "PDF",
      properties: [{ label: "Course", value: "CS F111" }],
      progress: { percent: 42, size: "2.4 MB" },
      primaryAction: { label: "Preview", onClick: () => {}, disabled: true },
      cancelAction: { onClick: () => {} },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("42%");
    expect(text).toContain("2.4 MB");
    expect(text).toContain("Cancel");
    const primary = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Preview"));
    expect(primary?.disabled).toBe(true);
  });

  it("renders the failed variant", async () => {
    await show({
      title: "Lecture 04 · Data structures.pdf",
      typeLabel: "PDF",
      properties: [{ label: "Status", value: "Failed" }],
      banner: { kind: "danger", text: "Download failed: the connection was reset." },
      primaryAction: { label: "Retry", onClick: () => {} },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Download failed: the connection was reset.");
    expect(text).toContain("Retry");
  });

  it("renders the unavailable variant", async () => {
    await show({
      title: "Lecture 04 · Data structures.pdf",
      typeLabel: "PDF",
      properties: [{ label: "Status", value: "Saved on this device" }],
      banner: { kind: "warning", text: "No longer on Quanta. Your saved copy still works." },
      primaryAction: { label: "Preview", onClick: () => {} },
      secondaryAction: { label: "Open saved copy", onClick: () => {} },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("No longer on Quanta. Your saved copy still works.");
    expect(text).toContain("Preview");
  });

  it("renders the external/announcement variant", async () => {
    await show({
      title: "Course announcement · Schedule update",
      typeLabel: "ANNOUNCEMENT",
      properties: [{ label: "Course", value: "CS F111" }],
      primaryAction: { label: "Open in Quanta", onClick: () => {} },
      announcement: "The Week 05 tutorial moves to Thursday.",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("The Week 05 tutorial moves to Thursday.");
    expect(text).toContain("Open in Quanta");
  });

  it("renders the historical variant", async () => {
    await show({
      title: "Lecture 04 · Data structures.pdf",
      typeLabel: "HISTORICAL EVENT",
      properties: [{ label: "Event", value: "Updated" }],
      banner: { kind: "neutral", text: "The original resource no longer exists." },
      secondaryAction: { label: "Show in History", onClick: () => {} },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("The original resource no longer exists.");
    expect(text).toContain("Show in History");
  });

  it("renders the deadline variant", async () => {
    await show({
      title: "Assignment 02 · Problem set",
      typeLabel: "DEADLINE",
      properties: [
        { label: "Due", value: "14 Nov 2026, 23:59 IST" },
        { label: "Local time", value: "Sat 14 Nov, 23:59 · IST" },
        { label: "Countdown", value: "in 14h 17m" },
        { label: "Course", value: "CS F111" },
      ],
      primaryAction: { label: "Open in Quanta", onClick: () => {} },
      note: "Submission status is not tracked.",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("14 Nov 2026, 23:59 IST");
    expect(text).toContain("Sat 14 Nov, 23:59 · IST");
    expect(text).toContain("in 14h 17m");
    expect(text).toContain("CS F111");
    expect(text).toContain("Submission status is not tracked.");
  });

  it("renders the technical disclosure expanded", async () => {
    await show({
      title: "Lecture 04 · Data structures.pdf",
      typeLabel: "PDF",
      properties: [{ label: "Status", value: "Saved on this device" }],
      technical: {
        fileName: "lecture-04-data-structures.pdf",
        fileType: "application/pdf",
        size: "2.4 MB",
        sha256: "a3f9c1234567890abcdef",
        quantaUrl: "https://quanta.bits-pilani.ac.in/file/7",
        savedPath: "~/Pulse/Quanta/CS F111/lecture-04.pdf",
      },
      technicalOpen: true,
    });
    const details = container.querySelector("details.peek-technical") as HTMLDetailsElement;
    expect(details?.open).toBe(true);
    const text = container.textContent ?? "";
    expect(text).toContain("File information");
    expect(text).toContain("lecture-04-data-structures.pdf");
    expect(text).toContain("application/pdf");
    expect(text).toContain("2.4 MB");
    expect(text).toContain("a3f9c1234567");
    expect(text).toContain("https://quanta.bits-pilani.ac.in/file/7");
    expect(text).toContain("~/Pulse/Quanta/CS F111/lecture-04.pdf");
    expect(container.querySelector('[aria-label*="Copy"]')).toBeTruthy();
  });
});

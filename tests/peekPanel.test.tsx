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

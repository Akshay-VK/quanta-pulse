import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import HistoryView from "../src/views/HistoryView";
import { TooltipProvider } from "../src/components/ui/Tooltip";
import type { ChangeEvent } from "../src/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const event = (id: number, read: boolean): ChangeEvent => ({
  id,
  resourceId: id,
  courseId: 1,
  courseName: "Course",
  resourceTitle: `Resource ${id}`,
  resourceUrl: null,
  sourcePageUrl: null,
  sectionPath: [],
  resourceType: "file",
  uploadedAt: null,
  changeType: "new",
  title: `Event ${id}`,
  description: null,
  detectedAt: "2026-10-12T10:00:00Z",
  read,
});

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
  vi.restoreAllMocks();
});

function Harness({ onMarkAllRead }: { onMarkAllRead: () => Promise<void> }) {
  const [events, setEvents] = useState([event(1, false), event(2, true)]);
  const [unread, setUnread] = useState(1);
  return (
    <TooltipProvider>
      <output data-testid="unread-count">{unread}</output>
      <HistoryView
        courses={[]}
        events={events}
        scans={[]}
        onOpen={() => undefined}
        onMarkAllRead={async () => {
          setEvents((current) => current.map((item) => ({ ...item, read: true })));
          setUnread(0);
          await onMarkAllRead();
        }}
        onClearAll={async () => undefined}
        onSyncNow={() => undefined}
      />
    </TooltipProvider>
  );
}

describe("History read action", () => {
  it("marks unread History entries read, updates the count, and prevents overlapping requests", async () => {
    let resolve!: () => void;
    const onMarkAllRead = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    await act(async () => root.render(<Harness onMarkAllRead={onMarkAllRead} />));
    expect(container.querySelectorAll(".unread-dot:not(.read)")).toHaveLength(1);
    expect(container.querySelector('[data-testid="unread-count"]')?.textContent).toBe("1");

    const button = [...container.querySelectorAll("button")]
      .find((item) => item.textContent?.includes("Mark all read")) as HTMLButtonElement;
    await act(async () => {
      button.click();
      button.click();
    });

    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".unread-dot:not(.read)")).toHaveLength(0);
    expect(container.querySelector('[data-testid="unread-count"]')?.textContent).toBe("0");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Marking read");

    await act(async () => resolve());
    expect(button.disabled).toBe(true);
  });
});

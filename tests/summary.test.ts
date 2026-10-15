import { describe, expect, it } from "vitest";
import { summarySentence } from "../src/lib/summary";

const zero = { new: 0, updated: 0, announcement: 0, deadline: 0, unavailable: 0 };

describe("summarySentence", () => {
  it("reads 'all caught up' with the last sync when nothing changed", () => {
    expect(summarySentence({ counts: zero })).toBe("You're all caught up.");
    expect(
      summarySentence({ counts: zero, lastSyncLabel: "4 min ago" }),
    ).toBe("You're all caught up. Last sync 4 min ago.");
  });

  it("uses singular and plural nouns per count", () => {
    expect(
      summarySentence({
        counts: { ...zero, new: 1, announcement: 1, unavailable: 2 },
      }),
    ).toBe("1 new file, 1 announcement, and 2 unavailable.");
  });

  it("orders the clauses new, updated, announcements, deadlines, unavailable", () => {
    expect(
      summarySentence({
        counts: { ...zero, new: 4, updated: 2, announcement: 3, deadline: 1 },
      }),
    ).toBe("4 new files, 2 updated, 3 announcements, and 1 deadline.");
  });

  it("names the nearest deadline inside the deadline clause", () => {
    expect(
      summarySentence({
        counts: { ...zero, deadline: 1, new: 2 },
        nearestDeadlineDays: 2,
      }),
    ).toBe("2 new files and 1 deadline in 2 days.");
    expect(
      summarySentence({
        counts: { ...zero, deadline: 1 },
        nearestDeadlineDays: 1,
      }),
    ).toBe("1 deadline tomorrow.");
    expect(
      summarySentence({
        counts: { ...zero, deadline: 1 },
        nearestDeadlineDays: 0,
      }),
    ).toBe("1 deadline today.");
  });

  it("falls back to a plain deadline clause for more than one", () => {
    expect(
      summarySentence({ counts: { ...zero, deadline: 3 }, nearestDeadlineDays: 2 }),
    ).toBe("3 deadlines.");
  });
});

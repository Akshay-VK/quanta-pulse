// Builds the Today page summary sentence from the same counts as the filter
// tabs, so the sentence and the tabs can never disagree. Pure and tested.

import type { EventCounts } from "./events";

export interface SummaryInput {
  counts: Pick<
    EventCounts,
    "new" | "updated" | "announcement" | "deadline" | "unavailable"
  >;
  /** Days until the nearest deadline inside the user's window, or null. */
  nearestDeadlineDays?: number | null;
  /** Already-formatted last successful sync label, used for the all-zero case. */
  lastSyncLabel?: string | null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function deadlineClause(count: number, nearest?: number | null): string {
  if (count === 1 && typeof nearest === "number") {
    if (nearest <= 0) return "1 deadline today";
    if (nearest === 1) return "1 deadline tomorrow";
    return `1 deadline in ${nearest} days`;
  }
  return `${count} ${plural(count, "deadline")}`;
}

function join(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The one-line "what changed" summary for the Today header. */
export function summarySentence({
  counts,
  nearestDeadlineDays = null,
  lastSyncLabel = null,
}: SummaryInput): string {
  const parts: string[] = [];
  if (counts.new > 0) {
    parts.push(`${counts.new} new ${plural(counts.new, "file")}`);
  }
  if (counts.updated > 0) {
    parts.push(`${counts.updated} updated`);
  }
  if (counts.announcement > 0) {
    parts.push(`${counts.announcement} ${plural(counts.announcement, "announcement")}`);
  }
  if (counts.deadline > 0) {
    parts.push(deadlineClause(counts.deadline, nearestDeadlineDays));
  }
  if (counts.unavailable > 0) {
    parts.push(`${counts.unavailable} unavailable`);
  }

  if (parts.length === 0) {
    return lastSyncLabel
      ? `You're all caught up. Last sync ${lastSyncLabel}.`
      : "You're all caught up.";
  }
  return `${capitalize(join(parts))}.`;
}
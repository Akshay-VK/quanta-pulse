import { api } from "./api";
import type { ChangeEvent } from "./types";

const PAGE_SIZE = 1000;

function incomplete(reason: string): never {
  throw new Error(`History inventory incomplete: ${reason}. Retry refresh.`);
}

/**
 * Collect the unfiltered B05A inventory in backend order, or reject in full.
 * Callers publish only a completed, current refresh and retain old rows on failure.
 * Offset pages are not an atomic snapshot: concurrent edits can shift membership
 * even when every page has a consistent total. This is a completed publication,
 * not a guarantee of all events at a single database instant.
 */
export async function queryHistoryInventory(): Promise<ChangeEvent[]> {
  const events: ChangeEvent[] = [];
  const ids = new Set<number>();
  let total: number | undefined;

  for (;;) {
    const page = await api.queryHistoryEvents({ offset: events.length, limit: PAGE_SIZE });
    if (!page || !Array.isArray(page.items) || page.items.length > PAGE_SIZE) {
      incomplete("invalid page items");
    }
    if (!Number.isSafeInteger(page.total) || page.total < 0) incomplete("invalid total");
    if (total !== undefined && total !== page.total) incomplete("total changed between pages");
    total = page.total;
    if (events.length + page.items.length > total) incomplete("items exceed total");

    for (const event of page.items) {
      if (!event || !Number.isSafeInteger(event.id) || event.id <= 0) incomplete("invalid event ID");
      if (ids.has(event.id)) incomplete(`duplicate event ID ${event.id}`);
      ids.add(event.id);
      events.push(event);
    }

    if (page.items.length < PAGE_SIZE) {
      if (events.length !== total) incomplete("page ended before total was reached");
      return events;
    }
    // A full final page still needs an empty terminal request. Stable totals and
    // unique IDs bound progress; premature short pages fail rather than spin.
  }
}

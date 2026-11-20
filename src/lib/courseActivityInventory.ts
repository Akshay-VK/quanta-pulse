import { api } from "./api";
import type { ChangeEvent } from "./types";

const PAGE_SIZE = 2000;

function incomplete(reason: string): never {
  throw new Error(`Course Activity inventory incomplete: ${reason}. Retry refresh.`);
}

/**
 * Complete one course's range traversal in unchanged backend order/membership.
 * A full last page requires an empty terminal request. Offset paging supplies
 * neither a total nor an atomic snapshot: concurrent edits can shift membership.
 */
export async function queryCourseActivityInventory(courseId: number): Promise<ChangeEvent[]> {
  if (!Number.isSafeInteger(courseId) || courseId <= 0) incomplete("invalid course ID");
  const items: ChangeEvent[] = [];
  const ids = new Set<number>();
  for (;;) {
    const page = await api.eventsRange(undefined, undefined, courseId, PAGE_SIZE, items.length);
    if (!Array.isArray(page) || page.length > PAGE_SIZE) incomplete("invalid page");
    for (const event of page) {
      if (!event || !Number.isSafeInteger(event.id) || event.id <= 0) incomplete("invalid event ID");
      if (event.courseId !== courseId) incomplete("mismatched course ID");
      if (ids.has(event.id)) incomplete(`duplicate event ID ${event.id}`);
      ids.add(event.id);
      items.push(event);
    }
    if (page.length < PAGE_SIZE) return items;
  }
}

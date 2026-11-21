import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { DueFilter, DueResource, InboxFilter, InboxPage, Resource } from '../lib/types';

/** Collection owner. Totals come from complete queries, never loaded row counts. */
export function useInbox() {
  const [filter, setFilter] = useState<InboxFilter>({});
  const [page, setPage] = useState<InboxPage | null>(null);
  const [global, setGlobal] = useState<InboxPage | null>(null);
  const [pending, setPending] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const globalGeneration = useRef(0);
  const inFlight = useRef(false);
  const offset = useRef(0);
  const load = useCallback(async (append = false) => {
    if (append && inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    const start = append ? offset.current : 0;
    setPending(true);
    try {
      const next = await api.queryInbox({ ...filter, offset: start, limit: 50 });
      if (request !== generation.current) return;
      offset.current = start + next.items.length;
      setPage(previous => append && previous ? { ...next, items: [...new Map([...previous.items, ...next.items].map(item => [item.key, item])).values()] } : next);
      setError(null);
    } catch (err) {
      if (request === generation.current) setError(String(err));
    } finally {
      if (request === generation.current) { inFlight.current = false; setPending(false); }
    }
  }, [filter]);
  const refreshGlobal = useCallback(async () => {
    const request = ++globalGeneration.current;
    try {
      const next = await api.queryInbox({});
      if (request === globalGeneration.current) { setGlobal(next); setCountError(null); }
    } catch (err) { if (request === globalGeneration.current) setCountError(`Unread counts could not refresh: ${String(err)}`); }
  }, []);
  const refresh = useCallback(async () => { await Promise.all([load(), refreshGlobal()]); }, [load, refreshGlobal]);
  useEffect(() => { void load(); return () => { ++generation.current; }; }, [load]);
  useEffect(() => { void refreshGlobal(); return () => { ++globalGeneration.current; }; }, [refreshGlobal]);
  return { filter, setFilter, page, global, pending, error, countError, refresh, loadMore: () => void load(true) };
}
export type InboxState = ReturnType<typeof useInbox>;

/** Read every page before publishing a due snapshot. Partial inventories are never totals. */
export function useDueInventory(filter: DueFilter) {
  const [items, setItems] = useState<DueResource[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setPending(true);
    try {
      const all: DueResource[] = [];
      let total = Infinity;
      while (all.length < total) {
        const page = await api.queryDueResources({ ...filter, offset: all.length, limit: 1000 });
        if (request !== generation.current) return;
        total = page.total;
        if (!page.items.length && all.length < total) throw new Error('Due inventory changed while loading. Retry to refresh.');
        all.push(...page.items);
      }
      if (request === generation.current) { setItems(all); setError(null); }
    } catch (err) { if (request === generation.current) setError(String(err)); }
    finally { if (request === generation.current) setPending(false); }
  }, [filter]);
  useEffect(() => { void refresh(); return () => { ++generation.current; }; }, [refresh]);
  return { items, pending, error, refresh };
}
export type DueState = ReturnType<typeof useDueInventory>;

/** Inspector enrichment must not misidentify a resource beyond the legacy default page as orphaned. */
export async function queryResourceInventory(): Promise<Resource[]> {
  try {
    const snapshot = await api.listSearchInventory();
    return snapshot.resources;
  } catch {
    const items: Resource[] = [];
    for (;;) {
      const page = await api.listResources({ offset: items.length, limit: 2000 });
      items.push(...page);
      if (page.length < 2000) return items;
    }
  }
}

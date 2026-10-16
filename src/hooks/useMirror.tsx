// The mirror's state for the whole app: per-resource statuses (rows) plus the
// aggregate stats (sidebar, Settings > Files). One listener, one fetch, shared
// through context so no view polls on its own.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import type { LocalFileStatus, MirrorStats } from "../lib/types";

interface MirrorValue {
  stats: MirrorStats | null;
  /** resourceId -> status row; absent when nothing is known about it. */
  statuses: Map<number, LocalFileStatus>;
  refresh: () => Promise<void>;
  startBackfill: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retryFailed: () => Promise<void>;
  verify: () => Promise<void>;
  deleteAll: () => Promise<void>;
  /** Status row for one resource, or null when it has no local copy yet. */
  statusOf: (resourceId: number | null | undefined) => LocalFileStatus | null;
}

const MirrorContext = createContext<MirrorValue | null>(null);

function emptyStats(): MirrorStats {
  return {
    queued: 0,
    downloading: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    kept: 0,
    totalResources: 0,
    bytesDone: 0,
    bytesTotal: 0,
    state: "idle",
    root: "",
    freeBytes: 0,
  };
}

export function MirrorProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<MirrorStats | null>(null);
  const [statuses, setStatuses] = useState<Map<number, LocalFileStatus>>(() => new Map());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [next, rows] = await Promise.all([api.mirrorStats(), api.mirrorLocalFiles()]);
      if (!alive.current) return;
      setStats(next);
      setStatuses(new Map(rows.map((row) => [row.resourceId, row])));
    } catch {
      // Stats are a convenience; rows still work off the events below.
    }
  }, []);

  // Backend events keep both halves current without polling.
  useEffect(() => {
    const unlisten: (() => void)[] = [];
    let cancelled = false;

    void (async () => {
      const stopProgress = await listen<MirrorStats>("mirror:progress", (event) => {
        setStats(event.payload);
      });
      const stopFile = await listen<LocalFileStatus & { resourceId: number }>(
        "mirror:file",
        (event) => {
          const { resourceId, status, error } = event.payload;
          setStatuses((current) => {
            const next = new Map(current);
            next.set(resourceId, { resourceId, status, error: error ?? null });
            return next;
          });
        },
      );
      if (cancelled) {
        stopProgress();
        stopFile();
      } else {
        unlisten.push(stopProgress, stopFile);
      }
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<MirrorValue>(() => {
    const apply = async (action: () => Promise<MirrorStats>) => {
      try {
        setStats(await action());
      } catch {
        await refresh();
      }
    };
    return {
      stats: stats ?? emptyStats(),
      statuses,
      refresh,
      startBackfill: () => apply(() => api.mirrorStartBackfill()),
      pause: () => apply(() => api.mirrorPause()),
      resume: () => apply(() => api.mirrorResume()),
      retryFailed: () => apply(() => api.mirrorRetryFailed()),
      verify: () => apply(() => api.mirrorVerifyFiles()),
      deleteAll: () => apply(() => api.mirrorDeleteAll()),
      statusOf: (resourceId) =>
        resourceId == null ? null : statuses.get(resourceId) ?? null,
    };
  }, [stats, statuses, refresh]);

  return <MirrorContext.Provider value={value}>{children}</MirrorContext.Provider>;
}

/** Mirror state, or null when the provider is not mounted (tests, Storybook). */
export function useMirror(): MirrorValue | null {
  return useContext(MirrorContext);
}

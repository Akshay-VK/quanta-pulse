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
import type { LocalFile, LocalFileStatus, MirrorDownloadProgress, MirrorStats } from "../lib/types";

interface MirrorValue {
  stats: MirrorStats | null;
  /** resourceId -> status row; absent when nothing is known about it. */
  statuses: Map<number, LocalFileStatus>;
  downloads: Map<number, MirrorDownloadProgress>;
  refresh: () => Promise<void>;
  /** Reconcile a point lookup with events received while it was pending. */
  lookupLocalFile: (resourceId: number) => Promise<LocalFile | null>;
  /** Publish an on-demand download result to all rows and details. */
  ensureLocal: (resourceId: number) => Promise<LocalFile>;
  cancelDownload: (resourceId: number) => Promise<void>;
  retryDownload: (resourceId: number) => Promise<MirrorDownloadProgress>;
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
  const [downloads, setDownloads] = useState<Map<number, MirrorDownloadProgress>>(() => new Map());
  const attempts = useRef(new Map<number, string>());
  const downloadRevisions = useRef(new Map<number, number>());
  const downloadAttemptRevisions = useRef(new Map<number, number>());
  const reconcilingDownloads = useRef(false);
  const reconcileDownloadsAgain = useRef(false);
  const alive = useRef(true);
  const fileRevision = useRef(0);
  const fileRevisions = useRef(new Map<number, number>());
  const refreshGeneration = useRef(0);
  const lookupGenerations = useRef(new Map<number, number>());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const recordFile = useCallback((resourceId: number, file: LocalFileStatus | null) => {
    fileRevisions.current.set(resourceId, ++fileRevision.current);
    setStatuses((current) => {
      const next = new Map(current);
      if (file) next.set(resourceId, file);
      else next.delete(resourceId);
      return next;
    });
  }, []);

  const lookupLocalFile = useCallback(async (resourceId: number) => {
    const generation = (lookupGenerations.current.get(resourceId) ?? 0) + 1;
    lookupGenerations.current.set(resourceId, generation);
    const revision = fileRevisions.current.get(resourceId);
    const file = await api.mirrorLocalFile(resourceId);
    if (alive.current && lookupGenerations.current.get(resourceId) === generation &&
        fileRevisions.current.get(resourceId) === revision) recordFile(resourceId, file);
    return file;
  }, [recordFile]);

  const ensureLocal = useCallback(async (resourceId: number) => {
    const file = await api.ensureLocal(resourceId);
    if (alive.current) recordFile(resourceId, file);
    return file;
  }, [recordFile]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const revision = fileRevision.current;
    const downloadRevision = new Map(downloadRevisions.current);
    const attemptRevision = new Map(downloadAttemptRevisions.current);
    try {
      const [next, rows, progressResult] = await Promise.all([api.mirrorStats(), api.mirrorLocalFiles(), api.mirrorDownloadProgress()]);
      if (!alive.current || generation !== refreshGeneration.current) return;
      const progress = Array.isArray(progressResult) ? progressResult : [];
      setStats(next);
      setDownloads((current) => {
        const snapshot = new Map(progress.map((item) => [item.resourceId, item]));
        for (const [id, item] of current) {
          const retryCompleted = downloadAttemptRevisions.current.get(id) !== attemptRevision.get(id);
          const sameAttemptAdvanced = downloadRevisions.current.get(id) !== downloadRevision.get(id) &&
            snapshot.get(id)?.attemptId === item.attemptId;
          if (retryCompleted || sameAttemptAdvanced) snapshot.set(id, item);
        }
        attempts.current.clear();
        for (const item of snapshot.values()) attempts.current.set(item.resourceId, item.attemptId);
        return snapshot;
      });
      setStatuses((current) => {
        const snapshot = new Map(rows.map((row) => [row.resourceId, row]));
        // File events received after this request began are fresher than its snapshot.
        for (const [id, updated] of fileRevisions.current) {
          if (updated <= revision) continue;
          const status = current.get(id);
          if (status) snapshot.set(id, status);
          else snapshot.delete(id);
        }
        return snapshot;
      });
    } catch {
      // Stats are a convenience; rows still work off the events below.
    }
  }, []);

  // Attempt IDs are opaque. Verify an unfamiliar event against the backend
  // instead of letting an old queued event establish or replace its identity.
  const reconcileDownloads = useCallback(() => {
    if (!alive.current) return;
    reconcileDownloadsAgain.current = true;
    if (reconcilingDownloads.current) return;
    reconcilingDownloads.current = true;
    void (async () => {
      do {
        reconcileDownloadsAgain.current = false;
        await refresh();
      } while (alive.current && reconcileDownloadsAgain.current);
    })().finally(() => { reconcilingDownloads.current = false; });
  }, [refresh]);

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
          recordFile(resourceId, { resourceId, status, error: error ?? null });
        },
      );
      const stopFileProgress = await listen<MirrorDownloadProgress>("mirror:file-progress", (event) => {
        const item = event.payload;
        if (!alive.current || cancelled) return;
        const currentAttempt = attempts.current.get(item.resourceId);
        if (currentAttempt !== item.attemptId) {
          reconcileDownloads();
          return;
        }
        downloadRevisions.current.set(item.resourceId, (downloadRevisions.current.get(item.resourceId) ?? 0) + 1);
        setDownloads((current) => new Map(current).set(item.resourceId, item));
      });
      if (cancelled) {
        stopProgress();
        stopFile();
        stopFileProgress();
      } else {
        unlisten.push(stopProgress, stopFile, stopFileProgress);
        reconcileDownloads();
      }
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((stop) => stop());
    };
  }, [recordFile, reconcileDownloads]);

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
      lookupLocalFile,
      ensureLocal,
      downloads,
      cancelDownload: async (resourceId) => { await api.cancelMirrorDownload(resourceId); },
      retryDownload: async (resourceId) => {
        const next = await api.retryMirrorDownload(resourceId);
        if (!alive.current) return next;
        attempts.current.set(resourceId, next.attemptId);
        downloadAttemptRevisions.current.set(resourceId, (downloadAttemptRevisions.current.get(resourceId) ?? 0) + 1);
        downloadRevisions.current.set(resourceId, (downloadRevisions.current.get(resourceId) ?? 0) + 1);
        setDownloads((current) => new Map(current).set(resourceId, next));
        return next;
      },
      startBackfill: () => apply(() => api.mirrorStartBackfill()),
      pause: () => apply(() => api.mirrorPause()),
      resume: () => apply(() => api.mirrorResume()),
      retryFailed: () => apply(() => api.mirrorRetryFailed()),
      verify: () => apply(() => api.mirrorVerifyFiles()),
      deleteAll: () => apply(() => api.mirrorDeleteAll()),
      statusOf: (resourceId) =>
        resourceId == null ? null : statuses.get(resourceId) ?? null,
    };
  }, [stats, statuses, downloads, refresh, lookupLocalFile, ensureLocal]);

  return <MirrorContext.Provider value={value}>{children}</MirrorContext.Provider>;
}

/** Mirror state, or null when the provider is not mounted (tests, Storybook). */
export function useMirror(): MirrorValue | null {
  return useContext(MirrorContext);
}

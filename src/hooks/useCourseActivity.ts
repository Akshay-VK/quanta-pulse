import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { queryCourseActivityInventory } from "../lib/courseActivityInventory";
import type { ChangeEvent } from "../lib/types";

interface ActivityPublication {
  items: ChangeEvent[] | undefined;
  /** Owner of retained rows, which can differ from the requested course. */
  courseId: number | undefined;
  pending: boolean;
  error: string | null;
  scopeReady: boolean;
}

const superseded = () => new Error("Course Activity refresh superseded; retry refresh.");

/** One collection owner; only a completed current traversal grants action scope. */
export function useCourseActivity(courseId: number | null | undefined) {
  const [publication, setPublication] = useState<ActivityPublication>({
    items: undefined, courseId: undefined, pending: false, error: null, scopeReady: false,
  });
  const generation = useRef(0);
  const active = useRef<{ courseId: typeof courseId; mounted: boolean }>({ courseId, mounted: false });

  // Invalidate before passive effects, including route departure and unmount.
  useLayoutEffect(() => {
    active.current = { courseId, mounted: true };
    setPublication(previous => ({ ...previous, pending: courseId != null, scopeReady: false }));
    return () => { active.current.mounted = false; ++generation.current; };
  }, [courseId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!active.current.mounted || active.current.courseId !== courseId) throw superseded();
    if (courseId == null) throw new Error("Course Activity is inactive.");
    const request = ++generation.current;
    const current = () => active.current.mounted && active.current.courseId === courseId && request === generation.current;
    setPublication(previous => ({ ...previous, pending: true, scopeReady: false }));
    try {
      const items = await queryCourseActivityInventory(courseId);
      if (!current()) throw superseded();
      setPublication({ items, courseId, pending: false, error: null, scopeReady: true });
    } catch (error) {
      if (!current()) throw superseded();
      setPublication(previous => ({ ...previous, pending: false, error: String(error), scopeReady: false }));
      throw error;
    }
  }, [courseId]);

  useEffect(() => {
    if (courseId == null) {
      setPublication(previous => ({ ...previous, pending: false, scopeReady: false }));
    } else {
      // Initial load errors are exposed in state; explicit refresh remains rejecting.
      void refresh().catch(() => {});
    }
  }, [courseId, refresh]);

  return {
    ...publication,
    scopeReady: courseId != null && publication.courseId === courseId && publication.scopeReady && !publication.pending && !publication.error,
    refresh,
  };
}

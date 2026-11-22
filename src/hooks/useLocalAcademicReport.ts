import { useEffect, useState, useSyncExternalStore } from "react";
import { academicEpoch, sameAcademicSession, subscribeAcademicSession } from "../lib/academicSession";
import { api } from "../lib/api";
import type { AcademicPage } from "../lib/types";
import { useAcademicPage } from "./useAcademicPage";

/** Reads a local course report on demand, fenced by the active owner and generation. */
export function useLocalAcademicReport<T>(
  courseId: number,
  read: (generation: string, courseId: number) => Promise<AcademicPage<T>>,
) {
  const epoch = useSyncExternalStore(subscribeAcademicSession, academicEpoch);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    courseId: number;
    epoch: number;
    attempt: number;
    page: AcademicPage<T> | null;
    status: "ready" | "locked" | "failed";
  }>();
  useEffect(() => {
    let active = true;
    const publish = (status: "ready" | "locked" | "failed", page: AcademicPage<T> | null = null) => {
      if (active && epoch === academicEpoch()) setResult({ courseId, epoch, attempt, status, page });
    };
    void (async () => {
      try {
        const context = await api.academicContext();
        if (!active || epoch !== academicEpoch()) return;
        if (!context?.owner) {
          publish("locked");
          return;
        }
        const page = await read(context.generation, courseId);
        if (page.courseId !== courseId || !sameAcademicSession(context, page.context)) {
          publish("failed");
          return;
        }
        publish("ready", page);
      } catch {
        publish("failed");
      }
    })();
    return () => { active = false; };
  }, [courseId, epoch, attempt, read]);

  const current = result?.courseId === courseId && result.epoch === epoch && result.attempt === attempt ? result : undefined;
  const page = useAcademicPage(current?.page ?? null);
  const status = current?.status === "ready" && !page ? "locked" : current?.status ?? "loading";
  return { page, status, reload: () => setAttempt(value => value + 1) };
}

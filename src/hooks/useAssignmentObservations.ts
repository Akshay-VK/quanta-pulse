import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { academicContextSnapshot, academicEpoch, currentAcademicPage, sameAcademicSession, subscribeAcademicSession } from "../lib/academicSession";
import { api } from "../lib/api";
import type { AcademicPage, AssignmentObservation } from "../lib/types";

/** Read the private local store only when Agenda or the assignment inspector needs it. */
export function useAssignmentObservations(courseKey: string, refresh: number) {
  useSyncExternalStore(subscribeAcademicSession, academicContextSnapshot);
  const epoch = useSyncExternalStore(subscribeAcademicSession, academicEpoch);
  type Results = { epoch: number; courseKey: string; refresh: number; pages: AcademicPage<AssignmentObservation>[]; failed: Set<number> };
  const [result, setResult] = useState<Results>();
  useEffect(() => {
    if (!courseKey) return;
    let active = true;
    const ids = courseKey.split(",").map(Number);
    void (async () => {
      const pages: Results["pages"] = [];
      const failed = new Set<number>();
      try {
        const context = await api.academicContext();
        if (!active || !context?.owner) return;
        for (const id of ids) {
          if (!active || epoch !== academicEpoch()) return;
          try {
            const page = await api.academicAssignments(context.generation, id);
            if (page.courseId === id && sameAcademicSession(context, page.context)) pages.push(page);
            else failed.add(id);
          } catch {
            failed.add(id);
          }
        }
      } catch {
        ids.forEach(id => failed.add(id));
      }
      if (active && epoch === academicEpoch()) setResult({ epoch, courseKey, refresh, pages, failed });
    })();
    return () => { active = false; };
  }, [courseKey, refresh, epoch]);

  const current = academicContextSnapshot();
  return useMemo(() => {
    if (result?.epoch !== epoch || result.courseKey !== courseKey || result.refresh !== refresh) {
      return { pages: [], failed: new Set<number>() };
    }
    return { pages: result.pages.filter(page => current && currentAcademicPage(page)), failed: result.failed };
  }, [result, courseKey, refresh, epoch, current]);
}

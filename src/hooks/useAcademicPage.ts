import { useSyncExternalStore } from "react";
import { academicContextSnapshot, currentAcademicPage, subscribeAcademicSession } from "../lib/academicSession";
import type { AcademicPage } from "../lib/types";

/** Apply only a page still owned by the active session; logout hides it now. */
export function useAcademicPage<T>(page: AcademicPage<T> | null): AcademicPage<T> | null {
  useSyncExternalStore(subscribeAcademicSession, academicContextSnapshot);
  return currentAcademicPage(page);
}

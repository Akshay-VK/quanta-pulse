// Frontend authority for private academic responses. No data is persisted here.
import type { AcademicContext, AcademicPage } from "./types";
let epoch = 0;
let current: AcademicContext | null = null;
const listeners = new Set<() => void>();
export function invalidateAcademicSession(): void {
  epoch += 1;
  current = null;
  listeners.forEach(listener => listener());
}
export function academicEpoch(): number { return epoch; }
export function academicContextSnapshot(): AcademicContext | null { return current; }
export function subscribeAcademicSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function acceptAcademicContext(context: AcademicContext, capturedEpoch: number): void {
  if (capturedEpoch !== epoch) throw new Error("Academic session changed");
  current = context.owner ? context : null;
  listeners.forEach(listener => listener());
}
export function sameAcademicSession(a: AcademicContext, b: AcademicContext): boolean {
  return a.generation === b.generation && a.owner !== null && b.owner !== null &&
    a.owner.origin === b.owner.origin && a.owner.moodleUserId === b.owner.moodleUserId;
}
// Consumers use this at application/render time, as a resolved Promise can
// already be queued when logout invalidates the session.
export function currentAcademicPage<T>(page: AcademicPage<T> | null): AcademicPage<T> | null {
  return page && current && sameAcademicSession(page.context, current) ? page : null;
}

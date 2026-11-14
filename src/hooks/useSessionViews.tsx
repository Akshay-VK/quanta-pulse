import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";

/** Navigation memory belongs to one mounted app session, never module globals or disk. */
const SessionViews = createContext<Map<string, unknown> | null>(null);
export function SessionViewsProvider({ children }: { children: ReactNode }) {
  const values = useRef(new Map<string, unknown>());
  return <SessionViews.Provider value={values.current}>{children}</SessionViews.Provider>;
}

/** Callers remount on identity changes; refreshes retain the mounted state. */
export function useSessionValue<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const session = useContext(SessionViews);
  const [value, setValue] = useState<T>(() => session?.has(key) ? session.get(key) as T : typeof initial === "function" ? (initial as () => T)() : initial);
  const current = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(current.current) : next;
    current.current = resolved;
    session?.set(key, resolved);
    setValue(resolved);
  }, [key, session]);
  return [value, update];
}

/** Save user scroll events and restore after the route's content becomes available. */
export function useSessionScroll(key: string, ref: RefObject<HTMLElement>, ready = true) {
  const session = useContext(SessionViews);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !ready) return;
    element.scrollTop = Number(session?.get(`scroll:${key}`) ?? 0);
    const remember = () => session?.set(`scroll:${key}`, element.scrollTop);
    element.addEventListener("scroll", remember);
    return () => element.removeEventListener("scroll", remember);
  }, [key, ready, ref, session]);
}

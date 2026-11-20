import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThemeMode } from "../lib/types";
import {
  appearanceStorage, applyAppearance, DEFAULT_APPEARANCE, readAppearance,
  saveAppearance, systemPrefersDark, type AppearancePreference, type PersistenceResult,
} from "../lib/appearance";

/** One owner for immediate appearance, persistence and OS subscriptions. */
export function useTheme() {
  const [preference, setPreference] = useState(() => readAppearance(appearanceStorage()).preference);
  const current = useRef(preference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [persistence, setPersistence] = useState<PersistenceResult>("saved");
  const resolved = preference.mode === "system" ? systemDark ? "dark" : "light" : preference.mode;

  useLayoutEffect(() => { applyAppearance(document.documentElement, preference, systemDark); }, [preference, systemDark]);
  useEffect(() => {
    // Migrate eagerly only when safe. Legacy remains as fallback until a write succeeds.
    saveAppearance(appearanceStorage(), current.current);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const changeAppearance = useCallback((patch: Partial<Omit<AppearancePreference, "version">>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setPreference(next);
    setPersistence(saveAppearance(appearanceStorage(), next));
  }, []);
  const setThemeMode = useCallback((mode: ThemeMode) => changeAppearance({ mode }), [changeAppearance]);
  const toggle = useCallback(() => setThemeMode(resolved === "dark" ? "light" : "dark"), [resolved, setThemeMode]);
  const resetAppearance = useCallback(() => changeAppearance(DEFAULT_APPEARANCE), [changeAppearance]);
  return { preference, changeAppearance, resetAppearance, persistence, themeMode: preference.mode, setThemeMode, resolved, toggle };
}
export type AppearanceController = ReturnType<typeof useTheme>;

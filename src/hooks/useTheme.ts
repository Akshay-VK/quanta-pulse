import { useCallback, useEffect, useState } from "react";
import type { ThemeMode } from "../lib/types";

const THEME_KEY = "quanta-pulse-theme";

/** Read the persisted theme mode, defaulting to "system". */
export function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // localStorage may be unavailable; fall through to the default.
  }
  return "system";
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Owns theme mode, resolves it against the OS setting, writes
 * `data-theme` on <html>, and persists the choice. `toggle` flips the
 * resolved theme so "system" becomes an explicit light/dark.
 */
export function useTheme() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readThemeMode);
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    (readThemeMode() === "dark" || (readThemeMode() === "system" && prefersDark()))
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next =
        themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = next;
      setResolved(next);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Persisting the theme is best-effort.
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeMode(resolved === "dark" ? "light" : "dark");
  }, [resolved, setThemeMode]);

  return { themeMode, setThemeMode, resolved, toggle };
}
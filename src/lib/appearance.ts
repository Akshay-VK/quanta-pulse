/** Local appearance model shared by startup, the theme owner and previews. */
import type { ThemeMode } from "./types";
export const APPEARANCE_KEY = "quanta-pulse-appearance";
export const PALETTES = [
  { value: "t3-neutral", label: "T3 Neutral" },
  { value: "soft-graphite", label: "Soft Graphite" },
  { value: "slate", label: "Slate" },
  { value: "ocean", label: "Ocean" },
  { value: "forest", label: "Forest" },
  { value: "iris", label: "Iris" },
] as const;
export const ACCENTS = [
  { value: "default", label: "Palette default" }, { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" }, { value: "teal", label: "Teal" },
  { value: "rose", label: "Rose" }, { value: "amber", label: "Amber" },
] as const;
export interface AppearancePreference {
  version: 1;
  mode: ThemeMode;
  palette: typeof PALETTES[number]["value"];
  accent: typeof ACCENTS[number]["value"];
  density: "comfortable" | "compact";
}
export const DEFAULT_APPEARANCE: AppearancePreference = {
  version: 1, mode: "system", palette: "soft-graphite", accent: "default", density: "comfortable",
};
type StorageReader = Pick<Storage, "getItem">;
type AppearanceStorage = StorageReader & Pick<Storage, "setItem">;
export type PersistenceResult = "saved" | "future" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isMode(value: unknown): value is ThemeMode { return value === "system" || value === "light" || value === "dark"; }
/** Invalid fields fall back independently. Never interpret future records as legacy. */
export function readAppearance(storage: StorageReader): { preference: AppearancePreference; future: boolean } {
  let raw: unknown;
  try {
    const text = storage.getItem(APPEARANCE_KEY);
    try { raw = text === null ? null : JSON.parse(text); } catch { raw = null; }
    if (isRecord(raw) && typeof raw.version === "number" && raw.version > 1) {
      return { preference: { ...DEFAULT_APPEARANCE }, future: true };
    }
    if (isRecord(raw) && raw.version === 1) {
      const palette = raw.palette, selectedAccent = raw.accent;
      return { future: false, preference: {
        version: 1,
        mode: isMode(raw.mode) ? raw.mode : DEFAULT_APPEARANCE.mode,
        palette: PALETTES.find(p => p.value === palette)?.value ?? DEFAULT_APPEARANCE.palette,
        accent: ACCENTS.find(a => a.value === selectedAccent)?.value ?? DEFAULT_APPEARANCE.accent,
        density: raw.density === "compact" ? "compact" : "comfortable",
      } };
    }
    const legacy = storage.getItem("quanta-pulse-theme");
    return { future: false, preference: { ...DEFAULT_APPEARANCE, mode: isMode(legacy) ? legacy : "system" } };
  } catch {
    return { preference: { ...DEFAULT_APPEARANCE }, future: false };
  }
}
/** Preserve future records even on explicit selection; changes still apply in memory. */
export function saveAppearance(storage: AppearanceStorage, preference: AppearancePreference): PersistenceResult {
  try {
    // Do not erase a newer record written by another window after we mounted.
    if (readAppearance(storage).future) return "future";
    storage.setItem(APPEARANCE_KEY, JSON.stringify(preference));
    return "saved";
  } catch { return "unavailable"; }
}

// Each row is authored for its mode, never inverted. Aliases remain in tokens.css.
const surfaceNames = ["bg", "side", "raised", "floating", "hover", "selected", "ink", "muted", "faint", "line", "line-strong"] as const;
type SurfaceTokens = Record<typeof surfaceNames[number], string>;
function surfaces(values: string): SurfaceTokens {
  return Object.fromEntries(values.split(" ").map((v, i) => [surfaceNames[i], v])) as SurfaceTokens;
}
const families: Record<AppearancePreference["palette"], Record<"light" | "dark", SurfaceTokens>> = {
  "t3-neutral": {
    light: surfaces("#fcfcfc #f2f2f2 #ffffff #ffffff #eaeaea #e4e4e4 #171717 #525252 #626262 #d8d8d8 #777777"),
    dark: surfaces("#0a0a0a #111111 #191919 #202020 #282828 #303030 #ededed #b0b0b0 #aaaaaa #353535 #8a8a8a"),
  },
  "soft-graphite": {
    light: surfaces("#f7f8fa #eff0f3 #ffffff #ffffff #e8eaee #dfe3ea #24262b #565a64 #606571 #d5d8df #727986"),
    dark: surfaces("#18191b #151618 #202125 #25262b #2b2d33 #33363e #e6e7ea #a1a4ac #a1a4ac #3c3f47 #8a8f9c"),
  },
  slate: {
    light: surfaces("#f5f7fa #eaf0f6 #ffffff #ffffff #e3eaf2 #dbe4ef #202b3a #4b5c70 #59697b #cfd9e5 #6b7b8f"),
    dark: surfaces("#1a1d23 #161920 #222730 #282e38 #2e3540 #353e4b #e2e8f0 #b0bac9 #a7b4c7 #3f4958 #899db9"),
  },
  ocean: {
    light: surfaces("#f4f8fb #e9f1f6 #ffffff #ffffff #e0edf4 #d5e6ef #1d2d3a #465f70 #526b7b #ccdce6 #648091"),
    dark: surfaces("#171d24 #131a21 #1e2832 #24303c #293745 #303f4d #e0ebf3 #a8bdcd #a5bbce #394d5e #85a5bc"),
  },
  forest: {
    light: surfaces("#f5f8f5 #eaf1eb #ffffff #ffffff #e1ebe3 #d9e5dc #223228 #4c6252 #556b5a #cddccf #6c826f"),
    dark: surfaces("#191e1b #151a17 #222b25 #29322c #2f3a32 #364239 #e3ece5 #adbfaf #a8bdad #405245 #8ca992"),
  },
  iris: {
    light: surfaces("#f8f6fb #f0ecf5 #ffffff #ffffff #e9e3f1 #e2dbee #30283e #61546f #6c5e7a #dcd2e7 #84718f"),
    dark: surfaces("#1d1a23 #19161f #27222f #302a39 #372f42 #40374c #ece5f3 #bdb0cc #bbadcc #50435e #a28bb7"),
  },
};
// Fill, foreground, readable link/focus, restrained selection. Explicit pairs.
const accentNames = ["accent", "on-accent", "link", "focus", "accent-tint"] as const;
type AccentTokens = Record<typeof accentNames[number], string>;
function accent(values: string): AccentTokens {
  return Object.fromEntries(values.split(" ").map((v, i) => [accentNames[i], v])) as AccentTokens;
}
const accents = {
  blue: { light: accent("#285bd4 #ffffff #214fbb #285bd4 #e1eaff"), dark: accent("#86a9ff #101d3b #a6bfff #a6bfff #2b3851") },
  violet: { light: accent("#6941bf #ffffff #6336b4 #6941bf #eee5ff"), dark: accent("#bba2f5 #24143e #cbb6ff #cbb6ff #3d3150") },
  teal: { light: accent("#176d70 #ffffff #126266 #176d70 #d8efee"), dark: accent("#7dc9c5 #102d2d #9bdcd8 #9bdcd8 #263c3c") },
  rose: { light: accent("#af365d #ffffff #9d2e52 #af365d #f8e1ea"), dark: accent("#eea0ba #381322 #f7b4cc #f7b4cc #4d303f") },
  amber: { light: accent("#875700 #ffffff #795000 #875700 #f5e8cc"), dark: accent("#e8bd73 #30210c #f1cb8b #f1cb8b #403524") },
};
const defaults: Record<AppearancePreference["palette"], Record<"light" | "dark", AccentTokens>> = {
  "t3-neutral": { light: accent("#285bd4 #ffffff #214fbb #285bd4 #e1eaff"), dark: accent("#346bf1 #ffffff #90b1ff #90b1ff #202e4b") },
  "soft-graphite": accents.blue,
  slate: { light: accent("#486489 #ffffff #3d587d #486489 #e0e9f5"), dark: accent("#9fb4d8 #17263e #b7cae8 #b7cae8 #313c50") },
  ocean: { light: accent("#316e94 #ffffff #286184 #316e94 #dceef9"), dark: accent("#82b9dc #102b3b #a0cfee #a0cfee #2b4051") },
  forest: { light: accent("#486e51 #ffffff #3c6045 #486e51 #e0efe2"), dark: accent("#94b99e #182e20 #b1d1ba #b1d1ba #32443a") },
  iris: { light: accent("#705499 #ffffff #634787 #705499 #eee5f9"), dark: accent("#b7a4e1 #291d40 #cebbf4 #cebbf4 #41364f") },
};

export function resolveAppearance(preference: AppearancePreference, systemDark: boolean) {
  const mode = preference.mode === "system" ? systemDark ? "dark" : "light" : preference.mode;
  const base = families[preference.palette][mode];
  const emphasis = (preference.accent === "default" ? defaults[preference.palette] : accents[preference.accent])[mode];
  return { mode, tokens: {
    ...base, ...emphasis, selected: emphasis["accent-tint"],
    "ink-hover": base.ink, "control-knob": emphasis["on-accent"], "disabled-bg": base.side, "disabled-fg": base.muted,
    "row-h": preference.density === "compact" ? "36px" : "44px",
  } };
}
/** Same synchronous application path for the initial frame and React updates. */
export function applyAppearance(root: HTMLElement, preference: AppearancePreference, systemDark: boolean) {
  const resolved = resolveAppearance(preference, systemDark);
  root.dataset.theme = resolved.mode;
  root.dataset.palette = preference.palette;
  root.dataset.accent = preference.accent;
  root.dataset.density = preference.density;
  root.style.colorScheme = resolved.mode;
  Object.entries(resolved.tokens).forEach(([name, value]) => root.style.setProperty(`--${name}`, value));
  return resolved.mode;
}

/** Access can throw before getItem in restricted webviews. Keep that out of callers. */
export function appearanceStorage(): AppearanceStorage {
  try { return window.localStorage; } catch {
    return { getItem() { throw Error("Storage unavailable"); }, setItem() { throw Error("Storage unavailable"); } };
  }
}
export function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

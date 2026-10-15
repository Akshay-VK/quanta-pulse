/** Platform helpers. macOS drives the Command glyph and the traffic-light inset. */

/** True when the app is running on macOS. */
export function isMac(): boolean {
  try {
    return navigator.platform.toLowerCase().includes("mac");
  } catch {
    return false;
  }
}

/** Label for the primary modifier: the Command glyph on macOS, "Ctrl" elsewhere. */
export function modSymbol(): string {
  return isMac() ? "\u2318" : "Ctrl";
}

/** Format a shortcut like "Mod+Shift+S" for display on this platform. */
export function formatShortcut(keys: string): string {
  return keys.replace(/Mod/g, modSymbol());
}
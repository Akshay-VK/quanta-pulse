import { useEffect } from "react";
import { tinykeys } from "tinykeys";

/** A tinykeys binding map, e.g. `{ "$mod+k": () => open() }`. */
export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

/**
 * Bind global keyboard shortcuts. tinykeys already ignores events that
 * originate in text fields (input/textarea/select/contenteditable), so
 * typing never triggers a shortcut. Pass `enabled: false` while a modal or
 * palette owns the keyboard.
 */
export function useHotkey(bindings: HotkeyMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const entries = Object.entries(bindings);
    if (entries.length === 0) return;
    const unbind = tinykeys(window, Object.fromEntries(entries));
    return unbind;
  });
}
import { useEffect } from "react";
import { createKeybindingsHandler } from "tinykeys";

/** A tinykeys binding map, e.g. `{ "$mod+k": () => open() }`. */
export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

/**
 * Bind global shortcuts while keeping text editing safe. Mod+K remains
 * available from an editor so the palette can always be opened.
 */
export function useHotkey(bindings: HotkeyMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const entries = Object.entries(bindings);
    if (entries.length === 0) return;
    const keybindings = Object.fromEntries(entries);
    const handler = createKeybindingsHandler(keybindings, {
      ignore: (event) => {
        if (event.repeat || event.isComposing || event.keyCode === 229) return true;
        const target = event.target;
        const editing = target instanceof Element && target.matches(
          "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
        );
        if (!editing) return false;
        const mod = navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
        const onlyMod = mod && !event.altKey && !event.shiftKey && !(navigator.platform.toLowerCase().includes("mac") ? event.ctrlKey : event.metaKey);
        if ((onlyMod && event.key.toLowerCase() === "k") || event.key === "Escape") return false;
        return true;
      },
    });
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
}

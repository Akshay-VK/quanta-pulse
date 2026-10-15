import { formatShortcut } from "../../lib/platform";

/** A keyboard key hint. "Mod" renders as ⌘ on macOS and "Ctrl" elsewhere. */
export function Kbd({ keys }: { keys: string }) {
  return <kbd className="kbd">{formatShortcut(keys)}</kbd>;
}
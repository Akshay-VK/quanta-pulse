import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Kbd } from "./ui/Kbd";

const shortcuts = [
  ["Move between rows", "J / K"],
  ["Open details", "Enter"],
  ["Preview or close Quick Look", "Space"],
  ["Mark read or unread", "E / U"],
  ["Dismiss", "Del"],
  ["Select multiple items", "X"],
  ["Command palette", "Mod+K"],
  ["Go to Inbox, Calendar, Library, or History", "G then I / C / L / H"],
  ["Open saved copy", "Mod+O"],
  ["Search the current view", "/"],
  ["Jump to today in Agenda", "T"],
  ["Mark all Inbox items read", "Shift+A"],
  ["Rescan Quanta", "Mod+R"],
] as const;

export default function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} label="Keyboard shortcuts" className="dialog-confirm shortcuts-dialog">
      <h2 className="dialog-title">Keyboard shortcuts</h2>
      <dl className="shortcut-list">
        {shortcuts.map(([label, keys]) => <div key={label}>
          <dt>{label}</dt>
          <dd><Kbd keys={keys} /></dd>
        </div>)}
      </dl>
      <div className="dialog-footer"><Button className="dialog-primary" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></div>
    </Dialog>
  );
}

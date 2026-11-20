import type { ReactNode } from "react";
import { formatShortcut } from "../lib/platform";

export function WorkspaceViewHeader({ title, tabs, actions }: { title: string; tabs?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="workspace-view-header">
      <h1>{title}</h1>
      {tabs}
      {actions && <div className="workspace-view-header-actions">{actions}</div>}
    </header>
  );
}

export function WorkspaceViewStatus({ children, hints }: { children: ReactNode; hints: readonly (readonly [string, string])[] }) {
  return (
    <footer className="workspace-view-status" aria-label="View status">
      <span className="workspace-view-status-text">{children}</span>
      <div className="workspace-view-shortcuts">
        {hints.map(([keys, label]) => <span key={label}><kbd>{formatShortcut(keys)}</kbd>{label}</span>)}
      </div>
    </footer>
  );
}

export const INBOX_HINTS = [["J K", "Navigate"], ["E", "Mark read"], ["Space", "Preview"], ["Mod+K", "Command"]] as const;
export const ACTIVITY_HINTS = [["J K", "Navigate"], ["Enter", "Open"], ["Space", "Preview"], ["Mod+K", "Command"]] as const;
export const AGENDA_HINTS = [["T", "Today"], ["J K", "Navigate"], ["Mod+K", "Command"]] as const;

import type { ReactNode } from "react";
import { Kbd } from "../../components/ui/Kbd";

export function LibraryHeader({ title, tabs, actions }: {
  title: ReactNode;
  tabs: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="library-panel-header">
      <h1 className="library-panel-title">{title}</h1>
      {tabs}
      <div className="library-panel-actions">{actions}</div>
    </header>
  );
}

export function LibraryFooter({ children, course, folders = course }: {
  children: ReactNode;
  course?: boolean;
  folders?: boolean;
}) {
  return (
    <footer className="library-panel-footer">
      <span className="library-panel-summary">{children}</span>
      <div className="library-keyboard-hints">
        {folders && <span><Kbd keys="← →" /> Collapse / expand</span>}
        <span><Kbd keys="J K" /> Navigate</span>
        {!course && <span><Kbd keys="Enter" /> Open</span>}
        {!course && <span><Kbd keys="Space" /> Preview</span>}
        <span><Kbd keys="Mod+K" /> Command</span>
      </div>
    </footer>
  );
}

import { useRef, type ReactNode } from "react";
import { Title as DialogTitle } from "@radix-ui/react-dialog";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { Dialog } from "./ui/Dialog";

/** Stable placement contract for view-owned workspace regions. */
export interface WorkspacePanelProps {
  /** Fixed 30px panel status bar; callers provide its metadata and hints. */
  status?: ReactNode;
  /** Optional 40px route toolbar, omitted when the route owns it internally. */
  toolbar?: ReactNode;
  /** Optional full-width region above the view content. */
  due?: ReactNode;
  /** Existing route content, including its own title and toolbar. */
  content: ReactNode;
  /** Pass only an open inspector; null when the selection is closed. */
  inspector?: ReactNode;
  onCloseInspector?: () => void;
  /** App-owned row/heading restoration after a narrow modal releases focus. */
  onRestoreInspectorFocus?: () => void;
}

/** The main panel body and its stable status/content/inspector slots. */
export default function WorkspacePanel({ status, toolbar, due, content, inspector, onCloseInspector, onRestoreInspectorFocus }: WorkspacePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const narrowInspector = useMediaQuery("(max-width: 1099px)");
  return (
    <>
      <div className="workspace-panel" ref={panelRef}>
        <div className="workspace-content">
          {toolbar != null && <div className="workspace-toolbar-slot" data-shell-slot="toolbar">{toolbar}</div>}
          {due != null && <div className="workspace-due-slot" data-shell-slot="due">{due}</div>}
          <div className="workspace-route-slot" data-shell-slot="content">{content}</div>
        </div>
        {narrowInspector && inspector && onCloseInspector ? (
          <Dialog
            open
            onOpenChange={(open) => { if (!open) onCloseInspector(); }}
            label="Material details"
            container={panelRef.current ?? undefined}
            className="workspace-inspector-dialog"
            overlayClassName="workspace-inspector-scrim"
            onCloseAutoFocus={onRestoreInspectorFocus ? (event) => {
              event.preventDefault();
              onRestoreInspectorFocus();
            } : undefined}
          >
            <DialogTitle className="sr-only">Material details</DialogTitle>
            {inspector}
          </Dialog>
        ) : inspector}
      </div>
      <footer className="workspace-statusbar" data-shell-slot="status" aria-label="Workspace status">
        {status}
      </footer>
    </>
  );
}

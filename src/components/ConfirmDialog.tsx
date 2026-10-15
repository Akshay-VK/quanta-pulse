import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

/**
 * A confirmation modal. The confirm action may be async; while it runs the
 * dialog cannot be dismissed and both buttons disabled. Focus starts on Cancel.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (!running) onOpenChange(false);
  };

  const confirm = async () => {
    // A ref guard: `running` alone cannot block a second click inside the same
    // event loop turn, which would double-fire the action.
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller renders the failure inside the dialog body and stays open.
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && running) return;
        onOpenChange(next);
      }}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={bodyId}
      className="dialog-confirm"
      initialFocusRef={cancelRef}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      <div id={bodyId} className="dialog-body">
        {body}
      </div>
      <div className="dialog-footer">
        <button
          ref={cancelRef}
          type="button"
          className="btn btn-secondary"
          onClick={close}
          disabled={running}
        >
          <span className="btn-label">{cancelLabel}</span>
        </button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={() => void confirm()}
          loading={running}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
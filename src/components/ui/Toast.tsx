import * as ToastPrimitive from "@radix-ui/react-toast";
import { Check, CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/cx";

export interface ToastItem {
  id: number;
  message: string;
  error?: boolean;
  action?: { label: string; onClick: () => void };
}

function ToastEntry({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [open, setOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const ToastIcon = toast.error ? CircleAlert : Check;

  return (
    <ToastPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && !timer.current) {
          timer.current = setTimeout(() => onDismiss(toast.id), 140);
        }
      }}
      type={toast.error ? "foreground" : "background"}
      role={toast.error ? "alert" : "status"}
      aria-live={toast.error ? "assertive" : "polite"}
      className={cx("toast", toast.error && "toast-error")}
    >
      <ToastIcon size={16} className="toast-icon" aria-hidden="true" />
      <ToastPrimitive.Description className="toast-message">{toast.message}</ToastPrimitive.Description>
      {toast.action && (
        <ToastPrimitive.Action asChild altText={toast.action.label}>
          <button type="button" className="toast-action" onClick={toast.action.onClick}>{toast.action.label}</button>
        </ToastPrimitive.Action>
      )}
      <ToastPrimitive.Close asChild>
        <button type="button" className="toast-close" aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

/** Stack active feedback in the lower-right. Each notice pauses while the stack is in use. */
export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <ToastPrimitive.Provider swipeDirection="down" duration={6000}>
      {toasts.slice(0, 3).map((toast) => <ToastEntry key={toast.id} toast={toast} onDismiss={onDismiss} />)}
      <ToastPrimitive.Viewport className="toast-viewport" />
    </ToastPrimitive.Provider>
  );
}

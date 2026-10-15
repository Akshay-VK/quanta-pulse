import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "../../lib/cx";

export interface ToastItem {
  id: number;
  message: string;
  error?: boolean;
  action?: { label: string; onClick: () => void };
}

/**
 * Shows one toast at a time from the head of `toasts`; the rest stay queued.
 * Auto-dismisses (6 s errors, 4 s otherwise), pauses on hover and supports
 * swipe / Escape dismissal.
 */
export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const head = toasts[0] ?? null;
  const [rendered, setRendered] = useState<ToastItem | null>(head);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (head && (!rendered || head.id !== rendered.id)) {
      setRendered(head);
      setOpen(true);
    } else if (!head && rendered) {
      setOpen(false);
    }
  }, [head, rendered]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && rendered) {
      const id = rendered.id;
      // Hold the node briefly so the exit fade plays before unmounting.
      window.setTimeout(() => {
        onDismiss(id);
        setRendered(null);
      }, 140);
    }
  };

  return (
    <ToastPrimitive.Provider
      swipeDirection="down"
      duration={rendered?.error ? 6000 : 4000}
    >
      {rendered && (
        <ToastPrimitive.Root
          key={rendered.id}
          open={open}
          onOpenChange={handleOpenChange}
          type={rendered.error ? "foreground" : "background"}
          role={rendered.error ? "alert" : "status"}
          aria-live={rendered.error ? "assertive" : "polite"}
          className={cx("toast", rendered.error && "toast-error")}
        >
          <ToastPrimitive.Description className="toast-message">
            {rendered.message}
          </ToastPrimitive.Description>
          {rendered.action && (
            <ToastPrimitive.Action asChild altText={rendered.action.label}>
              <button
                type="button"
                className="toast-action"
                onClick={rendered.action.onClick}
              >
                {rendered.action.label}
              </button>
            </ToastPrimitive.Action>
          )}
          <ToastPrimitive.Close asChild>
            <button type="button" className="toast-close" aria-label="Dismiss">
              <X aria-hidden="true" />
            </button>
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      )}
      <ToastPrimitive.Viewport className="toast-viewport" />
    </ToastPrimitive.Provider>
  );
}
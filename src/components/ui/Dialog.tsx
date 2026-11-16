import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef, type ReactNode, type RefObject } from "react";
import { cx } from "../../lib/cx";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name when there is no visible title element. */
  label?: string;
  /** Id of a visible title element, for aria-labelledby. */
  labelledBy?: string;
  /** Id of the description element, for aria-describedby. */
  describedBy?: string;
  role?: "dialog" | "alertdialog";
  className?: string;
  /** Keep a modal portal inside a shell-owned container when needed. */
  container?: HTMLElement;
  overlayClassName?: string;
  /** Element to focus when the dialog opens. */
  initialFocusRef?: RefObject<HTMLElement>;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}

/**
 * A modal. Centred, 8 px radius, 32 px padding, 2 px accent focus ring;
 * scrim fades in, panel scales from 0.98 over 160 ms.
 */
export function Dialog({
  open,
  onOpenChange,
  label,
  labelledBy,
  describedBy,
  role = "dialog",
  className,
  container,
  overlayClassName,
  initialFocusRef,
  onCloseAutoFocus,
  children,
}: DialogProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  if (open && !wasOpen.current) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    wasOpen.current = true;
  } else if (!open) {
    wasOpen.current = false;
  }
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className={cx("dialog-overlay", overlayClassName)} />
        <DialogPrimitive.Content
          ref={contentRef}
          className={cx("dialog-content", className)}
          role={role}
          aria-modal="true"
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          onKeyDown={(event) => {
            // A background toast can become the highest Radix layer. Escape
            // from this modal still belongs here unless a nested layer used it.
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              onOpenChange(false);
            }
          }}
          onOpenAutoFocus={(event) => {
            if (initialFocusRef) {
              event.preventDefault();
              initialFocusRef.current?.focus();
              return;
            }
            const primary = contentRef.current?.querySelector<HTMLElement>("[data-dialog-primary], .dialog-primary");
            if (primary) {
              event.preventDefault();
              primary.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (onCloseAutoFocus) onCloseAutoFocus(event);
            else if (returnFocus.current?.isConnected) {
              // Controlled dialogs (e.g. Preview) have no Radix Trigger.
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          {children}
          {!describedBy && (
            <DialogPrimitive.Description className="sr-only">
              {label ?? "Dialog"}
            </DialogPrimitive.Description>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

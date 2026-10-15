import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode, RefObject } from "react";
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
  initialFocusRef,
  onCloseAutoFocus,
  children,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={cx("dialog-content", className)}
          role={role}
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          onOpenAutoFocus={
            initialFocusRef
              ? (event) => {
                  event.preventDefault();
                  initialFocusRef.current?.focus();
                }
              : undefined
          }
          onCloseAutoFocus={onCloseAutoFocus}
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
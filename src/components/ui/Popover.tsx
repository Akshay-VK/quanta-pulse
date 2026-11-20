import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";

/** A click-triggered floating panel. The trigger is provided by the caller. */
export function Popover({
  trigger,
  children,
  align = "end",
  side = "bottom",
  className,
  label,
  open,
  onOpenChange,
  role = "dialog",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  role?: "dialog" | "search";
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className={className ? `popover ${className}` : "popover"}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          role={role}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

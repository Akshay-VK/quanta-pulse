import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";

/** A click-triggered floating panel. The trigger is provided by the caller. */
export function Popover({
  trigger,
  children,
  align = "end",
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  label?: string;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="popover"
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
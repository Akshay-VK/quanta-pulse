import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ReactNode } from "react";

/** An expand/collapse region whose height animates. */
export function Collapsible({
  open,
  onOpenChange,
  trigger,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    >
      <CollapsiblePrimitive.Trigger asChild>
        {trigger}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="collapsible-content">
        <div className="collapsible-inner">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
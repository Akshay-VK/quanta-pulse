import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { formatShortcut } from "../../lib/platform";

/** Wrap the app once so tooltips share the open/close delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/** A short hover/focus label. `content` may be empty to render children bare. */
export function Tooltip({
  content,
  children,
  side = "bottom",
  shortcut,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Optional shortcut rendered as a readable keycap beside the label. */
  shortcut?: string;
}) {
  if (!content && !shortcut) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="tooltip"
          side={side}
          sideOffset={6}
          collisionPadding={8}
        >
          <span>{content}</span>
          {shortcut && <kbd className="tooltip-keycap">{formatShortcut(shortcut)}</kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

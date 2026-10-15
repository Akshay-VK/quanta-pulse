import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { formatShortcut } from "../../lib/platform";

export interface MenuItemSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

/** An anchored action menu. The trigger element is provided by the caller. */
export function Menu({
  trigger,
  items,
  align = "end",
  label,
}: {
  trigger: ReactNode;
  items: MenuItemSpec[];
  align?: "start" | "center" | "end";
  label?: string;
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="menu"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
        >
          {items.map((item) => (
            <DropdownMenuPrimitive.Item
              key={item.id}
              className={cx("menu-item", item.danger && "danger")}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              {item.icon && <span className="menu-item-icon">{item.icon}</span>}
              <span className="menu-item-label">{item.label}</span>
              {item.shortcut && (
                <kbd className="menu-shortcut">
                  {formatShortcut(item.shortcut)}
                </kbd>
              )}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
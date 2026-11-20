import type { ReactNode } from "react";
import Breadcrumb from "./Breadcrumb";

export interface TopBarProps {
  items?: { label: string; onClick?: () => void }[];
  current: string;
  actions?: ReactNode;
}

/** The 44px app header: optional course breadcrumb, contextual actions right. */
export default function TopBar({ items, current, actions }: TopBarProps) {
  return (
    <div className="topbar" data-tauri-drag-region>
      {current ? <Breadcrumb items={items} current={current} /> : <span aria-hidden="true" />}
      <div className="topbar-actions">{actions}</div>
    </div>
  );
}

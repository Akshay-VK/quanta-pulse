import type { ReactNode } from "react";
import Breadcrumb from "./Breadcrumb";

interface TopBarProps {
  items?: { label: string; onClick?: () => void }[];
  current: string;
  actions?: ReactNode;
}

/** The 48px app top bar: breadcrumb left, contextual actions right. */
export default function TopBar({ items, current, actions }: TopBarProps) {
  return (
    <div className="topbar" data-tauri-drag-region>
      <Breadcrumb items={items} current={current} />
      <div className="topbar-actions">{actions}</div>
    </div>
  );
}

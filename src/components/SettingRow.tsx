import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/** A settings row: label block left, a single control right-aligned. */
export default function SettingRow({
  title,
  description,
  controlClassName,
  children,
}: {
  title: string;
  description?: ReactNode;
  controlClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <div className="setting-title">{title}</div>
        {description && <div className="setting-desc">{description}</div>}
      </div>
      <div className={cx("setting-control", controlClassName)}>{children}</div>
    </div>
  );
}

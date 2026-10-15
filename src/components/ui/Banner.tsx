import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { IconButton } from "./IconButton";

/** An inline message strip. Errors announce as alerts; others as status. */
export function Banner({
  kind = "info",
  role,
  icon,
  action,
  onDismiss,
  className,
  children,
}: {
  kind?: "info" | "ok" | "error";
  role?: "status" | "alert";
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx("banner", `banner-${kind}`, className)}
      role={role ?? (kind === "error" ? "alert" : "status")}
    >
      {icon && <span className="banner-icon">{icon}</span>}
      <div className="banner-body">{children}</div>
      {action && (
        <button type="button" className="banner-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <IconButton
          label="Dismiss"
          size={28}
          tooltip={false}
          className="banner-dismiss"
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
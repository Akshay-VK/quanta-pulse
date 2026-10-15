import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Tooltip } from "./Tooltip";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also the default tooltip text. */
  label: string;
  size?: 28 | 32;
  /** Renders the pressed style and `aria-pressed`. */
  pressed?: boolean;
  /** Set to false to skip the tooltip (e.g. when nested in another trigger). */
  tooltip?: string | false;
  children: ReactNode;
}

/** A square, icon-only button. Always labelled and, by default, tooltipped. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, size = 32, pressed, tooltip, className, children, type = "button", ...rest },
    ref,
  ) {
    const button = (
      <button
        ref={ref}
        type={type}
        className={cx(
          "icon-button",
          size === 28 && "icon-button-sm",
          pressed && "is-pressed",
          className,
        )}
        aria-label={label}
        aria-pressed={pressed}
        {...rest}
      >
        {children}
      </button>
    );

    return tooltip === false ? (
      button
    ) : (
      <Tooltip content={tooltip ?? label}>{button}</Tooltip>
    );
  },
);
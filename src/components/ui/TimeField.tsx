import type { InputHTMLAttributes } from "react";
import { cx } from "../../lib/cx";

/** A time-of-day input, free-text "HH:MM" with a numeric keypad hint. */
export function TimeField({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx("time-field", className)}
      inputMode="numeric"
      placeholder="HH:MM"
      {...rest}
    />
  );
}
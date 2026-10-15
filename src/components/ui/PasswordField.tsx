import { useId, useState, type InputHTMLAttributes, type RefObject } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { cx } from "../../lib/cx";
import { IconButton } from "./IconButton";

interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string | null;
  inputRef?: RefObject<HTMLInputElement>;
  lg?: boolean;
}

/** A password input with a reveal toggle. Value is caller-controlled. */
export function PasswordField({
  label,
  error,
  id,
  lg,
  inputRef,
  className,
  ...rest
}: PasswordFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={cx("field", error && "field-invalid")}>
      {label && (
        <label className="field-label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div className="field-input-wrap">
        <input
          id={fieldId}
          ref={inputRef}
          type={revealed ? "text" : "password"}
          className={cx("text-field", lg && "text-field-lg", className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
        <IconButton
          label={revealed ? "Hide password" : "Show password"}
          size={28}
          tooltip={false}
          className="field-input-action"
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </IconButton>
      </div>
      {error && (
        <p className="field-message" id={errorId}>
          <AlertCircle className="icon-sm" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
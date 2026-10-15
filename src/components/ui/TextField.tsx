import { useId, type InputHTMLAttributes, type RefObject } from "react";
import { AlertCircle } from "lucide-react";
import { cx } from "../../lib/cx";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  inputRef?: RefObject<HTMLInputElement>;
  /** Taller variant for the login form. */
  lg?: boolean;
}

/** A labelled text input with an optional inline error. */
export function TextField({
  label,
  error,
  id,
  lg,
  inputRef,
  className,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;

  return (
    <div className={cx("field", error && "field-invalid")}>
      {label && (
        <label className="field-label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <input
        id={fieldId}
        ref={inputRef}
        className={cx("text-field", lg && "text-field-lg", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <p className="field-message" id={errorId}>
          <AlertCircle className="icon-sm" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

/** A controlled checkbox with checked, unchecked, and mixed states. */
export function Checkbox({
  checked,
  onCheckedChange,
  id,
  disabled,
  ariaLabel,
}: {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      id={id}
      disabled={disabled}
      aria-label={ariaLabel}
      className="checkbox"
    >
      <CheckboxPrimitive.Indicator className="checkbox-indicator">
        {checked === "indeterminate" ? (
          <Minus aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

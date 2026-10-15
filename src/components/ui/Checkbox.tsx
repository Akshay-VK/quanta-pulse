import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

/** A tri-state-free checkbox with a check indicator. */
export function Checkbox({
  checked,
  onCheckedChange,
  id,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
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
        <Check aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
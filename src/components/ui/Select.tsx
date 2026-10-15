import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { cx } from "../../lib/cx";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

/** A single-choice select. Option values must be non-empty strings. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select",
  label,
  ariaLabel,
  id,
  className,
}: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <div className={cx("field", className)}>
      {label && (
        <label className="field-label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
        <SelectPrimitive.Trigger
          id={fieldId}
          className="select-trigger"
          aria-label={ariaLabel ?? (label ? undefined : placeholder)}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon className="select-icon">
            <ChevronDown aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="select-content"
            position="popper"
            sideOffset={4}
            collisionPadding={8}
          >
            <SelectPrimitive.Viewport className="select-viewport">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="select-item"
                >
                  <SelectPrimitive.ItemIndicator className="select-item-indicator">
                    <Check aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
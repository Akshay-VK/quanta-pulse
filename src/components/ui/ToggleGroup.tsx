import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";

export interface ToggleOption {
  value: string;
  label: string;
}

/** A single-choice segmented control for compact settings. */
export function ToggleGroup({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ToggleOption[];
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      aria-label={ariaLabel}
      disabled={disabled}
      className={["toggle-group", className].filter(Boolean).join(" ")}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="toggle-item"
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
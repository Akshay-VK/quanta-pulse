import * as SwitchPrimitive from "@radix-ui/react-switch";

/** A two-state toggle switch. */
export function Switch({
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
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      id={id}
      disabled={disabled}
      aria-label={ariaLabel}
      className="switch"
    >
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
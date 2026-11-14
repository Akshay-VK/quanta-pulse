import type { CSSProperties } from "react";
import { Palette, X } from "lucide-react";
import { Close } from "@radix-ui/react-popover";
import { ACCENTS, PALETTES, resolveAppearance } from "../lib/appearance";
import type { AppearanceController } from "../hooks/useTheme";
import { Popover } from "./ui/Popover";
import { IconButton } from "./ui/IconButton";
import { ToggleGroup } from "./ui/ToggleGroup";
import { Button } from "./ui/Button";

/** Identical immediate controls in Settings and the topbar. No operational draft. */
export function AppearanceControls({ appearance }: { appearance: AppearanceController }) {
  const { preference, changeAppearance, resolved, resetAppearance, persistence } = appearance;
  return <div className="appearance-controls">
    <p className="appearance-description">Choose a workspace that feels comfortable. Changes apply immediately.</p>
    <div className="appearance-field"><h3>Mode</h3>
      <ToggleGroup ariaLabel="Appearance mode" value={preference.mode} onValueChange={value => appearance.setThemeMode(value as typeof preference.mode)}
        options={[{ value: "system", label: "Follow system" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
    </div>
    <fieldset className="appearance-field"><legend>Palette</legend><div className="appearance-palettes">
      {PALETTES.map(palette => {
        const { tokens } = resolveAppearance({ ...preference, palette: palette.value, mode: resolved }, false);
        const style = Object.fromEntries(Object.entries(tokens).map(([name, value]) => [`--${name}`, value])) as CSSProperties;
        return <button key={palette.value} type="button" className="appearance-palette" aria-label={palette.label}
          aria-pressed={preference.palette === palette.value} onClick={() => changeAppearance({ palette: palette.value })}>
          <span className="appearance-sample" style={style} aria-hidden="true">
            <span className="appearance-sample-side" /><span className="appearance-sample-content"><span className="appearance-sample-heading">Course materials</span><span className="appearance-sample-row">Lecture notes <span>PDF</span></span><span className="appearance-sample-link">View material</span></span>
          </span>
          <span className="appearance-palette-name">{palette.label}<span aria-hidden="true">{preference.palette === palette.value ? "✓" : ""}</span></span>
        </button>;
      })}
    </div><p className="appearance-caption">Examples of this workspace in {resolved} mode.</p></fieldset>
    <div className="appearance-field"><h3>Accent</h3><ToggleGroup ariaLabel="Appearance accent" className="appearance-accents" value={preference.accent}
      onValueChange={value => changeAppearance({ accent: value as typeof preference.accent })} options={[...ACCENTS]} /></div>
    <div className="appearance-field"><h3>Row density</h3><ToggleGroup ariaLabel="Row density" value={preference.density}
      onValueChange={value => changeAppearance({ density: value as typeof preference.density })}
      options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></div>
    <div className="appearance-reset"><Button variant="secondary" onClick={resetAppearance}>Reset appearance</Button><span>System · Soft Graphite · Comfortable</span></div>
    {persistence !== "saved" && <p className="appearance-feedback" role="status">{persistence === "future"
      ? "Appearance is saved by a newer version. Changes apply for this session; the original preference is preserved."
      : "Appearance cannot be remembered on this device. Changes still apply for this session."}</p>}
  </div>;
}

export function AppearancePopover({ appearance }: { appearance: AppearanceController }) {
  return <Popover label="Appearance" trigger={<IconButton label="Appearance" tooltip={false}><Palette aria-hidden="true" /></IconButton>}>
    <div className="appearance-popover"><div className="appearance-popover-header"><h2>Appearance</h2><Close asChild><IconButton label="Close appearance" tooltip={false}><X aria-hidden="true" /></IconButton></Close></div><AppearanceControls appearance={appearance} /></div>
  </Popover>;
}

import type { CSSProperties } from "react";
import { Palette, X } from "lucide-react";
import { Close } from "@radix-ui/react-popover";
import { ACCENTS, PALETTES, resolveAppearance } from "../lib/appearance";
import type { AppearanceController } from "../hooks/useTheme";
import { Popover } from "./ui/Popover";
import { IconButton } from "./ui/IconButton";
import { ToggleGroup } from "./ui/ToggleGroup";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";
import SettingRow from "./SettingRow";

/** Identical immediate controls in Settings and the topbar. No operational draft. */
export function AppearanceControls({ appearance }: { appearance: AppearanceController }) {
  const { preference, changeAppearance, resolved, resetAppearance, persistence } = appearance;
  const lightTokens = resolveAppearance({ ...preference, mode: "light" }, false).tokens;
  const darkTokens = resolveAppearance({ ...preference, mode: "dark" }, true).tokens;
  return <div className="appearance-controls">
    <p className="appearance-description">Choose a workspace that feels comfortable. Changes apply immediately.</p>
    <fieldset className="appearance-field"><legend>Theme</legend><div className="appearance-modes" role="radiogroup" aria-label="Appearance mode">
      {([{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }] as const).map(mode =>
        <button key={mode.value} type="button" role="radio" className="appearance-mode-tile"
          aria-checked={preference.mode === mode.value} tabIndex={preference.mode === mode.value ? 0 : -1}
          onClick={() => appearance.setThemeMode(mode.value)}
          onKeyDown={event => {
            if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            const modes = ["system", "light", "dark"] as const;
            const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
            const index = modes.findIndex(value => value === mode.value);
            const next = modes[(index + direction + modes.length) % modes.length];
            appearance.setThemeMode(next);
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`.appearance-mode-tile[data-mode-value="${next}"]`)?.focus();
          }} data-mode-value={mode.value}>
          <span className="appearance-mode-preview" data-mode={mode.value} aria-hidden="true" style={{
            "--appearance-mode-bg": mode.value === "dark" ? darkTokens.bg : lightTokens.bg,
            "--appearance-mode-side": mode.value === "dark" ? darkTokens.side : lightTokens.side,
            "--appearance-mode-line": mode.value === "dark" ? darkTokens["line-strong"] : lightTokens["line-strong"],
            "--appearance-mode-light": lightTokens.bg,
            "--appearance-mode-dark": darkTokens.bg,
          } as CSSProperties}><span /><i /><i /><i /></span>
          <span>{mode.value === "system" ? "Follow system" : mode.label}</span>
        </button>)}
    </div></fieldset>
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
    <fieldset className="appearance-field"><legend>Accent</legend><div className="appearance-accents" role="radiogroup" aria-label="Appearance accent">
      {ACCENTS.map(accent => {
        const { tokens } = resolveAppearance({ ...preference, accent: accent.value }, resolved === "dark");
        return <button key={accent.value} type="button" role="radio" aria-label={accent.label}
          aria-checked={preference.accent === accent.value} tabIndex={preference.accent === accent.value ? 0 : -1}
          className="appearance-accent-radio" onClick={() => changeAppearance({ accent: accent.value })}
          onKeyDown={event => {
            if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
            const index = ACCENTS.findIndex(option => option.value === accent.value);
            const next = ACCENTS[(index + direction + ACCENTS.length) % ACCENTS.length];
            changeAppearance({ accent: next.value });
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`.appearance-accent-radio[aria-label="${next.label}"]`)?.focus();
          }}
          style={{ "--appearance-accent-swatch": tokens.accent } as CSSProperties}>
          <span className="sr-only">{accent.label}</span>
        </button>;
      })}
    </div></fieldset>
    <div className="appearance-field"><h3>Row density</h3><ToggleGroup ariaLabel="Row density" value={preference.density}
      onValueChange={value => changeAppearance({ density: value as typeof preference.density })}
      options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></div>
    <SettingRow title="Monospace UI text" description="Use Geist Mono for all interface text.">
      <Switch checked={preference.monospace} onCheckedChange={monospace => changeAppearance({ monospace })} ariaLabel="Use Geist Mono for all UI text" />
    </SettingRow>
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

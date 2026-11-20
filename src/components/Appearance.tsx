import type { CSSProperties } from "react";
import { Check, Monitor, Moon, Palette, Sun, X } from "lucide-react";
import { Close } from "@radix-ui/react-popover";
import { ACCENTS, PALETTES, resolveAppearance, type AppearancePreference } from "../lib/appearance";
import type { AppearanceController } from "../hooks/useTheme";
import { Popover } from "./ui/Popover";
import { IconButton } from "./ui/IconButton";
import { Select } from "./ui/Select";
import { ToggleGroup } from "./ui/ToggleGroup";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";
import SettingRow from "./SettingRow";

const MODES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

function ModeTiles({ appearance }: { appearance: AppearanceController }) {
  const { preference, setThemeMode } = appearance;
  const light = resolveAppearance({ ...preference, mode: "light" }, false).tokens;
  const dark = resolveAppearance({ ...preference, mode: "dark" }, true).tokens;
  return (
    <div className="appearance-modes" role="radiogroup" aria-label="Appearance mode">
      {MODES.map((mode, index) => {
        const tones = mode.value === "light" ? light : dark;
        return (
          <button
            key={mode.value}
            type="button"
            role="radio"
            className="appearance-mode-tile"
            aria-checked={preference.mode === mode.value}
            tabIndex={preference.mode === mode.value ? 0 : -1}
            onClick={() => setThemeMode(mode.value)}
            onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
              const next = (index + direction + MODES.length) % MODES.length;
              setThemeMode(MODES[next].value);
              event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
            }}
          >
            <span className="appearance-mode-preview" data-mode={mode.value} aria-hidden="true" style={{
              "--appearance-mode-bg": tones.raised,
              "--appearance-mode-side": tones.side,
              "--appearance-mode-line": tones["control-line"],
              "--appearance-mode-accent": tones.accent,
              "--appearance-mode-light": light.raised,
            } as CSSProperties}><span /><i /><i /><i /><i /></span>
            <mode.icon className="appearance-mode-icon" aria-hidden="true" />
            <span className="appearance-mode-name">{mode.label}</span>
            {preference.mode === mode.value && <Check className="appearance-mode-icon" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function PaletteSelect({ appearance }: { appearance: AppearanceController }) {
  return (
    <Select
      ariaLabel="Palette"
      value={appearance.preference.palette}
      options={[...PALETTES]}
      onValueChange={(value) => appearance.changeAppearance({ palette: value as AppearancePreference["palette"] })}
    />
  );
}

function AccentPicker({ appearance }: { appearance: AppearanceController }) {
  const { preference, resolved, changeAppearance } = appearance;
  return (
    <div className="appearance-accents" role="radiogroup" aria-label="Appearance accent">
      {ACCENTS.map((accent, index) => {
        const { tokens } = resolveAppearance({ ...preference, accent: accent.value }, resolved === "dark");
        return (
          <button
            key={accent.value}
            type="button"
            role="radio"
            aria-label={accent.label}
            aria-checked={preference.accent === accent.value}
            tabIndex={preference.accent === accent.value ? 0 : -1}
            className="appearance-accent-radio"
            onClick={() => changeAppearance({ accent: accent.value })}
            onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
              const next = (index + direction + ACCENTS.length) % ACCENTS.length;
              changeAppearance({ accent: ACCENTS[next].value });
              event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
            }}
            style={{ "--appearance-accent-swatch": tokens.accent } as CSSProperties}
          />
        );
      })}
    </div>
  );
}

function DensityControl({ appearance }: { appearance: AppearanceController }) {
  return (
    <ToggleGroup
      ariaLabel="Row density"
      value={appearance.preference.density}
      onValueChange={(value) => appearance.changeAppearance({ density: value as AppearancePreference["density"] })}
      options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]}
    />
  );
}

function PersistenceNotice({ persistence }: Pick<AppearanceController, "persistence">) {
  if (persistence === "saved") return null;
  return (
    <p className="appearance-feedback" role="status">{persistence === "future"
      ? "Appearance is saved by a newer version. Changes apply for this session and the original preference is preserved."
      : "Appearance cannot be remembered on this device. Changes still apply for this session."}</p>
  );
}

/** Full appearance controls for the Settings page. Changes apply immediately. */
export function AppearanceControls({ appearance }: { appearance: AppearanceController }) {
  return (
    <div className="appearance-controls">
      <h3 className="appearance-mode-label">Theme</h3>
      <ModeTiles appearance={appearance} />
      <SettingRow title="Palette" description="Neutral surfaces, borders and text tones.">
        <PaletteSelect appearance={appearance} />
      </SettingRow>
      <SettingRow title="Accent" description="Focus rings, unread markers and primary actions.">
        <AccentPicker appearance={appearance} />
      </SettingRow>
      <SettingRow title="Density" description="Row height and spacing in lists.">
        <DensityControl appearance={appearance} />
      </SettingRow>
      <SettingRow title="Monospace UI text" description="Use Geist Mono for all interface text.">
        <Switch checked={appearance.preference.monospace}
          onCheckedChange={(monospace) => appearance.changeAppearance({ monospace })}
          ariaLabel="Use Geist Mono for all UI text" />
      </SettingRow>
      <SettingRow title="Reset appearance" description="Restore the default workspace appearance.">
        <Button variant="secondary" size="sm" onClick={appearance.resetAppearance}>Reset appearance</Button>
      </SettingRow>
      <PersistenceNotice persistence={appearance.persistence} />
    </div>
  );
}

export function AppearancePopover({ appearance }: { appearance: AppearanceController }) {
  return (
    <Popover label="Appearance" side="top" align="start" className="appearance-popover"
      trigger={<IconButton label="Appearance" tooltip={false}><Palette aria-hidden="true" /></IconButton>}>
      <div className="appearance-popover-header">
        <h2>Appearance</h2>
        <Close asChild><IconButton label="Close appearance" tooltip={false}><X aria-hidden="true" /></IconButton></Close>
      </div>
      <div className="appearance-popover-fields">
        <div>
          <p className="appearance-popover-label">Mode</p>
          <ToggleGroup ariaLabel="Appearance mode" value={appearance.preference.mode} options={[...MODES]}
            onValueChange={(value) => appearance.setThemeMode(value as AppearancePreference["mode"])} />
        </div>
        <div>
          <p className="appearance-popover-label">Palette</p>
          <PaletteSelect appearance={appearance} />
        </div>
        <div>
          <p className="appearance-popover-label">Accent</p>
          <AccentPicker appearance={appearance} />
        </div>
        <div>
          <p className="appearance-popover-label">Density</p>
          <DensityControl appearance={appearance} />
        </div>
      </div>
      <PersistenceNotice persistence={appearance.persistence} />
    </Popover>
  );
}

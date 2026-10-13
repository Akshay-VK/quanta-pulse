import type { ThemeMode } from "../lib/types";

interface Props {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

function SystemIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5.5 14h5M8 11.5V14" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7Z" />
    </svg>
  );
}

const OPTIONS: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: "system", label: "System", icon: <SystemIcon /> },
  { id: "light", label: "Light", icon: <SunIcon /> },
  { id: "dark", label: "Dark", icon: <MoonIcon /> },
];

export default function ThemeSwitcher({ mode, onChange }: Props) {
  return (
    <div className="theme-switch" role="group" aria-label="Color theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          data-mode={opt.id}
          aria-pressed={mode === opt.id}
          title={`${opt.label} theme`}
          onClick={() => onChange(opt.id)}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
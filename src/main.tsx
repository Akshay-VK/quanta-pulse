import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { appearanceStorage, applyAppearance, readAppearance, systemPrefersDark } from "./lib/appearance";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components/appearance.css";
import "./styles/layout.css";
import "./styles/components/ui.css";
import "./styles/components/shell.css";
import "./styles/components/content.css";
import "./styles/components/inspector.css";
import "./styles/components/overlays.css";
import "./styles/components/screens.css";
import "./styles/components/workspace-parity.css";
import "./styles/components/library-parity.css";
import "./styles/components/overlay-parity.css";

// The same resolution path as the React owner, before the first app frame.
applyAppearance(document.documentElement, readAppearance(appearanceStorage()).preference, systemPrefersDark());

// macOS-specific inset for the traffic lights in the sidebar header.
try {
  if (navigator.platform.toLowerCase().includes("mac")) {
    document.documentElement.dataset.platform = "macos";
  }
} catch {
  // Platform detection is cosmetic; the app works without it.
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

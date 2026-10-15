import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/newsreader";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components/ui.css";
import "./styles/components/shell.css";
import "./styles/components/content.css";
import "./styles/components/overlays.css";
import "./styles/components/screens.css";

// Set the first-paint theme before React mounts to avoid a flash on launch.
try {
  const savedTheme = localStorage.getItem("quanta-pulse-theme");
  const theme =
    savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = theme;
} catch {
  document.documentElement.dataset.theme = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches
    ? "dark"
    : "light";
}

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
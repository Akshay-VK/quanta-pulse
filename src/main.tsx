import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Set the first-paint theme before React mounts to avoid a flash on launch.
try {
  const savedTheme = localStorage.getItem("quanta-pulse-theme");
  const theme = savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
} catch {
  document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

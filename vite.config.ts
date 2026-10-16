import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * index.html carries the shipped CSP, and it stays strict there: `connect-src`
 * is the Tauri IPC bridge and nothing else. The dev server also needs its own
 * origin, because the HMR client opens a websocket back to Vite — without this
 * the webview logs "violates ... connect-src ipc: http://ipc.localhost" and
 * reloads stop working. This rewrites the meta tag while serving only, so the
 * built HTML keeps the strict policy.
 */
function devCsp(): Plugin {
  const origins =
    "ws://localhost:1420 http://localhost:1420 ws://127.0.0.1:1420 http://127.0.0.1:1420";
  return {
    name: "quanta-pulse:dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        "connect-src ipc: http://ipc.localhost",
        `connect-src ipc: http://ipc.localhost ${origins}`,
      );
    },
  };
}

// Tauri expects a fixed dev port and does not watch the Rust side.
export default defineConfig({
  plugins: [react(), devCsp()],
  clearScreen: false,
  // One React, always. A second copy reaches the app as "Invalid hook call" and
  // a null dispatcher, which is what surfaces as
  // "Cannot read properties of null (reading 'useMemo')" in a Radix component.
  resolve: { dedupe: ["react", "react-dom"] },
  // Pre-bundling React in the first pass stops the optimiser from re-running
  // mid-session; a re-run is what leaves two generations of deps on the page.
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client"] },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});

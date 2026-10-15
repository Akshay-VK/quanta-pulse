/// <reference types="vite/client" />

// Brings Vite's asset-module declarations into scope, including `*?raw`. The
// stylesheet tests read the CSS as text that way — jsdom does not lay out CSS,
// so the grid and min-width contract is asserted against the real source.

# 02A narrow review

Compared the 02A control patch with `985b1a9`, the 02A packet, and spec §3 controls. Scope excludes overlays; no overlay-only issue is reported. No source files changed. DOM tests do not establish rendered geometry, and the separate screenshot proof remains pending.

- **High — primary hover makes its label unreadable in both themes** ([ui.css](/mnt/d/dev/web/projects/quanta-app/quanta-pulse/src/styles/components/ui.css:54)). The inset shadow paints the opaque `--selected` token over the primary fill. In light mode that is `#e1eaff` under white text (`--on-accent: #fff`); in dark mode it is `#2b3851` under `#101d3b` text. Both pairs have very low contrast. Remove this shadow from `.btn-primary:hover` or use a theme-aware hover fill that preserves the foreground contrast.
- **Medium — status tag corner radius misses spec** ([ui.css](/mnt/d/dev/web/projects/quanta-app/quanta-pulse/src/styles/components/ui.css:181)). `.tag` uses `--radius-xs` (4px); §3 requires 5px. Use `--radius-chip`.
- **Medium — course chip outline and radius miss spec** ([ui.css](/mnt/d/dev/web/projects/quanta-app/quanta-pulse/src/styles/components/ui.css:223)). `.course-pill` is a filled 999px pill with no border; §3 calls for `--b1` border and 5px radius. Use the shared line and chip-radius tokens.

The checkbox mixed state is exposed as `aria-checked="mixed"`, with a visible minus and boolean activation callback; targeted test covers it. Geometry/focus and light/dark hover need rendered verification once screenshot evidence arrives. No 02B overlay responsibility surfaced in this narrow control review.

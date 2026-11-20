# B10 browser proof

Base: `772764bd7eb8a4c527471adaa529311e9cb50df6`. B10 scoped source SHA-256: `63aace1951b9a82374f6c09f1a86773aeda97947e81943378e1686f38aecc518` (ordered filename, NUL, bytes, NUL for the four leased source/test files; manifest in the gate run below).

## Actual App milestone — PASS

- External harness reused/adapted from `/tmp/quanta-redesign-progress/20261116T044822Z-B09B-proof/{capture.mjs,vite.build.config.ts}` into fresh directories. Actual repository App, components, CSS and fonts were bundled; only API and Tauri events were replaced by deterministic local fixtures. No production fixture edits, live credentials, native application run, or native lifecycle claim.
- Build/gate directory: `/tmp/quanta-redesign-progress/20261116T060030Z-B10-proof`. Final browser directory: `/tmp/quanta-redesign-progress/20261116T060425Z-B10-browser-proof` (same built App copied into the fresh capture directory). HTTP/CDP ports: `14864` / `19864`.
- `preview_status` reported unavailable; subsequent `preview_open` failed: “This host is missing libraries T3's browser needs (libnspr4.so, libnss3.so, libnssutil3.so).” Used the authorized README fallback with existing extracted NSS libraries and sandboxed Chromium; no `--no-sandbox` flag.
- 1280×800, light, comfortable: persisted `2` displayed in the retention trigger and selected in the real Radix dropdown, alongside presets None/1/3/5. An unrelated preference edit saved `2` unchanged and reload retained it.
- 820×540, dark, comfortable: persisted `10` displayed and selected alongside presets None/1/3/5. Choosing 5 stayed in the draft, and confirmed Discard restored 10. The full retention row and explanation fit within the viewport.
- Actual Geist and Geist Mono fonts loaded; captured page errors: zero. The JSON proof records selected options, final value, row bounds and font checks. Both PNG dimensions were validated and visually inspected.
- Initial capture stopped on a harness locator mismatch (`dialog` versus the existing `alertdialog`); corrected only the external harness, then completed the fresh capture. The incomplete PNG was removed. Exactly two final PNG artifacts remain.
- Both capture runs reached terminal status. Their preview servers and Chromium processes were stopped; ports are no longer served.

Artifacts:

- `/tmp/quanta-redesign-progress/20261116T060425Z-B10-browser-proof/settings-retention-wide-light.png`
- `/tmp/quanta-redesign-progress/20261116T060425Z-B10-browser-proof/settings-retention-narrow-dark.png`
- `/tmp/quanta-redesign-progress/20261116T060425Z-B10-browser-proof/settings-proof.json`
- `/tmp/quanta-redesign-progress/20261116T060030Z-B10-proof/b10-source-manifest.json`

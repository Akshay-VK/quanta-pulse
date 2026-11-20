# 04C8 Courses hub browser proof — 2026-11-16

Actual React App at HEAD `5927fe55cd42e1bc3b2fa369c4c5de4a7278e75c` plus frozen pending patches. API and Tauri-event aliases only; no production fixtures, CSS overrides, color seeds or source/test edits. External harness: `/tmp/quanta-redesign-progress/20261116T081840Z-04C8-acceptance-final`. The profile's initial localStorage is recorded as `{}`; the actual allocator subsequently persists all 65 course colors, first twelve 0–11 and then deterministic reuse.

PASS:

- J/ArrowDown reaches all 65 primary buttons in incoming order; K/ArrowUp reaches all 65 in reverse. Boundaries clamp. Last row is in viewport (y 677–713 at 1280×800), main scrollTop 2832. No navigation during traversal.
- E/U/Delete/X/Shift+A produce zero primary clicks, API calls or course navigation. Native Tab reaches Course 2's sibling menu; Shift+Tab returns to that same primary button.
- Chromium Enter and Space each produce exactly one trusted primary-button click, zero remaining hub rows, the Course 1 heading, and the existing `eventsRange(undefined, undefined, 1, 2000)` CoursePage request. No manual click or JS keyboard event substitutes for activation.
- `courses-focus-wide.png` (1280×800): Course 2 matches `:focus-visible`; computed inset shadows are `rgb(154, 162, 240) 2px 0px 0px 0px inset, rgb(154, 162, 240) 0px 0px 0px 2px inset`. Outline solid 2px, offset 2px, token `#9aa2f0`. No horizontal document overflow.
- `courses-filter-menu-narrow.png` (820×540): actual Search library input `CODE6` retains seven matching courses (6, 60–65) in incoming order without stealing search focus. J then native Tab/ArrowDown reaches Course 60's menu, focused Pause monitoring; all four menu items are within viewport. Escape closes the menu. No horizontal document overflow.
- Dark / t3-neutral / comfortable; Geist Variable and document fonts loaded. Zero runtime exceptions/browser error entries. Both final PNGs visually inspected.

`keyboard-observations.json` contains full forward/backward labels, initial/persisted storage, native key/click trust, API calls and computed geometry. `capture-metadata.json` records source-manifest, bundle, harness and PNG hashes/dimensions. PNG SHA-256: wide `162e40b9e2444f9377b1341cd5335c557ba8c0a9e50f43b08256c9a5e6bc1f9a`; narrow `a3e5f8966ff7b09806dca1064862b931c729cad5dff1e70389155b3dd24c4f38`.

Tooling: preview_status unavailable; preview_open failed with missing libnspr4.so/libnss3.so/libnssutil3.so. Used explicitly authorized README/04C4 extracted-library fallback, sandbox-enabled Chromium. Final HTTP/CDP 14966/19966 and all earlier attempt ports closed; own processes stopped. External build and final capture exit 0. Earlier attempts stopped on incorrect harness selectors and incomplete CDP Enter text; corrected only external harness. Partial trial PNG removed; exactly two retained PNGs. Final CDP Enter includes carriage-return text; Space includes its native character.

Fixture browser evidence only: no native desktop/live Quanta claim, no task04/04C umbrella acceptance. History's historical 080500Z PNGs are unchanged; they predate root's read-primary/unmount corrections, now covered by fresh terminal tests. No new History PNG asserted.

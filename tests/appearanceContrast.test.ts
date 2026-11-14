import { describe, expect, it } from "vitest";
import { ACCENTS, DEFAULT_APPEARANCE, PALETTES, resolveAppearance } from "../src/lib/appearance";
function luminance(hex: string) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels.reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
const combinations = PALETTES.flatMap(p => ["light", "dark"].flatMap(mode => ACCENTS.map(a => ({ palette: p.value, mode: mode as "light" | "dark", accent: a.value }))));
describe("All 72 authored appearance combinations", () => {
  it.each(combinations)("$palette / $mode / $accent: text, surfaces and meaningful indicators", preference => {
    const t = resolveAppearance({ ...DEFAULT_APPEARANCE, ...preference }, false).tokens;
    for (const surface of ["bg", "side", "raised", "floating", "hover", "selected"] as const) {
      for (const text of ["ink", "muted", "faint", "link"] as const) {
        expect(contrast(t[text], t[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.focus, t[surface]), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
      expect(contrast(t["line-strong"], t[surface]), `control on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(t["on-accent"], t.accent), "text on accent").toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["disabled-fg"], t["disabled-bg"]), "disabled text").toBeGreaterThanOrEqual(4.5);
  });
});

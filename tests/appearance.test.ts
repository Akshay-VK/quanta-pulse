import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, APPEARANCE_KEY, readAppearance, resolveAppearance, saveAppearance } from "../src/lib/appearance";

function storage(value: string | null = null, legacy: string | null = null) {
  return { getItem: vi.fn((key: string) => key === APPEARANCE_KEY ? value : legacy), setItem: vi.fn() };
}
describe("Appearance preferences", () => {
  it.each(["light", "dark", "system"])("migrates legacy %s into the independent defaults", (mode) => {
    const s = storage(null, mode);
    const result = readAppearance(s);
    expect(result.preference).toEqual({ ...DEFAULT_APPEARANCE, mode });
    expect(saveAppearance(s, result.preference)).toBe("saved");
    expect(s.setItem).toHaveBeenCalledWith(APPEARANCE_KEY, JSON.stringify(result.preference));
  });
  it("validates fields independently and accepts only schema version 1", () => {
    expect(readAppearance(storage(JSON.stringify({ version: 1, mode: "light", palette: "missing", accent: "teal", density: 3 }))).preference)
      .toEqual({ ...DEFAULT_APPEARANCE, mode: "light", accent: "teal" });
    for (const value of ['null', '[]', '"dark"', '{}', '{', '{"version":"1"}']) {
      expect(readAppearance(storage(value)).preference).toEqual(DEFAULT_APPEARANCE);
    }
  });
  it("defaults missing monospace fields off and persists explicit choices", () => {
    const old = readAppearance(storage('{"version":1,"mode":"dark","palette":"ocean","accent":"teal","density":"compact"}'));
    expect(old.preference).toEqual({ ...DEFAULT_APPEARANCE, mode: "dark", palette: "ocean", accent: "teal", density: "compact" });
    const selected = { ...old.preference, monospace: true };
    const s = storage();
    expect(saveAppearance(s, selected)).toBe("saved");
    expect(s.setItem).toHaveBeenCalledWith(APPEARANCE_KEY, JSON.stringify(selected));
    expect(readAppearance(storage(JSON.stringify(selected))).preference).toEqual(selected);
  });
  it("uses legacy fallback for malformed records and preserves future records", () => {
    expect(readAppearance(storage("{", "dark")).preference.mode).toBe("dark");
    const future = storage('{"version":2,"mode":"dark"}', "dark");
    expect(readAppearance(future)).toMatchObject({ preference: DEFAULT_APPEARANCE, future: true });
    expect(saveAppearance(future, { ...DEFAULT_APPEARANCE, mode: "light" })).toBe("future");
    expect(future.setItem).not.toHaveBeenCalled();
  });
  it("tolerates unavailable reads and writes", () => {
    const s = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
    expect(readAppearance(s).preference).toEqual(DEFAULT_APPEARANCE);
    expect(saveAppearance(s, DEFAULT_APPEARANCE)).toBe("unavailable");
  });
  it("resolves System and explicit modes using one first-paint model", () => {
    expect(resolveAppearance(DEFAULT_APPEARANCE, true).mode).toBe("dark");
    expect(resolveAppearance({ ...DEFAULT_APPEARANCE, mode: "light" }, true).mode).toBe("light");
    expect(resolveAppearance(DEFAULT_APPEARANCE, false).tokens.bg).toBe("#f7f8fa");
  });
  it("uses neutral selection, reference T3 anchors, and 36/30px material rows", () => {
    const reference = { ...DEFAULT_APPEARANCE, palette: "t3-neutral" as const, mode: "dark" as const };
    expect(resolveAppearance(reference, false).tokens.bg).toBe("#09090a");
    expect(resolveAppearance(reference, false).tokens.raised).toBe("#0f0f11");
    expect(resolveAppearance(reference, false).tokens.selected).toBe("#1b1b20");
    expect(resolveAppearance(reference, false).tokens.selected).not.toBe(resolveAppearance(reference, false).tokens["accent-tint"]);
    expect(resolveAppearance({ ...DEFAULT_APPEARANCE, density: "comfortable" }, false).tokens["row-h"]).toBe("36px");
    expect(resolveAppearance({ ...DEFAULT_APPEARANCE, density: "compact" }, false).tokens["row-h"]).toBe("30px");
  });
  it("keeps default typography unchanged and resolves every UI role to Geist Mono when enabled", () => {
    const roleTokens = ["type-display", "type-title", "type-dialog", "type-lead", "type-ui", "type-ui-strong", "type-small", "type-caption"] as const;
    const standard = resolveAppearance(DEFAULT_APPEARANCE, false).tokens;
    const mono = resolveAppearance({ ...DEFAULT_APPEARANCE, monospace: true }, false).tokens;
    for (const role of roleTokens) {
      expect(standard[role]).toBe('"Geist Variable", system-ui, sans-serif');
      expect(mono[role]).toBe('"Geist Mono Variable", ui-monospace, monospace');
    }
  });
});

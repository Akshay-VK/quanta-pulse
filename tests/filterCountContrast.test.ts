// Token/compositing proof only; browser rendering is checked separately.
import { describe, expect, it } from "vitest";
import tokens from "../src/styles/tokens.css?raw";
import ui from "../src/styles/components/ui.css?raw";

function luminance(rgb: number[]) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function color(block: string, name: string) {
  const hex = block.match(new RegExp(`--${name}:\\s*#([a-f\\d]{6})`, "i"))?.[1];
  if (!hex) throw new Error(`Missing ${name} token`);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

describe("Meaningful inactive filter counts", () => {
  it.each(["light", "dark"])("meets 4.5:1 text contrast in %s after compositing opacity", (theme) => {
    const block = tokens.split(`:root[data-theme="${theme}"] {`)[1]?.split("}")[0];
    if (!block) throw new Error(`Missing ${theme} tokens`);
    const foreground = color(block, "muted");
    const background = color(block, "bg");
    const countRule = ui.match(/\.filter-tab-count\s*\{([^}]+)\}/)?.[1] ?? "";
    const opacity = Number(countRule.match(/opacity:\s*([\d.]+)/)?.[1] ?? 1);
    const composite = foreground.map((value, index) => value * opacity + background[index] * (1 - opacity));
    const contrast = (luminance(background) + 0.05) / (luminance(composite) + 0.05);
    expect(Math.max(contrast, 1 / contrast)).toBeGreaterThanOrEqual(4.5);
  });
});

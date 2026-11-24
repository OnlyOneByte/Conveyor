import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "styles/tokens.css"), "utf8");

function themeBlock(selector: string): string {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf("}", start));
}

function token(block: string, name: string): [number, number, number] {
  const m = block.match(new RegExp(`${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`${name} is not a plain oklch() value`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([L, C, h]: [number, number, number]): number {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

describe("--field-line", () => {
  for (const selector of ['[data-theme="light"]', '[data-theme="dark"]']) {
    test(`reaches 3:1 against every surface in ${selector}`, () => {
      const block = themeBlock(selector);
      const edge = luminance(token(block, "--field-line"));
      for (const surface of ["--bg", "--paper", "--sunk"]) {
        expect(contrast(edge, luminance(token(block, surface)))).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

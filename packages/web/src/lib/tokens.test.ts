import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "styles/tokens.css"), "utf8");

function themeBlock(selector: string): string {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf("}", start));
}

function token(block: string, name: string): [number, number, number] {
  const m = block.match(new RegExp(`${name}: (\\w+)\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!m || m[1] !== "oklch") throw new Error(`${name} is not a plain OKLCH value`);
  return [Number(m[2]), Number(m[3]), Number(m[4])];
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

describe("--faint", () => {
  for (const selector of ['[data-theme="light"]', '[data-theme="dark"]']) {
    test(`reaches 4.5:1 as placeholder text on every field surface in ${selector}`, () => {
      const block = themeBlock(selector);
      const text = luminance(token(block, "--faint"));
      for (const surface of ["--bg", "--paper", "--sunk"]) {
        expect(contrast(text, luminance(token(block, surface)))).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

test("every placeholder uses --faint", () => {
  const app = readFileSync(join(import.meta.dir, "styles/app.css"), "utf8");
  expect(app).toContain("::placeholder { color: var(--faint); opacity: 1; }");
});

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

const THEMES = ['[data-theme="light"]', '[data-theme="dark"]'];
const ratio = (block: string, a: string, b: string) => contrast(luminance(token(block, a)), luminance(token(block, b)));

describe("control boundaries and state indicators", () => {
  for (const selector of THEMES) {
    test(`--field-line, --live and --focus reach 3:1 on --bg, --paper and --sunk in ${selector}`, () => {
      const block = themeBlock(selector);
      for (const edge of ["--field-line", "--live", "--focus"])
        for (const surface of ["--bg", "--paper", "--sunk"]) expect(ratio(block, edge, surface)).toBeGreaterThanOrEqual(3);
    });

    test(`the ring on an inverted surface reaches 3:1 in ${selector}`, () => {
      const block = themeBlock(selector);
      expect(ratio(block, "--bg", "--ink")).toBeGreaterThanOrEqual(3);
      expect(ratio(block, "--belt-ink", "--belt")).toBeGreaterThanOrEqual(3);
    });
  }

  test("fields, checkboxes, ranges and toasts use those tokens", () => {
    const app = readFileSync(join(import.meta.dir, "styles/app.css"), "utf8");
    const toast = readFileSync(join(import.meta.dir, "ui/Toasts.svelte"), "utf8");
    expect(app).toMatch(/input, select, textarea \{[^}]*border: 1\.5px solid var\(--field-line\);/);
    expect(app).toContain('input[type="range"] { padding: 0; min-height: 0; accent-color: var(--live); }');
    expect(app).toMatch(/input\[type="checkbox"\] \{[^}]*accent-color: var\(--live\); \}/);
    expect(toast).toMatch(/\.toast \{[^}]*background: var\(--ink\);[^}]*--focus: var\(--bg\);/);
  });
});

describe("hover cues", () => {
  for (const selector of THEMES) {
    test(`the primary hover ring and the Needs-you hover fill reach 3:1 in ${selector}`, () => {
      const block = themeBlock(selector);
      for (const surface of ["--bg", "--paper", "--sunk"]) expect(ratio(block, "--ink", surface)).toBeGreaterThanOrEqual(3);
      expect(ratio(block, "--err", "--paper")).toBeGreaterThanOrEqual(3);
    });
  }

  test("Needs-you fills with --err on hover", () => {
    const needs = readFileSync(join(import.meta.dir, "components/NeedsYou.svelte"), "utf8");
    expect(needs).toContain(".needs:hover { border-color: var(--err); background: var(--err); color: var(--paper); }");
  });
});

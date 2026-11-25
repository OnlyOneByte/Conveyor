import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..");

const svelteFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });

const styleOf = (path: string) => /<style>([\s\S]*?)<\/style>/.exec(readFileSync(path, "utf8"))?.[1] ?? "";

const RAW = [
  { what: "font size", pattern: /font-size:\s*\d+(\.\d+)?(px|rem|em)\b/g },
  { what: "font size", pattern: /\bfont:\s*(\d{3}\s+)?\d+(\.\d+)?px\b/g },
  { what: "radius", pattern: /border-radius:\s*\d+(\.\d+)?px\b/g },
  { what: "duration", pattern: /\b(transition|animation)[^;]*?\b\d*\.?\d+m?s\b/g },
];

export function rawValues(css: string): string[] {
  return RAW.flatMap(({ what, pattern }) => [...css.matchAll(pattern)].map((m) => `${what}: ${m[0]}`));
}

describe("raw sizes, radii and durations", () => {
  test("no component or page style uses one outside the tokens", () => {
    const found = svelteFiles(SRC).flatMap((path) =>
      rawValues(styleOf(path)).map((hit) => `${relative(SRC, path)}: ${hit}`),
    );
    expect(found).toEqual([]);
  });

  test("the scan catches each kind, and tokens pass", () => {
    expect(
      rawValues(
        "a { font-size: 13.5px; } b { font: 500 12px var(--mono); } c { border-radius: 8px; } d { transition: width 0.3s; } e { animation: x 1.6s linear; }",
      ),
    ).toEqual([
      "font size: font-size: 13.5px",
      "font size: font: 500 12px",
      "radius: border-radius: 8px",
      "duration: transition: width 0.3s",
      "duration: animation: x 1.6s",
    ]);
    expect(
      rawValues(
        "a { font-size: var(--fs-chip); border-radius: var(--r-pill); transition: transform var(--t-move) var(--ease-move); } b { border-radius: 50%; border-radius: 0; }",
      ),
    ).toEqual([]);
  });

  test("the visually hidden helper is defined once, in app.css", () => {
    const copies = svelteFiles(SRC).filter((path) => /(^|[\s}])\.sr\s*[{,]/.test(styleOf(path)));
    expect(copies.map((path) => relative(SRC, path))).toEqual([]);
    expect(readFileSync(join(SRC, "lib/styles/app.css"), "utf8")).toContain(".sr { position: absolute;");
  });
});

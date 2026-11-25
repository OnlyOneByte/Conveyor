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

export function stylesOf(source: string): string[] {
  const blocks = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "");
  const markup = source
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const inline = [...markup.matchAll(/\bstyle="([^"]*)"/g)].map((m) => m[1] ?? "");
  const directives = [...markup.matchAll(/\bstyle:([\w-]+)=("[^"]*"|\{[^}]*\})/g)].map(
    (m) => `${m[1]}: ${(m[2] ?? "").replace(/^\{?"?|"?\}?$/g, "")}`,
  );
  return [...blocks, ...inline, ...directives];
}

const LENGTH = String.raw`\d*\.?\d+(?:(?:px|rem|em|pt|vw|vh|vmin|vmax|ch|ex)\b|%)`;

const RAW = [
  { what: "font size", pattern: new RegExp(String.raw`font-size:\s*[^;"}]*?${LENGTH}`, "g") },
  { what: "font size", pattern: new RegExp(String.raw`\bfont:\s*[^;"}]*?${LENGTH}`, "g") },
  { what: "radius", pattern: /\b[\w-]*radius:\s*[^;"}]*?\d*\.?\d+(px|rem|em|pt|vw|vh|ch|ex)\b/g },
  {
    what: "duration",
    pattern: /\b(transition|animation)[\w-]*:\s*[^;"}]*?(?<![\w.])\d*\.?\d+m?s\b/g,
  },
];

export function rawValues(css: string): string[] {
  return RAW.flatMap(({ what, pattern }) =>
    [...css.matchAll(pattern)].map((m) => `${what}: ${m[0]}`),
  );
}

describe("raw sizes, radii and durations", () => {
  test("no component, page or app.css style uses one outside the tokens", () => {
    const found = [
      ...svelteFiles(SRC).flatMap((path) =>
        stylesOf(readFileSync(path, "utf8")).flatMap((css) =>
          rawValues(css).map((hit) => `${relative(SRC, path)}: ${hit}`),
        ),
      ),
      ...rawValues(readFileSync(join(SRC, "lib/styles/app.css"), "utf8")).map(
        (hit) => `app.css: ${hit}`,
      ),
    ];
    expect(found).toEqual([]);
  });

  test("the scan catches each kind and each way of writing it, and tokens pass", () => {
    const caught = [
      "a { font-size: 13.5px; }",
      "a { font-size: calc(13px + 1px); }",
      "a { font-size: 85%; }",
      "a { font: 500 12px var(--mono); }",
      "a { font: italic 600 12px var(--mono); }",
      "a { font: 500 var(--fs-chip) / 18px var(--mono); }",
      "a { border-radius: 8px; }",
      "a { border-radius: 0 8px; }",
      "a { border-radius: .5rem; }",
      "a { border-top-left-radius: 8px; }",
      "a { transition: width 0.3s; }",
      "a { animation: x 1.6s linear; }",
      "a { transition-duration: 150ms; }",
      "a { animation-delay: .2s; }",
    ];
    expect(caught.filter((css) => rawValues(css).length !== 1)).toEqual([]);
    expect(
      rawValues(
        "a { font-size: var(--fs-chip); font: 700 var(--fs-label) / 1 var(--display); border-radius: var(--r-pill); transition: transform var(--t-move) var(--ease-move); } b { border-radius: 50%; border-radius: 0; animation-iteration-count: 1; }",
      ),
    ).toEqual([]);
  });

  test("every style block, inline style and style: directive is scanned", () => {
    const source = [
      '<script lang="ts">const css = "font-size: 12px";</script>',
      '<p style="font-size: 12px">a</p>',
      '<i style:border-radius="4px"></i>',
      '<b style:font-size={"14px"}></b>',
      '<style lang="postcss">a { border-radius: 3px; }</style>',
      "<style>b { transition: opacity 2s; }</style>",
    ].join("\n");
    expect(stylesOf(source).flatMap(rawValues)).toEqual([
      "radius: border-radius: 3px",
      "duration: transition: opacity 2s",
      "font size: font-size: 12px",
      "radius: border-radius: 4px",
      "font size: font-size: 14px",
    ]);
  });

  test("the visually hidden helper is defined once, in app.css", () => {
    const copies = svelteFiles(SRC).filter((path) =>
      stylesOf(readFileSync(path, "utf8")).some((css) => /(^|[\s}])\.sr\s*[{,]/.test(css)),
    );
    expect(copies.map((path) => relative(SRC, path))).toEqual([]);
    expect(readFileSync(join(SRC, "lib/styles/app.css"), "utf8")).toContain(
      ".sr { position: absolute;",
    );
  });
});

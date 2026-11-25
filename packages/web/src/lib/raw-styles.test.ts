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
  const inline = [...markup.matchAll(/\bstyle=(?:"([^"]*)"|'([^']*)')/gi)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
  const directives = [...markup.matchAll(/\bstyle:([\w-]+)=("[^"]*"|'[^']*'|\{[^}]*\})/gi)].map(
    (m) => `${m[1]}: ${(m[2] ?? "").replace(/^\{?["'`]?|["'`]?\}?$/g, "")}`,
  );
  return [...blocks, ...inline, ...directives];
}

export function rawTransitionParams(source: string): string[] {
  const markup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  return [
    ...markup.matchAll(/\b(?:transition|in|out|animate):[\w.]+(?:\|[\w|]+)?=\{\{([^}]*)\}\}/g),
  ]
    .flatMap((m) => [...(m[1] ?? "").matchAll(/\b(?:duration|delay)\s*:\s*\d[\d_.]*/g)])
    .map((m) => `transition param: ${m[0]}`);
}

const VALUE = String.raw`:\s*[^;"'}]*?(?<![\w.])`;
const UNITS = "px|rem|em|pt|vw|vh|vmin|vmax|ch|ex";
const LENGTH = String.raw`\d*\.?\d+(?:(?:${UNITS})\b|%)`;
const ABSOLUTE = "px|rem|em|pt";
const NONZERO = String.raw`(?!0*\.?0+(?:${ABSOLUTE})\b)\d*\.?\d+(?:${ABSOLUTE})\b`;

const RAW = [
  { what: "font size", pattern: new RegExp(`font-size${VALUE}${LENGTH}`, "gi") },
  { what: "font size", pattern: new RegExp(String.raw`\bfont${VALUE}${LENGTH}`, "gi") },
  {
    what: "radius",
    pattern: new RegExp(String.raw`\b[\w-]*radius${VALUE}\d*\.?\d+(?:${UNITS})\b`, "gi"),
  },
  {
    what: "duration",
    pattern: new RegExp(
      String.raw`(?:\b(?:transition|animation)[\w-]*|--[\w-]+)${VALUE}\d*\.?\d+m?s\b`,
      "gi",
    ),
  },
  {
    what: "spacing",
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:(?:row-|column-)?gap|padding[\w-]*|margin[\w-]*)${VALUE}${NONZERO}`,
      "gi",
    ),
  },
];

export function rawValues(css: string): string[] {
  return RAW.flatMap(({ what, pattern }) =>
    [...css.matchAll(pattern)].map((m) => `${what}: ${m[0]}`),
  );
}

describe("raw sizes, radii, durations and spacing", () => {
  test("no component, page or app.css style uses one outside the tokens", () => {
    const found = [
      ...svelteFiles(SRC).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...stylesOf(source).flatMap(rawValues), ...rawTransitionParams(source)].map(
          (hit) => `${relative(SRC, path)}: ${hit}`,
        );
      }),
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
      "a { --lift-time: 250ms; }",
      "a { FONT-SIZE: 12PX; }",
      "a { Border-Radius: 8px; }",
      "a { TRANSITION: opacity 2S; }",
      "a { gap: 6px; }",
      "a { row-gap: 2px; }",
      "a { padding: 0 var(--s2) 0 5px; }",
      "a { padding-inline-start: 10px; }",
      "a { margin: var(--s2) -5px 0; }",
      "a { margin-top: .5rem; }",
      "a { padding-bottom: calc(var(--dock-h, 120px) + var(--s4)); }",
      "a { PADDING: 3px; }",
    ];
    expect(caught.filter((css) => rawValues(css).length !== 1)).toEqual([]);
    expect(
      rawValues(
        "a { font-size: var(--fs-chip); font: 700 var(--fs-label) / 1 var(--display); border-radius: var(--r-pill); transition: transform var(--t-move) var(--ease-move); --lift: var(--t-fast); } b { border-radius: 50%; border-radius: 0; animation-iteration-count: 1; } c { gap: var(--s2) var(--s4); padding: 0 var(--s3); margin: 0 auto; margin-left: calc(-1 * var(--s2)); padding: 0px; padding-top: 50%; padding: 12vh var(--s4); gap: 0.6ch; --gap-x: 10px; scroll-padding: 0; }",
      ),
    ).toEqual([]);
  });

  test("a Svelte transition's literal duration or delay is raw, a named one is not", () => {
    const source = [
      "<script>const t = { duration: 200 };</script>",
      "<p transition:fade={{ duration: 200 }}>a</p>",
      "<p in:fly|local={{ y: 8, delay: 50 }}>b</p>",
      "<p out:fade={{ duration: MOVE_MS }}>c</p>",
      "<p animate:flip={{ duration: 1_000 }}>d</p>",
    ].join("\n");
    expect(rawTransitionParams(source)).toEqual([
      "transition param: duration: 200",
      "transition param: delay: 50",
      "transition param: duration: 1_000",
    ]);
  });

  test("every style block, inline style and style: directive is scanned", () => {
    const source = [
      '<script lang="ts">const css = "font-size: 12px";</script>',
      '<p style="font-size: 12px">a</p>',
      "<p style='padding: 6px'>a</p>",
      '<i style:border-radius="4px"></i>',
      "<i style:gap='10px'></i>",
      '<b style:font-size={"14px"}></b>',
      '<style lang="postcss">a { border-radius: 3px; }</style>',
      "<style>b { transition: opacity 2s; }</style>",
    ].join("\n");
    expect(stylesOf(source).flatMap(rawValues)).toEqual([
      "radius: border-radius: 3px",
      "duration: transition: opacity 2s",
      "font size: font-size: 12px",
      "spacing: padding: 6px",
      "radius: border-radius: 4px",
      "spacing: gap: 10px",
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

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFERRED_3D, isChecked, rawColours, scan } from "./colours";

const hits = (lines: string[], path = "packages/web/src/x.svelte") =>
  rawColours(path, lines.join("\n")).map((line) => line.slice(path.length + 1));

describe("the raw colour check", () => {
  test("finds each kind of literal with its line", () => {
    expect(
      hits([
        ".a { color: #fff; } .b { background: rgba(0, 0, 0, 0.5); }",
        ".c { color: oklch(0.5 0.1 20); border-color: hsl(10 20% 30%); }",
        "x = '#0e1116'; y = 0x2dd4bf;",
        ".d { color: color(display-p3 1 0 0); background: white; }",
        "const style = { color: 'rebeccapurple' }; .e { border: 1px solid red; }",
      ]),
    ).toEqual([
      "1: #fff",
      "1: rgba(",
      "2: oklch(",
      "2: hsl(",
      "3: #0e1116",
      "3: 0x2dd4bf",
      "4: color(",
      "4: white",
      "5: rebeccapurple",
      "5: red",
    ]);
  });

  test("leaves tokens, keywords, words, Svelte blocks, import aliases and ids alone", () => {
    expect(
      hits([
        "color: var(--ink); background: color-mix(in oklch, var(--accent) 8%, transparent);",
        "color-scheme: dark; border: none; fill: currentColor; color: inherit;",
        "<p>Red bins are white on the belt</p> new THREE.Color(1, 0, 0); tokenColor(name);",
        '{#each a as b}{/each}{#await p}{/await} import x from "#lib/api.js"; <a href="#main">',
      ]),
    ).toEqual([]);
  });

  test("finds named colours under any property, custom property, attribute or assignment", () => {
    expect(
      hits([
        ".a { --tone: red; --glow: 0 0 2px gold; }",
        '<div style:color="white"><rect fill="black" stroke={"navy"} /></div>',
        'el.style.background = "teal"; const theme = { accent: "orange" };',
        ".b { background: linear-gradient(to right, red 10%, blue); box-shadow: 0 0 4px black; }",
      ]),
    ).toEqual([
      "1: red",
      "1: gold",
      "2: white",
      "2: black",
      "2: navy",
      "3: teal",
      "3: orange",
      "4: red",
      "4: blue",
      "4: black",
    ]);
  });

  test("leaves colour words in prose and method names alone", () => {
    expect(
      hits([
        'const t = Math.tan(half); const label = "Red bins are white on the belt";',
        '<img alt="A tan bin" /> title="green means done"',
        "const c = palette.red; const d = theme.white;",
      ]),
    ).toEqual([]);
  });

  test("does not read #face or #add links as hex colours", () => {
    expect(
      hits(['<a href="#face">', "<a href='#add'>", '<a href="/jobs#bead">', "goto(`/x#decade`)"]),
    ).toEqual([]);
    expect(hits(['x = "#face"; .a { color: #add; }'])).toEqual(["1: #face", "1: #add"]);
  });

  test("allows 0x colours only in the deferred 3D files, which are exactly these three", () => {
    expect([...DEFERRED_3D].sort()).toEqual([
      "packages/web/src/lib/components/MeshScene.svelte",
      "packages/web/src/lib/components/PreviewScene.svelte",
      "packages/web/src/lib/previews/gridfinity.ts",
    ]);
    for (const file of DEFERRED_3D) {
      expect(existsSync(join(import.meta.dir, "..", "..", file))).toBe(true);
      expect(hits(["color: 0x2dd4bf, background: #fff"], file)).toEqual(["1: #fff"]);
    }
    expect(hits(["color: 0x2dd4bf"], "packages/web/src/lib/previews/gridfinity.tsx")).toEqual([
      "1: 0x2dd4bf",
    ]);
  });

  test("fails when git ls-files fails instead of passing on an empty list", () => {
    const outside = mkdtempSync(join(tmpdir(), "colours-"));
    try {
      expect(() => scan(outside)).toThrow("git ls-files failed");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("checks web sources only, and never the token file", () => {
    const paths = ["packages/web/src/app.html", "packages/web/src/lib/styles/tokens.css"];
    paths.push("packages/web/static/manifest.webmanifest", "packages/api/src/index.ts");
    expect(paths.map(isChecked)).toEqual([true, false, false, false]);
  });

  test("packages/web/src has no raw colours outside tokens.css", () => {
    expect(scan()).toEqual([]);
  });
});

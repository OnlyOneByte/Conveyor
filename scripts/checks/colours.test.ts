import { describe, expect, test } from "bun:test";
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

  test("allows 0x colours only in the deferred 3D files", () => {
    const [file] = [...DEFERRED_3D];
    expect(hits(["color: 0x2dd4bf, background: #fff"], file)).toEqual(["1: #fff"]);
    expect(DEFERRED_3D.size).toBe(3);
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

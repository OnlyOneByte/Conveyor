import { describe, expect, test } from "bun:test";
import { isChecked, rawColours, scan } from "./colours";

const found = (lines: string[]) => rawColours("packages/web/src/x.svelte", lines.join("\n"));

describe("the raw colour check", () => {
  test("finds each kind of literal with its line", () => {
    const lines = [".a { color: #fff; }", ".b { background: rgba(0, 0, 0, 0.5); }"];
    lines.push(".c { color: oklch(0.5 0.1 20); border-color: hsl(10 20% 30%); }", "x = '#0e1116';");
    expect(found(lines).map((line) => line.split("svelte:")[1])).toEqual([
      "1: #fff",
      "2: rgba(",
      "3: oklch(",
      "3: hsl(",
      "4: #0e1116",
    ]);
  });

  test("leaves tokens, Svelte blocks, import aliases and ids alone", () => {
    const lines = [
      "color: var(--ink); background: color-mix(in oklch, var(--accent) 8%, transparent);",
    ];
    lines.push(
      "{#each a as b}{/each}{#await p}{/await}",
      'import x from "#lib/api.js";',
      '<a href="#main">',
    );
    expect(found(lines)).toEqual([]);
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

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
        '<p>Red bins are white on the belt</p> tokenColor(name); g.setAttribute("position", attr);',
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

  test("still catches everything #351's property rule caught", () => {
    expect(
      hits([
        ".a { border: red solid; }",
        ".b { border: 2px red solid; }",
        ".c { outline: red dashed 2px; }",
        ".d { border-color: red transparent; }",
        ".e { background: red url(a.png); }",
      ]),
    ).toEqual(["1: red", "2: red", "3: red", "4: red", "5: red"]);
  });

  test("finds a named colour passed to three.js set(), and counts each colour once", () => {
    expect(
      hits([
        'material.color.set("teal"); m.color.set(`navy`);',
        'cache.set("red", value); c.set(value); m.set("not a colour");',
        ".a { border: 1px solid red; --x: red; }",
      ]),
    ).toEqual(["1: teal", "1: navy", "3: red", "3: red"]);
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

  test("finds SVG colour attributes, DOM and canvas writes, and three.js colours", () => {
    expect(
      hits([
        '<stop offset="0" stop-color="white" /><path fill="red" stroke="black" />',
        'el.style.color = "red"; el.style.setProperty("--x", "navy"); el.setAttribute("fill", "teal");',
        'ctx.fillStyle = "orange"; ctx.strokeStyle = "#0e1116";',
        "const c = new THREE.Color(1, 0, 0); m.color.setRGB(1, 0, 0); m.emissive.setHex(0x2dd4bf);",
        'new Color("red"); c.setHSL(0.1, 1, 0.5); c.setStyle(value);',
      ]),
    ).toEqual([
      "1: white",
      "1: red",
      "1: black",
      "2: red",
      "2: navy",
      "2: teal",
      "3: #0e1116",
      "3: orange",
      "4: 0x2dd4bf",
      "4: new THREE.Color(",
      "4: .setRGB(",
      "4: .setHex(",
      "5: Color(",
      "5: new Color(",
      "5: .setHSL(",
      "5: .setStyle(",
    ]);
    const [file] = [...DEFERRED_3D];
    expect(hits(["const c = new THREE.Color(0x2dd4bf); c.setHex(0x0e1116);"], file)).toEqual([]);
  });

  test("checks .svg files under web/src", () => {
    expect(isChecked("packages/web/src/lib/icons/belt.svg")).toBe(true);
    expect(hits(['<svg><rect fill="red" /></svg>'], "packages/web/src/lib/icons/belt.svg")).toEqual(
      ["1: red"],
    );
  });

  const inTempDir = (setup: (dir: string) => void, run: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "colours-"));
    try {
      setup(dir);
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("fails when git ls-files fails", () => {
    inTempDir(
      (dir) => writeFileSync(join(dir, ".git"), "gitdir: ./missing\n"),
      (dir) => expect(() => scan(dir)).toThrow("git ls-files failed"),
    );
  });

  test("fails when git ls-files lists no web sources", () => {
    inTempDir(
      (dir) => Bun.spawnSync(["git", "init", "-q"], { cwd: dir }),
      (dir) => expect(() => scan(dir)).toThrow("git ls-files listed no web sources"),
    );
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

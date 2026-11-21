import { describe, expect, test } from "bun:test";
import { commentLines, compare, languageOf } from "./comments";

const ts = (src: string) => commentLines(src, "script");
const svelte = (src: string) => commentLines(src, "svelte");

describe("script comments", () => {
  test("counts line and block comments by line", () => {
    expect(ts("const a = 1;\n// one\nconst b = 2; // two\n")).toEqual([2, 3]);
    expect(ts("/**\n * doc\n */\nexport {};\n")).toEqual([1, 2, 3]);
    expect(ts("const x = /* inline */ 1;\n")).toEqual([1]);
  });

  test("ignores markers inside strings and URLs", () => {
    expect(ts('const url = "https://example.com/a//b";\n')).toEqual([]);
    expect(ts("const s = '/* not a comment */';\n")).toEqual([]);
    expect(ts('const e = "escaped \\" // still string";\n')).toEqual([]);
  });

  test("ignores markers inside template literals and expressions", () => {
    expect(ts("const t = `http://x/* y */`;\n")).toEqual([]);
    expect(ts(`const t = \`a \${b ? \`//nested\` : { c: 1 }.c} // tail\`;\n`)).toEqual([]);
    expect(ts(`const t = \`\${x}\`; // after\n`)).toEqual([1]);
    expect(ts("const t = `line1\n// line2\n`;\n")).toEqual([]);
  });

  test("ignores markers inside regex literals", () => {
    expect(ts("const r = /\\/\\//g;\n")).toEqual([]);
    expect(ts("const r = /[/*]/;\n")).toEqual([]);
    expect(ts("if (/https?:\\/\\//.test(u)) go();\n")).toEqual([]);
    expect(ts("return /a\\/*b/.test(s);\n")).toEqual([]);
  });

  test("treats slash after a value as division", () => {
    expect(ts("const h = a / b; // half\n")).toEqual([1]);
    expect(ts("const q = (a) / 2 / c;\n")).toEqual([]);
  });

  test("allows biome-ignore directives and shebangs", () => {
    expect(ts("#!/usr/bin/env bun\nconst a = 1;\n")).toEqual([]);
    expect(ts("// biome-ignore lint/style/noNonNullAssertion: reason\nfoo!.bar;\n")).toEqual([]);
  });

  test("counts an unterminated block comment to the end", () => {
    expect(ts("a;\n/* open\nb;\n")).toEqual([2, 3]);
  });
});

describe("svelte comments", () => {
  test("counts HTML, script and style comments", () => {
    const src = [
      '<script lang="ts">',
      "  // script comment",
      '  const href = "https://example.com";',
      "</script>",
      "",
      "<!-- markup comment -->",
      '<a href="https://example.com/a//b">link // text</a>',
      "",
      "<style>",
      "  /* style comment */",
      '  a { background: url("//cdn/x.png"); }',
      "</style>",
    ].join("\n");
    expect(svelte(src)).toEqual([2, 6, 10]);
  });

  test("counts multi-line HTML comments on every line", () => {
    expect(svelte("<div>\n<!--\n  note\n-->\n</div>\n")).toEqual([2, 3, 4]);
  });

  test("allows svelte-ignore directives", () => {
    expect(svelte("<!-- svelte-ignore a11y-autofocus -->\n<input autofocus />\n")).toEqual([]);
  });

  test("ignores markers in string expressions and CSS content", () => {
    const src = '<p>{"// no"}</p>\n<style>\n  p::after { content: "/* */"; }\n</style>\n';
    expect(svelte(src)).toEqual([]);
  });

  test("counts JS comments inside markup expressions only", () => {
    const src = [
      "<button",
      "  on:click={() => {",
      "    // handler comment",
      '    go({ url: "https://x" });',
      "  }}",
      ">https://example.com // {label}</button>",
    ].join("\n");
    expect(svelte(src)).toEqual([3]);
  });

  test("treats block closers as markup, not regex", () => {
    const src = "{#each xs as x}<b>{x}</b>{/each}\n<!-- after -->\n";
    expect(svelte(src)).toEqual([2]);
  });

  test("does not treat an HTML comment marker inside script as markup", () => {
    expect(svelte('<script>\n  const s = "<!-- x -->";\n</script>\n')).toEqual([]);
  });
});

describe("helpers", () => {
  test("languageOf picks svelte by extension", () => {
    expect(languageOf("a/b.svelte")).toBe("svelte");
    expect(languageOf("a/b.ts")).toBe("script");
  });

  test("compare flags only files that grew when the total rose", () => {
    const baseline = { total: 3, files: { "a.ts": 2, "b.ts": 1 } };
    expect(compare({ total: 3, files: { "a.ts": 1, "b.ts": 2 } }, baseline)).toEqual([]);
    expect(compare({ total: 4, files: { "a.ts": 2, "b.ts": 1, "c.ts": 1 } }, baseline)).toEqual([
      "c.ts: 1 (baseline 0)",
    ]);
  });
});

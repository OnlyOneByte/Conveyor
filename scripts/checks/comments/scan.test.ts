import { describe, expect, test } from "bun:test";
import { commentLines, languageOf, tallyFile } from "./tally";

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
    expect(ts(`const t = \`\${ /* c */ x}\`;\n`)).toEqual([1]);
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

  test("skips a shebang but counts every directive", () => {
    expect(ts("#!/usr/bin/env bun\nconst a = 1;\n")).toEqual([]);
    expect(ts("// biome-ignore lint/style/noNonNullAssertion: reason\nfoo!.bar;\n")).toEqual([1]);
    expect(ts("// biome-ignore any free prose\n")).toEqual([1]);
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
      "<!-- markup comment -->",
      '<a href="https://example.com/a//b">link // text</a>',
      "<style>",
      "  /* style comment */",
      '  a { background: url("//cdn/x.png"); }',
      "</style>",
    ].join("\n");
    expect(svelte(src)).toEqual([2, 5, 8]);
  });

  test("counts multi-line HTML comments on every line", () => {
    expect(svelte("<div>\n<!--\n  note\n-->\n</div>\n")).toEqual([2, 3, 4]);
  });

  test("counts block and line comments inside markup expressions", () => {
    expect(svelte("<p>{/* secret */ x}</p>\n")).toEqual([1]);
    expect(svelte("<p>{// secret\n x}</p>\n")).toEqual([1]);
  });

  test("treats block closers as markup, not regex", () => {
    expect(svelte("{#if a}x{/if} <b>/</b> <!-- c -->\n")).toEqual([1]);
    expect(svelte("{#each xs as x}<b>{x}</b>{/each}\n<!-- after -->\n")).toEqual([2]);
  });

  test("does not open a style or script block for components with that prefix", () => {
    expect(
      svelte("<StylePicker value={v} />\n<!-- hidden -->\n<script>\n// too\n</script>\n"),
    ).toEqual([2, 4]);
    expect(svelte("<ScriptEditor />\n<!-- hidden -->\n")).toEqual([2]);
    expect(svelte("<styled-box></styled-box>\n<!-- hidden -->\n")).toEqual([2]);
  });

  test("ignores markers in string expressions and CSS content", () => {
    const src = '<p>{"// no"}</p>\n<style>\n  p::after { content: "/* */"; }\n</style>\n';
    expect(svelte(src)).toEqual([]);
  });

  test("counts JS comments inside handlers only", () => {
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

  test("does not treat an HTML comment marker inside script as markup", () => {
    expect(svelte('<script>\n  const s = "<!-- x -->";\n</script>\n')).toEqual([]);
  });
});

describe("other languages", () => {
  test("html has no markup expressions", () => {
    expect(commentLines("<p>{ // not js }</p>\n<!-- c -->\n", "html")).toEqual([2]);
  });

  test("css block comments outside strings", () => {
    expect(commentLines('a { content: "/* no */"; }\n/* yes */\n', "css")).toEqual([2]);
  });

  test("hash comments at word start, outside quotes, after a shebang", () => {
    const sh = "#!/bin/sh\n# yes\necho \"# no\" '# no' a#b $#\nls # yes\n";
    expect(commentLines(sh, "hash")).toEqual([2, 4]);
    expect(commentLines("url: http://x/#frag\nk: v # yes\n", "hash")).toEqual([2]);
  });

  test("toml comments may follow a value directly", () => {
    expect(commentLines('a = "#no"#yes\n', "toml")).toEqual([1]);
  });
});

describe("tally", () => {
  test("counts suppressions separately from comment lines", () => {
    const src = "// biome-ignore lint/x: y\n// @ts-expect-error\n// plain\n";
    expect(tallyFile(src, "script")).toEqual({ comments: 3, suppressions: 2 });
    expect(tallyFile("<!-- svelte-ignore a11y-autofocus -->\n", "svelte")).toEqual({
      comments: 1,
      suppressions: 1,
    });
  });

  test("languageOf maps every scanned type", () => {
    expect(languageOf("a/b.svelte")).toBe("svelte");
    expect(languageOf("a/b.mjs")).toBe("script");
    expect(languageOf("docs/x.html")).toBe("html");
    expect(languageOf("x.css")).toBe("css");
    expect(languageOf("packages/api/Dockerfile")).toBe("hash");
    expect(languageOf("Caddyfile")).toBe("hash");
    expect(languageOf(".github/workflows/ci.yaml")).toBe("hash");
    expect(languageOf("mise.toml")).toBe("toml");
    expect(languageOf("README.md")).toBeNull();
    expect(languageOf("LICENSE")).toBeNull();
  });
});

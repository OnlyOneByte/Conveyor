import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    const shipped = /\.(svelte|ts)$/.test(entry.name) && !entry.name.includes(".test.");
    return shipped ? [path] : [];
  });

export function railCopy(source: string): string[] {
  const code = source
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/\bclass(?::[\w-]+)?=("[^"]*"|'[^']*'|\{[^}]*\})/g, "")
    .replace(/\bclass:rail\b/g, "");
  const strings = [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
  const markup = code.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const text = [...markup.matchAll(/[>}]([^<>{}"'`]+)(?=[<{])/g)].map((m) => m[1] ?? "");
  return [...strings, ...text].filter((t) => /\brails?\b/i.test(t));
}

test("copy calls it the belt, never the rail", () => {
  const found = sources(SRC).flatMap((path) =>
    railCopy(readFileSync(path, "utf8")).map((text) => `${relative(SRC, path)}: ${text}`),
  );
  expect(found).toEqual([]);
});

test("the check finds rail in copy, labels and markup, but not in class names", () => {
  expect(
    railCopy(`<script>const IDLE = "3 on the rail"; rail.focus();</script>
      <div class="rail" aria-label="Rail, 2 moving">Nothing on the rail</div>
      <span>{n} on the rail{x ? "" : ""}</span><style>.rail { color: red; }</style>`),
  ).toEqual(["3 on the rail", "Rail, 2 moving", "Nothing on the rail", " on the rail"]);
});

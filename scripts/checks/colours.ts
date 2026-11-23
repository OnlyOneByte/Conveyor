import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCOPE = "packages/web/src/";
const TOKENS = "packages/web/src/lib/styles/tokens.css";
const CHECKED = /\.(svelte|ts|js|css|html)$/;
const RAW = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/gi;

export const isChecked = (path: string) =>
  path.startsWith(SCOPE) && path !== TOKENS && CHECKED.test(path);

export function rawColours(path: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, i) => [...line.matchAll(RAW)].map((match) => `${path}:${i + 1}: ${match[0]}`));
}

export function scan(root = ROOT): string[] {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--", SCOPE], { cwd: root }).stdout;
  const paths = listed.toString().split("\0").filter(isChecked);
  return paths.flatMap((path) => rawColours(path, readFileSync(join(root, path), "utf8")));
}

if (import.meta.main) {
  const found = scan();
  for (const line of found) console.error(line);
  console.log(`raw colours outside ${TOKENS}: ${found.length}`);
  process.exit(found.length === 0 ? 0 : 1);
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PIN_FILES = [
  "docker-compose.yml",
  ".github/workflows/ci.yml",
  "tools/visual/stack.ts",
  "tools/visual/stack.test.ts",
  "docs/contributing.md",
];

const IMAGE_REF = /(?<![\w/.:-])(?:[\w.-]+(?::\d+)?\/)*redis[:@][A-Za-z0-9._:@-]+/g;

const DOCKER_HUB = /^(?:(?:index\.)?docker\.io\/)?(?:library\/)?(?=redis[:@])/;

const refsIn = (text: string) =>
  [...text.matchAll(IMAGE_REF)].map((match) =>
    match[0].replace(/[.:-]+$/, "").replace(DOCKER_HUB, ""),
  );

export function redisPinErrors(files: Record<string, string>): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string[]>();
  for (const [path, text] of Object.entries(files)) {
    const refs = refsIn(text);
    if (refs.length === 0) errors.push(`${path}: no Redis image reference found`);
    for (const ref of refs) seen.set(ref, [...(seen.get(ref) ?? []), path]);
  }
  for (const ref of seen.keys())
    if (!/@sha256:[0-9a-f]{64}$/.test(ref))
      errors.push(`the Redis image pin ${ref} isn't pinned by digest (@sha256:<64 hex>)`);
  if (seen.size > 1) {
    const list = [...seen].map(([ref, paths]) => `${ref} (${[...new Set(paths)].join(", ")})`);
    errors.push(`the Redis image pins must all use one reference; found ${list.join("; ")}`);
  }
  return errors;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..", "..");
  const files = Object.fromEntries(
    PIN_FILES.map((path) => [path, readFileSync(join(root, path), "utf8")]),
  );
  const errors = redisPinErrors(files);
  for (const error of errors) console.error(error);
  if (errors.length === 0)
    console.log(`one Redis image in every pin: ${refsIn(files[PIN_FILES[0] ?? ""] ?? "")[0]}`);
  process.exit(errors.length === 0 ? 0 : 1);
}

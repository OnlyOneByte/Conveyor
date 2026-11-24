import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Scene } from "./scene.ts";

export const WEB_SRC = "packages/web/src";
const ROUTES = `${WEB_SRC}/routes`;
const RESOLVE = ["", ".ts", ".svelte", ".js", "/index.ts"];
const SPECIFIER =
  /(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']|@import\s+["']([^"']+)["']/g;

export type Selection = { all: true; reason: string } | { all: false; scenes: string[] };

export function scenePaths(scene: Scene): string[] {
  const steps = scene.steps ?? [];
  const followed = steps.flatMap((s) => ("follow" in s ? [s.follow] : []));
  const landed = steps.flatMap((s) => ("history" in s && s.url ? [s.url] : []));
  return [scene.route, ...followed, ...landed, ...(scene.visits ?? [])].map(
    (p) => new URL(p, "http://x").pathname,
  );
}

function resolveSpecifier(root: string, from: string, spec: string): string | null {
  const base =
    spec.startsWith("#lib/") || spec.startsWith("$lib/")
      ? join(WEB_SRC, "lib", spec.slice(5))
      : spec.startsWith(".")
        ? join(dirname(from), spec)
        : null;
  if (!base) return null;
  const stems = base.endsWith(".js") ? [base.slice(0, -3), base] : [base];
  for (const stem of stems)
    for (const ext of RESOLVE) if (existsSync(join(root, stem + ext))) return stem + ext;
  return null;
}

export function importsOf(root: string, file: string): string[] {
  const text = readFileSync(join(root, file), "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    const hit = spec ? resolveSpecifier(root, file, spec) : null;
    if (hit) found.push(hit);
  }
  return found;
}

function closure(root: string, entries: string[]): Set<string> {
  const seen = new Set<string>();
  const todo = entries.filter((e) => existsSync(join(root, e)));
  for (let file = todo.pop(); file !== undefined; file = todo.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    todo.push(...importsOf(root, file));
  }
  return seen;
}

function pageDirs(root: string): string[] {
  const pages = new Bun.Glob("**/+page.svelte").scanSync({ cwd: join(root, ROUTES) });
  return [...pages].map((p) => dirname(p)).map((d) => (d === "." ? "" : d));
}

export function pageDirFor(dirs: string[], path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const fits = (dir: string) => {
    const want = dir ? dir.split("/") : [];
    return (
      want.length === parts.length && want.every((w, i) => /^\[.+\]$/.test(w) || w === parts[i])
    );
  };
  const exact = dirs.find((d) => fits(d) && !/\[/.test(d));
  return exact ?? dirs.find(fits) ?? null;
}

export function entriesFor(dir: string | null): string[] {
  const files: string[] = [];
  const ancestors =
    dir === null ? [""] : ["", ...dir.split("/").map((_, i, all) => all.slice(0, i + 1).join("/"))];
  for (const d of new Set(ancestors))
    files.push(...["+layout.svelte", "+layout.ts"].map((f) => join(ROUTES, d, f)));
  const own =
    dir === null
      ? [join(ROUTES, "+error.svelte")]
      : ["+page.svelte", "+page.ts", "+page.server.ts"].map((f) => join(ROUTES, dir, f));
  return [...files, ...own];
}

export function selectScenes(root: string, changed: string[], scenes: Scene[]): Selection {
  const relevant = changed.filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".md"));
  const outside = relevant.find((f) => !f.startsWith(`${WEB_SRC}/`));
  if (outside) return { all: true, reason: `${outside} is outside ${WEB_SRC}` };
  const gone = relevant.find((f) => !existsSync(join(root, f)));
  if (gone) return { all: true, reason: `${gone} was moved or deleted` };
  const dirs = pageDirs(root);
  const touched = new Set(relevant);
  const picked = scenes.filter((scene) => {
    const entries = scenePaths(scene).flatMap((p) => entriesFor(pageDirFor(dirs, p)));
    return [...closure(root, entries)].some((f) => touched.has(f));
  });
  if (picked.length === scenes.length)
    return { all: true, reason: "every scene reaches a changed file" };
  return { all: false, scenes: picked.map((s) => s.name) };
}

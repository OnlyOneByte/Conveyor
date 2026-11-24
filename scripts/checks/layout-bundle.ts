import { readFileSync } from "node:fs";
import { join } from "node:path";

export const EVERY_PAGE: Record<string, RegExp> = {
  "layout node (nodes/0.js)": /generated\/build\/client-optimized\/nodes\/0\.js$/,
  "app entry (app.js)": /generated\/build\/client-optimized\/app\.js$/,
  "start entry (entry.js)": /@sveltejs\/kit\/src\/runtime\/client\/entry\.js$/,
};

export const ZOD_MARKER = "ZodError";

interface Chunk {
  file: string;
  imports: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function chunksOf(manifest: unknown): Map<string, Chunk> {
  const chunks = new Map<string, Chunk>();
  if (!isRecord(manifest)) return chunks;
  for (const [key, entry] of Object.entries(manifest)) {
    if (!isRecord(entry) || typeof entry.file !== "string") continue;
    const imports = Array.isArray(entry.imports)
      ? entry.imports.filter((i): i is string => typeof i === "string")
      : [];
    chunks.set(key, { file: entry.file, imports });
  }
  return chunks;
}

export function layoutZodErrors(manifest: unknown, read: (file: string) => string): string[] {
  const chunks = chunksOf(manifest);
  const keys = [...chunks.keys()];
  const entries = Object.entries(EVERY_PAGE).map(([name, pattern]) => ({
    name,
    key: keys.find((key) => pattern.test(key)),
  }));
  const missing = entries.filter((entry) => entry.key === undefined).map((entry) => entry.name);
  if (missing.length)
    return [`the manifest has no ${missing.join(", ")}; build packages/web first`];
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const next of chunks.get(key)?.imports ?? []) visit(next);
  };
  for (const entry of entries) if (entry.key) visit(entry.key);
  return [...seen].flatMap((key) => {
    const file = chunks.get(key)?.file;
    if (!file || !read(file).includes(ZOD_MARKER)) return [];
    return [`${file} is loaded by every page and contains Zod`];
  });
}

if (import.meta.main) {
  const client = process.argv[2] ?? "packages/web/.svelte-kit/output/client";
  const manifest: unknown = JSON.parse(readFileSync(join(client, ".vite/manifest.json"), "utf8"));
  const errors = layoutZodErrors(manifest, (file) => readFileSync(join(client, file), "utf8"));
  for (const error of errors) console.error(error);
  if (errors.length === 0) console.log("every-page bundle (layout, app and start entries): no Zod");
  process.exit(errors.length === 0 ? 0 : 1);
}

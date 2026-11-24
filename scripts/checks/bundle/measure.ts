import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { precached } from "../../../packages/web/src/service-worker/precache";

export interface Chunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

export interface Sizes {
  raw: number;
  gzip: number;
}

export const THREE_MODULE = /[\\/]node_modules[\\/]three[\\/]/;

const chunkSchema = z.object({
  file: z.string(),
  isEntry: z.boolean().optional(),
  imports: z.array(z.string()).optional(),
  dynamicImports: z.array(z.string()).optional(),
});

const manifestSchema = z.record(z.string(), chunkSchema);
const chunkModulesSchema = z.record(z.string(), z.array(z.string()));

function parseWith<T>(schema: z.ZodType<T>, name: string, text: string): T {
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${name} isn't valid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const parseManifest = (text: string): Record<string, Chunk> =>
  parseWith(manifestSchema, "the Vite client manifest", text);

export const parseChunkModules = (text: string): Record<string, string[]> =>
  parseWith(chunkModulesSchema, "chunk-modules.json", text);

export const bundlesThree = (files: Iterable<string>, modules: Record<string, string[]>): boolean =>
  [...files].some((file) => (modules[file] ?? []).some((id) => THREE_MODULE.test(id)));

const gzipOf = (bytes: Buffer) => gzipSync(bytes, { level: 9 }).length;

function sizeOf(client: string, files: Iterable<string>): Sizes {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const bytes = readFileSync(join(client, file));
    raw += bytes.length;
    gzip += gzipOf(bytes);
  }
  return { raw, gzip };
}

const PAGE = /page: \{ layouts: \[([^\]]*)\], errors: \[[^\]]*\], leaf: (\d+) \}/;

export function routeNodes(serverManifest: string): Map<string, number[]> {
  const routes = new Map<string, number[]>();
  for (const segment of serverManifest.split(/(?=\{\s*id: ")/)) {
    const id = /^\{\s*id: "([^"]+)"/.exec(segment)?.[1];
    const page = PAGE.exec(segment);
    if (!id || !page) continue;
    const nodes = (page[1] ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map(Number);
    routes.set(id, [...nodes, Number(page[2])]);
  }
  return routes;
}

export function closure(manifest: Record<string, Chunk>, keys: string[]): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`no chunk ${key} in the client manifest`);
    files.add(chunk.file);
    for (const next of chunk.imports ?? []) visit(next);
  };
  for (const key of keys) visit(key);
  return files;
}

export const routesOf = (output: string): string[] => [
  ...routeNodes(readFileSync(join(output, "server/manifest.js"), "utf8")).keys(),
];

export function initialJs(output: string, route: string): Sizes & { three: boolean } {
  const client = join(output, "client");
  const manifest = parseManifest(readFileSync(join(client, ".vite/manifest.json"), "utf8"));
  const nodes = routeNodes(readFileSync(join(output, "server/manifest.js"), "utf8")).get(route);
  if (!nodes) throw new Error(`no route ${route} in the server manifest`);
  const keys = Object.keys(manifest);
  const entries = keys.filter((key) => manifest[key]?.isEntry && !key.includes("/nodes/"));
  const leaves = nodes.map((n) => {
    const key = keys.find((k) => k.endsWith(`/client-optimized/nodes/${n}.js`));
    if (!key) throw new Error(`no node ${n} in the client manifest`);
    return key;
  });
  const files = closure(manifest, [...entries, ...leaves]);
  const modules = parseChunkModules(readFileSync(join(output, "chunk-modules.json"), "utf8"));
  return { ...sizeOf(client, files), three: bundlesThree(files, modules) };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export const missingCode = (immutable: string[], kept: string[]): string[] => {
  const list = new Set(kept);
  return immutable.filter((path) => /\.(js|css)$/.test(path) && !list.has(path));
};

export function precache(
  output: string,
  staticDir: string,
): Sizes & { files: number; missing: string[] } {
  const client = join(output, "client");
  const immutable = walk(join(client, "_app/immutable")).map((path) => relative(client, path));
  const assets = walk(staticDir).map((path) => relative(staticDir, path));
  const list = precached([...immutable, ...assets]).map((path) => path.slice(1));
  const sizes = sizeOf(
    client,
    list.filter((path) => path.startsWith("_app/")),
  );
  const statics = sizeOf(
    staticDir,
    list.filter((path) => !path.startsWith("_app/")),
  );
  return {
    raw: sizes.raw + statics.raw,
    gzip: sizes.gzip + statics.gzip,
    files: list.length,
    missing: missingCode(immutable, list),
  };
}

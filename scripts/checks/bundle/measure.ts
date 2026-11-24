import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { precached } from "../../../packages/web/src/service-worker/precache";

interface Chunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

export interface Sizes {
  raw: number;
  gzip: number;
}

export const THREE_MARKER = "THREE.WebGLRenderer";

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

export function routeNodes(serverManifest: string): Map<string, number[]> {
  const routes = new Map<string, number[]>();
  const pattern =
    /id: "([^"]+)"[\s\S]*?page: \{ layouts: \[([^\]]*)\], errors: \[[^\]]*\], leaf: (\d+) \}/g;
  for (const [, id, layouts, leaf] of serverManifest.matchAll(pattern)) {
    if (!id || leaf === undefined) continue;
    const nodes = (layouts ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map(Number);
    routes.set(id, [...nodes, Number(leaf)]);
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

export function initialJs(output: string, route: string): Sizes & { three: boolean } {
  const client = join(output, "client");
  const manifest: Record<string, Chunk> = JSON.parse(
    readFileSync(join(client, ".vite/manifest.json"), "utf8"),
  );
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
  const three = [...files].some((file) =>
    readFileSync(join(client, file), "utf8").includes(THREE_MARKER),
  );
  return { ...sizeOf(client, files), three };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function precache(output: string, staticDir: string): Sizes & { files: number } {
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
  return { raw: sizes.raw + statics.raw, gzip: sizes.gzip + statics.gzip, files: list.length };
}

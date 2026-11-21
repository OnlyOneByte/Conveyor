import { PNG } from "pngjs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { messageOf } from "./errors.ts";

export const MARKER = "<!-- conveyor-visual -->";

export const CHANGED_THRESHOLD = 0.005;

export interface Pair {
  file: string;
  scene: string;
  width: number;
  kind: "png" | "gif";
  before: boolean;
  after: boolean;
  diff?: number;
}

const NAME = /^(.+)-(\d+)\.(png|gif)$/;

function listMedia(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => NAME.test(f)) : [];
}

export function pixelDiff(a: Buffer, b: Buffer): number {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return 1;
  let changed = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (
      Math.abs(x.data[i] - y.data[i]) > 16 ||
      Math.abs(x.data[i + 1] - y.data[i + 1]) > 16 ||
      Math.abs(x.data[i + 2] - y.data[i + 2]) > 16
    ) {
      changed++;
    }
  }
  return changed / (x.width * x.height);
}

function parseName(file: string): Pick<Pair, "file" | "scene" | "width" | "kind"> | undefined {
  const match = NAME.exec(file);
  if (!match) return undefined;
  const [, scene, width, kind] = match;
  if (kind !== "png" && kind !== "gif") return undefined;
  return { file, scene, width: Number(width), kind };
}

export function pairUp(beforeDir: string, afterDir: string): Pair[] {
  const before = new Set(listMedia(beforeDir));
  const after = new Set(listMedia(afterDir));
  const pairs = [...new Set([...before, ...after])].flatMap((file): Pair[] => {
    const name = parseName(file);
    if (!name) return [];
    const pair: Pair = { ...name, before: before.has(file), after: after.has(file) };
    if (pair.kind === "png" && pair.before && pair.after) {
      pair.diff = pixelDiff(readFileSync(join(beforeDir, file)), readFileSync(join(afterDir, file)));
    }
    return [pair];
  });
  for (const gif of pairs.filter((p) => p.kind === "gif" && p.before && p.after)) {
    gif.diff = pairs.find((p) => p.kind === "png" && p.scene === gif.scene && p.width === gif.width)?.diff;
  }
  return pairs.sort(
    (a, b) => b.width - a.width || a.scene.localeCompare(b.scene) || a.kind.localeCompare(b.kind),
  );
}

export function isChanged(p: Pair): boolean {
  return !p.before || !p.after || (p.diff ?? 1) > CHANGED_THRESHOLD;
}

function cell(present: boolean, url: string, width: number): string {
  if (!present) return "_none_";
  const shown = width >= 1000 ? 420 : 200;
  return `<a href="${url}"><img src="${url}" width="${shown}"></a>`;
}

function delta(p: Pair): string {
  if (!p.before) return "new";
  if (!p.after) return "removed";
  if (p.diff === undefined) return "—";
  return `${(p.diff * 100).toFixed(p.diff < 0.01 ? 2 : 1)}%`;
}

function table(pairs: Pair[], beforeUrl: string, afterUrl: string): string {
  const rows = pairs.map(
    (p) =>
      `| **${p.scene}** · ${p.width}px${p.kind === "gif" ? " · gif" : ""} | ${cell(p.before, `${beforeUrl}/${p.file}`, p.width)} | ${cell(p.after, `${afterUrl}/${p.file}`, p.width)} | ${delta(p)} |`,
  );
  return ["| Scene | Before | After | Δ pixels |", "|---|---|---|---|", ...rows].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function manifestNotes(manifest: unknown, side: string): string[] {
  if (!isRecord(manifest)) return [`${side}: manifest.json is not an object`];
  const notes = strings(manifest.warnings).map((w) => `${side}: ${w}`);
  const results = Array.isArray(manifest.results) ? manifest.results.filter(isRecord) : [];
  for (const r of results) {
    const where = `${side} · ${String(r.scene)}@${String(r.width)}`;
    for (const w of strings(r.warnings)) notes.push(`${where}: ${w}`);
    if (typeof r.error === "string") notes.push(`${where}: **failed**: ${r.error}`);
  }
  return notes;
}

export function readNotes(dir: string, side: string): string[] {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return [`${side}: no manifest.json (capture did not finish)`];
  try {
    return manifestNotes(JSON.parse(readFileSync(path, "utf8")), side);
  } catch (err) {
    return [`${side}: manifest.json unreadable: ${messageOf(err)}`];
  }
}

export interface Report {
  pairs: Pair[];
  beforeUrl: string;
  afterUrl: string;
  notes?: string[];
  title?: string;
  footer?: string;
}

export function buildMarkdown({ pairs, beforeUrl, afterUrl, notes = [], title, footer }: Report): string {
  const changed = pairs.filter(isChanged);
  const same = pairs.filter((p) => !isChanged(p));
  const parts = [MARKER, `### ${title ?? "Visual changes"}`];
  if (notes.length > 0) parts.push(["> [!WARNING]", ...notes.map((n) => `> - ${n}`)].join("\n"));
  if (pairs.length === 0) parts.push("No screenshots were captured.");
  else if (changed.length === 0) parts.push("No visible changes in any scene.");
  else parts.push(table(changed, beforeUrl, afterUrl));
  if (same.length > 0) {
    parts.push(
      `<details><summary>${same.length} unchanged</summary>\n\n${table(same, beforeUrl, afterUrl)}\n\n</details>`,
    );
  }
  if (footer) parts.push(footer);
  return `${parts.join("\n\n")}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      before: { type: "string" },
      after: { type: "string" },
      "before-url": { type: "string" },
      "after-url": { type: "string" },
      title: { type: "string" },
      footer: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.before || !values.after) {
    console.error("usage: bun compare.ts --before <dir> --after <dir> [--before-url <url>] [--after-url <url>] [--out <file>]");
    process.exit(2);
  }
  const beforeDir = resolve(values.before);
  const afterDir = resolve(values.after);
  const markdown = buildMarkdown({
    pairs: pairUp(beforeDir, afterDir),
    beforeUrl: values["before-url"] ?? beforeDir,
    afterUrl: values["after-url"] ?? afterDir,
    notes: [...readNotes(beforeDir, "before"), ...readNotes(afterDir, "after")],
    title: values.title,
    footer: values.footer,
  });
  if (values.out) await Bun.write(values.out, markdown);
  else process.stdout.write(markdown);
}

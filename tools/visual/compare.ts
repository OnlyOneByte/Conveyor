import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import { messageOf } from "./errors.ts";

export const MARKER = "<!-- conveyor-visual -->";

export const CHANGED_THRESHOLD = 0.005;

export const TOUCHED_FLOOR = 0.005;

export const CHANNEL_NOISE = 16;

export interface PixelDiff {
  changed: number;
  touched: number;
  maxChannel: number;
}

export interface Pair {
  file: string;
  scene: string;
  width: number;
  kind: "png" | "gif";
  before: boolean;
  after: boolean;
  diff?: PixelDiff;
}

const NAME = /^(.+)-(\d+)\.(png|gif)$/;

const RESIZED: PixelDiff = { changed: 1, touched: 1, maxChannel: 255 };

function listMedia(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => NAME.test(f)) : [];
}

export function pixelDiff(a: Buffer, b: Buffer): PixelDiff {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return RESIZED;
  let changed = 0;
  let touched = 0;
  let maxChannel = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    const largest = Math.max(
      Math.abs(x.data[i] - y.data[i]),
      Math.abs(x.data[i + 1] - y.data[i + 1]),
      Math.abs(x.data[i + 2] - y.data[i + 2]),
    );
    if (largest > 0) touched++;
    if (largest > CHANNEL_NOISE) changed++;
    maxChannel = Math.max(maxChannel, largest);
  }
  const pixels = x.width * x.height;
  return { changed: changed / pixels, touched: touched / pixels, maxChannel };
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
      pair.diff = pixelDiff(
        readFileSync(join(beforeDir, file)),
        readFileSync(join(afterDir, file)),
      );
    }
    return [pair];
  });
  for (const gif of pairs.filter((p) => p.kind === "gif" && p.before && p.after)) {
    gif.diff = pairs.find(
      (p) => p.kind === "png" && p.scene === gif.scene && p.width === gif.width,
    )?.diff;
  }
  return pairs.sort(
    (a, b) => b.width - a.width || a.scene.localeCompare(b.scene) || a.kind.localeCompare(b.kind),
  );
}

export function isSubtle(p: Pair): boolean {
  return (
    p.before &&
    p.after &&
    p.diff !== undefined &&
    p.diff.touched > TOUCHED_FLOOR &&
    p.diff.maxChannel <= CHANNEL_NOISE
  );
}

export function isChanged(p: Pair): boolean {
  if (!p.before || !p.after || !p.diff) return true;
  return p.diff.changed > CHANGED_THRESHOLD || p.diff.touched > TOUCHED_FLOOR;
}

function cell(present: boolean, url: string, width: number): string {
  if (!present) return "_none_";
  const shown = width >= 1000 ? 420 : 200;
  return `<a href="${url}"><img src="${url}" width="${shown}"></a>`;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;
}

function deltas(p: Pair): string {
  if (!p.before) return "new | new | new";
  if (!p.after) return "removed | removed | removed";
  if (!p.diff) return "— | — | —";
  return `${percent(p.diff.changed)} | ${percent(p.diff.touched)} | ${p.diff.maxChannel}/255`;
}

function table(pairs: Pair[], beforeUrl: string, afterUrl: string): string {
  const rows = pairs.map(
    (p) =>
      `| **${p.scene}** · ${p.width}px${p.kind === "gif" ? " · gif" : ""} | ${cell(p.before, `${beforeUrl}/${p.file}`, p.width)} | ${cell(p.after, `${afterUrl}/${p.file}`, p.width)} | ${deltas(p)} |`,
  );
  return [
    `| Scene | Before | After | Δ pixels (> ${CHANNEL_NOISE}/255) | Any Δ | Largest Δ |`,
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
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

export function buildMarkdown({
  pairs,
  beforeUrl,
  afterUrl,
  notes = [],
  title,
  footer,
}: Report): string {
  const changed = pairs.filter(isChanged);
  const same = pairs.filter((p) => !isChanged(p));
  const subtle = changed.filter(isSubtle);
  const parts = [MARKER, `### ${title ?? "Visual changes"}`];
  if (notes.length > 0) parts.push(["> [!WARNING]", ...notes.map((n) => `> - ${n}`)].join("\n"));
  if (pairs.length === 0) parts.push("No screenshots were captured.");
  else if (changed.length === 0) parts.push("No visible changes in any scene.");
  else parts.push(table(changed, beforeUrl, afterUrl));
  if (subtle.length > 0) {
    parts.push(
      `${subtle.length} of these changed faintly: no pixel moved by more than ${CHANNEL_NOISE}/255, but more than ${percent(TOUCHED_FLOOR)} moved at all (shading, tone mapping, a theme colour). Compare them pixel by pixel; side by side they look the same.`,
    );
  }
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
    console.error(
      "usage: bun compare.ts --before <dir> --after <dir> [--before-url <url>] [--after-url <url>] [--out <file>]",
    );
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

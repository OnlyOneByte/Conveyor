import type { Comment, Hit } from "./cursor";
import { scanHash } from "./scan-hash";
import { scanMarkup, scanStyle } from "./scan-markup";
import { scanScript } from "./scan-script";

export type Language = "script" | "svelte" | "html" | "css" | "hash" | "toml";

export interface FileTally {
  comments: number;
  suppressions: number;
}

const BY_EXTENSION: Record<string, Language> = {
  ts: "script",
  js: "script",
  mjs: "script",
  cjs: "script",
  svelte: "svelte",
  html: "html",
  css: "css",
  sh: "hash",
  yml: "hash",
  yaml: "hash",
  toml: "toml",
};

const SUPPRESSION =
  /(biome-ignore|svelte-ignore|eslint-(disable|enable)|@ts-(ignore|expect-error|nocheck)|prettier-ignore|shellcheck\s+disable)/;

export function languageOf(path: string): Language | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.startsWith("Dockerfile") || name === "Caddyfile") return "hash";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : (BY_EXTENSION[name.slice(dot + 1)] ?? null);
}

const scan = (src: string, language: Language, hit: Hit) => {
  const whole = { src, from: 0, to: src.length };
  if (language === "script") scanScript({ range: whole, hit });
  else if (language === "css") scanStyle(whole, hit);
  else if (language === "hash" || language === "toml") {
    scanHash({ src, hit, anywhere: language === "toml" });
  } else scanMarkup({ src, hit, expressions: language === "svelte" });
};

export function findComments(src: string, language: Language): Comment[] {
  const found: Comment[] = [];
  scan(src, language, (comment) => found.push(comment));
  return found;
}

export function commentLines(src: string, language: Language): number[] {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number) => lineStarts.findLastIndex((start) => start <= offset) + 1;
  const lines = new Set<number>();
  for (const { start, end } of findComments(src, language)) {
    const last = lineOf(Math.max(start, end - 1));
    for (let line = lineOf(start); line <= last; line++) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
}

export function tallyFile(src: string, language: Language): FileTally {
  const suppressions = findComments(src, language).filter((c) => SUPPRESSION.test(c.body)).length;
  return { comments: commentLines(src, language).length, suppressions };
}

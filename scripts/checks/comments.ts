import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Language = "script" | "svelte";

export interface Baseline {
  total: number;
  files: Record<string, number>;
}

const ALLOWED_DIRECTIVES = ["biome-ignore", "svelte-ignore"];

const REGEX_PRECEDING_PUNCTUATION = new Set("(,=:[!&|?{};+-*%<>~^".split(""));

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const WORD_CHAR = /[A-Za-z0-9_$]/;

type Hit = (start: number, end: number, body: string) => void;

const isAllowed = (body: string) => {
  const trimmed = body.trim();
  return ALLOWED_DIRECTIVES.some((directive) => trimmed.startsWith(directive));
};

const endOf = (src: string, needle: string, from: number, limit: number, include: boolean) => {
  const found = src.indexOf(needle, from);
  if (found === -1 || found >= limit) return limit;
  return include ? found + needle.length : found;
};

const skipQuoted = (src: string, from: number, limit: number, quote: string) => {
  let i = from + 1;
  while (i < limit) {
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === quote || c === "\n") return i + 1;
    else i++;
  }
  return limit;
};

const skipTemplateChunk = (src: string, from: number, limit: number) => {
  let i = from;
  while (i < limit) {
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === "`") return { end: i + 1, expression: false };
    else if (c === "$" && src[i + 1] === "{") return { end: i + 2, expression: true };
    else i++;
  }
  return { end: limit, expression: false };
};

const skipRegex = (src: string, from: number, limit: number) => {
  let i = from + 1;
  let inClass = false;
  while (i < limit) {
    const c = src[i];
    if (c === "\n") return from + 1;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (inClass && c === "]") inClass = false;
    else if (!inClass && c === "[") inClass = true;
    else if (!inClass && c === "/") {
      i++;
      while (i < limit && WORD_CHAR.test(src[i] ?? "")) i++;
      return i;
    }
    i++;
  }
  return limit;
};

const regexAllowedAfter = (previous: string) =>
  previous === "" ||
  REGEX_PRECEDING_PUNCTUATION.has(previous) ||
  REGEX_PRECEDING_KEYWORDS.has(previous);

export function scanScript(
  src: string,
  from: number,
  to: number,
  hit: Hit,
  stopAtUnmatchedBrace = false,
): number {
  let i = from;
  let previous = "";
  let braceDepth = 0;
  const templateBraces: number[] = [];
  if (src.startsWith("#!", i)) i = endOf(src, "\n", i, to, false);
  while (i < to) {
    const c = src[i] ?? "";
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = endOf(src, "\n", i, to, false);
      hit(i, end, src.slice(i + 2, end));
      i = end;
    } else if (c === "/" && next === "*") {
      const end = endOf(src, "*/", i + 2, to, true);
      hit(i, end, src.slice(i + 2, end - 2));
      i = end;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(src, i, to, c);
      previous = "a";
    } else if (c === "`") {
      const chunk = skipTemplateChunk(src, i + 1, to);
      if (chunk.expression) templateBraces.push(0);
      i = chunk.end;
      previous = chunk.expression ? "{" : "a";
    } else if (c === "}" && templateBraces.length > 0 && templateBraces.at(-1) === 0) {
      templateBraces.pop();
      const chunk = skipTemplateChunk(src, i + 1, to);
      if (chunk.expression) templateBraces.push(0);
      i = chunk.end;
      previous = chunk.expression ? "{" : "a";
    } else if (c === "/") {
      if (regexAllowedAfter(previous)) {
        i = skipRegex(src, i, to);
        previous = "a";
      } else {
        i++;
        previous = "/";
      }
    } else if (WORD_CHAR.test(c)) {
      const start = i;
      while (i < to && WORD_CHAR.test(src[i] ?? "")) i++;
      previous = src.slice(start, i);
    } else if (/\s/.test(c)) {
      i++;
    } else {
      if (templateBraces.length > 0) {
        const top = templateBraces.length - 1;
        if (c === "{") templateBraces[top] = (templateBraces[top] ?? 0) + 1;
        else if (c === "}") templateBraces[top] = (templateBraces[top] ?? 0) - 1;
      } else if (c === "{") {
        braceDepth++;
      } else if (c === "}") {
        if (braceDepth === 0 && stopAtUnmatchedBrace) return i + 1;
        braceDepth--;
      }
      previous = c;
      i++;
    }
  }
  return to;
}

export function scanStyle(src: string, from: number, to: number, hit: Hit): void {
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const end = endOf(src, "*/", i + 2, to, true);
      hit(i, end, src.slice(i + 2, end - 2));
      i = end;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(src, i, to, c);
    } else {
      i++;
    }
  }
}

export function scanSvelte(src: string, hit: Hit): void {
  const lower = src.toLowerCase();
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const end = endOf(src, "-->", i + 4, src.length, true);
      hit(i, end, src.slice(i + 4, end - 3));
      i = end;
    } else if (lower.startsWith("<script", i) || lower.startsWith("<style", i)) {
      const kind = lower.startsWith("<script", i) ? "script" : "style";
      const openEnd = endOf(src, ">", i, src.length, true);
      const closeStart = endOf(lower, `</${kind}`, openEnd, src.length, false);
      if (kind === "script") scanScript(src, openEnd, closeStart, hit);
      else scanStyle(src, openEnd, closeStart, hit);
      i = endOf(src, ">", closeStart, src.length, true);
    } else if (src.startsWith("{/", i)) {
      i = endOf(src, "}", i, src.length, true);
    } else if (src[i] === "{") {
      i = scanScript(src, i + 1, src.length, hit, true);
    } else {
      i++;
    }
  }
}

export function commentLines(src: string, language: Language): number[] {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const lines = new Set<number>();
  const hit: Hit = (start, end, body) => {
    if (isAllowed(body)) return;
    const last = lineOf(Math.max(start, end - 1));
    for (let line = lineOf(start); line <= last; line++) lines.add(line);
  };
  if (language === "svelte") scanSvelte(src, hit);
  else scanScript(src, 0, src.length, hit);
  return [...lines].sort((a, b) => a - b);
}

export const languageOf = (path: string): Language =>
  path.endsWith(".svelte") ? "svelte" : "script";

export function measure(root: string, files: string[]): Baseline {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const file of [...files].sort()) {
    const count = commentLines(readFileSync(join(root, file), "utf8"), languageOf(file)).length;
    if (count === 0) continue;
    counts[file] = count;
    total += count;
  }
  return { total, files: counts };
}

export function compare(current: Baseline, baseline: Baseline): string[] {
  if (current.total <= baseline.total) return [];
  return Object.entries(current.files)
    .filter(([file, count]) => count > (baseline.files[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} (baseline ${baseline.files[file] ?? 0})`);
}

function trackedSources(root: string): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--", "*.ts", "*.js", "*.svelte"], {
    cwd: root,
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout
    .toString()
    .split("\0")
    .filter((file) => file && existsSync(join(root, file)));
}

function main(argv: string[]): number {
  const root = join(import.meta.dir, "..", "..");
  const baselinePath = join(import.meta.dir, "comments-baseline.json");
  const files = trackedSources(root);
  const current = measure(root, files);

  if (argv.includes("--strict")) {
    for (const file of Object.keys(current.files)) {
      const src = readFileSync(join(root, file), "utf8");
      for (const line of commentLines(src, languageOf(file))) console.error(`${file}:${line}`);
    }
    console.log(`comment lines: ${current.total} (strict: 0 allowed)`);
    return current.total === 0 ? 0 : 1;
  }

  if (argv.includes("--update") || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`wrote baseline: ${current.total} comment lines`);
    return 0;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  console.log(`comment lines: ${current.total} (baseline ${baseline.total})`);
  const regressions = compare(current, baseline);
  if (current.total > baseline.total) {
    console.error("comment count went up; remove comments instead of adding them:");
    for (const line of regressions) console.error(`  ${line}`);
    return 1;
  }
  if (current.total < baseline.total) {
    console.log("count dropped; run `bun run check:comments:update` to lower the baseline");
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));

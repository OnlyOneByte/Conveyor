import { blockComment, type Hit, indexIn, lineComment, type Range, skipQuoted } from "./cursor";
import { skipRegex, skipTemplateChunk, WORD_CHAR } from "./literals";

export interface ScriptScan {
  range: Range;
  hit: Hit;
  stopAtUnmatchedBrace?: boolean;
}

interface State {
  src: string;
  to: number;
  i: number;
  previous: string;
  templateBraces: number[];
  depth: number;
  stopAtUnmatchedBrace: boolean;
  stopped: boolean;
  hit: Hit;
}

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

const regexAllowedAfter = (previous: string) =>
  previous === "" ||
  REGEX_PRECEDING_PUNCTUATION.has(previous) ||
  REGEX_PRECEDING_KEYWORDS.has(previous);

const rangeAt = (s: State, from: number): Range => ({ src: s.src, from, to: s.to });

const enterTemplateChunk = (s: State, from: number) => {
  const chunk = skipTemplateChunk(rangeAt(s, from));
  if (chunk.expression) s.templateBraces.push(0);
  s.i = chunk.end;
  s.previous = chunk.expression ? "{" : "a";
};

const comment = (s: State) => {
  if (s.src[s.i] !== "/") return false;
  const next = s.src[s.i + 1];
  if (next !== "/" && next !== "*") return false;
  const found =
    next === "/" ? lineComment(rangeAt(s, s.i), 2) : blockComment(rangeAt(s, s.i), "/*", "*/");
  s.hit(found);
  s.i = found.end;
  return true;
};

const quoted = (s: State) => {
  const c = s.src[s.i];
  if (c !== '"' && c !== "'") return false;
  s.i = skipQuoted(rangeAt(s, s.i));
  s.previous = "a";
  return true;
};

const template = (s: State) => {
  if (s.src[s.i] !== "`") return false;
  enterTemplateChunk(s, s.i + 1);
  return true;
};

const templateResume = (s: State) => {
  if (s.src[s.i] !== "}" || s.templateBraces.at(-1) !== 0) return false;
  s.templateBraces.pop();
  enterTemplateChunk(s, s.i + 1);
  return true;
};

const slash = (s: State) => {
  if (s.src[s.i] !== "/") return false;
  if (regexAllowedAfter(s.previous)) {
    s.i = skipRegex(rangeAt(s, s.i));
    s.previous = "a";
  } else {
    s.i++;
    s.previous = "/";
  }
  return true;
};

const word = (s: State) => {
  const start = s.i;
  while (s.i < s.to && WORD_CHAR.test(s.src[s.i] ?? "")) s.i++;
  if (s.i === start) return false;
  s.previous = s.src.slice(start, s.i);
  return true;
};

const whitespace = (s: State) => {
  if (!/\s/.test(s.src[s.i] ?? "")) return false;
  s.i++;
  return true;
};

const trackBrace = (s: State, c: string) => {
  const top = s.templateBraces.length - 1;
  const delta = c === "{" ? 1 : c === "}" ? -1 : 0;
  if (top >= 0) {
    s.templateBraces[top] = (s.templateBraces[top] ?? 0) + delta;
    return;
  }
  if (delta === -1 && s.depth === 0 && s.stopAtUnmatchedBrace) s.stopped = true;
  s.depth += delta;
};

const punctuation = (s: State) => {
  const c = s.src[s.i] ?? "";
  trackBrace(s, c);
  s.previous = c;
  s.i++;
  return true;
};

const STEPS = [comment, quoted, template, templateResume, slash, word, whitespace, punctuation];

export function scanScript(scan: ScriptScan): number {
  const { src, from, to } = scan.range;
  const state: State = {
    src,
    to,
    i: src.startsWith("#!", from) ? indexIn(scan.range, "\n") : from,
    previous: "",
    templateBraces: [],
    depth: 0,
    stopAtUnmatchedBrace: scan.stopAtUnmatchedBrace ?? false,
    stopped: false,
    hit: scan.hit,
  };
  while (state.i < state.to && !state.stopped) STEPS.some((step) => step(state));
  return state.i;
}

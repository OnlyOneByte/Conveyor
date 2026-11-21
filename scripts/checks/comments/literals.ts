import type { Range } from "./cursor";

export interface TemplateChunk {
  end: number;
  expression: boolean;
}

export const WORD_CHAR = /[A-Za-z0-9_$]/;

export const skipTemplateChunk = (range: Range): TemplateChunk => {
  let i = range.from;
  while (i < range.to) {
    const c = range.src[i];
    if (c === "\\") i += 2;
    else if (c === "`") return { end: i + 1, expression: false };
    else if (c === "$" && range.src[i + 1] === "{") return { end: i + 2, expression: true };
    else i++;
  }
  return { end: range.to, expression: false };
};

const regexBodyEnd = (range: Range): number => {
  let i = range.from + 1;
  let inClass = false;
  while (i < range.to) {
    const c = range.src[i];
    if (c === "\n") return -1;
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i + 1;
    i++;
  }
  return range.to;
};

export const skipRegex = (range: Range): number => {
  let i = regexBodyEnd(range);
  if (i === -1) return range.from + 1;
  while (i < range.to && WORD_CHAR.test(range.src[i] ?? "")) i++;
  return i;
};

export interface Range {
  src: string;
  from: number;
  to: number;
}

export interface Comment {
  start: number;
  end: number;
  body: string;
}

export type Hit = (comment: Comment) => void;

export const indexIn = (range: Range, needle: string): number => {
  const found = range.src.indexOf(needle, range.from);
  return found === -1 || found >= range.to ? range.to : found;
};

export const afterNeedle = (range: Range, needle: string): number => {
  const at = indexIn(range, needle);
  return at === range.to ? range.to : at + needle.length;
};

export const skipQuoted = (range: Range): number => {
  const quote = range.src[range.from];
  let i = range.from + 1;
  while (i < range.to) {
    const c = range.src[i];
    if (c === "\\") i += 2;
    else if (c === quote || c === "\n") return i + 1;
    else i++;
  }
  return range.to;
};

export const lineComment = (range: Range, markerLength: number): Comment => {
  const end = indexIn(range, "\n");
  return { start: range.from, end, body: range.src.slice(range.from + markerLength, end) };
};

export const blockComment = (range: Range, open: string, close: string): Comment => {
  const end = afterNeedle({ ...range, from: range.from + open.length }, close);
  const bodyEnd = range.src.endsWith(close, end) ? end - close.length : end;
  return { start: range.from, end, body: range.src.slice(range.from + open.length, bodyEnd) };
};

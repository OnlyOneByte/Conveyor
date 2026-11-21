import { type Hit, indexIn, lineComment, skipQuoted } from "./cursor";

export interface HashScan {
  src: string;
  hit: Hit;
  anywhere: boolean;
}

const startsComment = (scan: HashScan, at: number) => {
  if (scan.src[at] !== "#") return false;
  if (at === 0) return !scan.src.startsWith("#!");
  return scan.anywhere || /\s/.test(scan.src[at - 1] ?? "");
};

const QUOTE_OPENERS = /[\s:=[{(,$]/;

const startsQuote = (scan: HashScan, at: number) => {
  const c = scan.src[at];
  if (c !== '"' && c !== "'") return false;
  return at === 0 || QUOTE_OPENERS.test(scan.src[at - 1] ?? "");
};

export function scanHash(scan: HashScan): void {
  const range = { src: scan.src, from: 0, to: scan.src.length };
  let i = scan.src.startsWith("#!") ? indexIn(range, "\n") : 0;
  while (i < range.to) {
    if (startsComment(scan, i)) {
      const found = lineComment({ ...range, from: i }, 1);
      scan.hit(found);
      i = found.end;
    } else if (startsQuote(scan, i)) {
      i = skipQuoted({ ...range, from: i });
    } else {
      i++;
    }
  }
}

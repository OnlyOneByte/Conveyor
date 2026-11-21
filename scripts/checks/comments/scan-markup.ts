import { afterNeedle, blockComment, type Hit, indexIn, type Range, skipQuoted } from "./cursor";
import { scanScript } from "./scan-script";

export interface MarkupScan {
  src: string;
  hit: Hit;
  expressions: boolean;
}

const EMBEDDED_TAG = /^<(script|style)(?=[\s>/])/;

const BLOCK_CLOSER = /^\{\/[a-z]/;

export function scanStyle(range: Range, hit: Hit): void {
  let i = range.from;
  while (i < range.to) {
    const c = range.src[i];
    if (c === "/" && range.src[i + 1] === "*") {
      const found = blockComment({ ...range, from: i }, "/*", "*/");
      hit(found);
      i = found.end;
    } else if (c === '"' || c === "'") {
      i = skipQuoted({ ...range, from: i });
    } else {
      i++;
    }
  }
}

const embedded = (scan: MarkupScan, at: number, tag: string): number => {
  const whole = { src: scan.src, from: at, to: scan.src.length };
  const openEnd = afterNeedle(whole, ">");
  const closeStart = indexIn({ ...whole, from: openEnd }, `</${tag}`);
  const body = { src: scan.src, from: openEnd, to: closeStart };
  if (tag === "script") scanScript({ range: body, hit: scan.hit });
  else scanStyle(body, scan.hit);
  return afterNeedle({ ...whole, from: closeStart }, ">");
};

const expression = (scan: MarkupScan, at: number): number => {
  const whole = { src: scan.src, from: at, to: scan.src.length };
  if (BLOCK_CLOSER.test(scan.src.slice(at, at + 3))) return afterNeedle(whole, "}");
  return scanScript({
    range: { ...whole, from: at + 1 },
    hit: scan.hit,
    stopAtUnmatchedBrace: true,
  });
};

const step = (scan: MarkupScan, at: number): number => {
  const { src } = scan;
  if (src.startsWith("<!--", at)) {
    const found = blockComment({ src, from: at, to: src.length }, "<!--", "-->");
    scan.hit(found);
    return found.end;
  }
  const tag = EMBEDDED_TAG.exec(src.slice(at, at + 8));
  if (tag?.[1]) return embedded(scan, at, tag[1]);
  if (scan.expressions && src[at] === "{") return expression(scan, at);
  return at + 1;
};

export function scanMarkup(scan: MarkupScan): void {
  let i = 0;
  while (i < scan.src.length) i = step(scan, i);
}

import { afterNeedle, blockComment, type Hit, indexIn, type Range, skipQuoted } from "./cursor";
import { scanScript } from "./scan-script";

export interface MarkupScan {
  src: string;
  hit: Hit;
  expressions: boolean;
  caseInsensitiveTags: boolean;
}

interface Markup extends MarkupScan {
  tagSource: string;
}

const TAG_NAME = /^<([A-Za-z][\w:.-]*)/;

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

const whole = (scan: Markup, from: number): Range => ({ src: scan.src, from, to: scan.src.length });

const expression = (scan: Markup, at: number): number => {
  if (BLOCK_CLOSER.test(scan.src.slice(at, at + 3))) return afterNeedle(whole(scan, at), "}");
  return scanScript({ range: whole(scan, at + 1), hit: scan.hit, stopAtUnmatchedBrace: true });
};

const quotedValue = (scan: Markup, at: number): number => {
  const quote = scan.src[at];
  let i = at + 1;
  while (i < scan.src.length && scan.src[i] !== quote) {
    i = scan.expressions && scan.src[i] === "{" ? expression(scan, i) : i + 1;
  }
  return i + 1;
};

const tagEnd = (scan: Markup, from: number): number => {
  let i = from;
  while (i < scan.src.length) {
    const c = scan.src[i];
    if (c === ">") return i + 1;
    if (c === '"' || c === "'") i = quotedValue(scan, i);
    else if (scan.expressions && c === "{") i = expression(scan, i);
    else i++;
  }
  return scan.src.length;
};

const embeddedBody = (scan: Markup, openEnd: number, tag: string): number => {
  const closeStart = indexIn({ ...whole(scan, openEnd), src: scan.tagSource }, `</${tag}`);
  const body = { src: scan.src, from: openEnd, to: closeStart };
  if (tag === "script") scanScript({ range: body, hit: scan.hit });
  else scanStyle(body, scan.hit);
  return afterNeedle(whole(scan, closeStart), ">");
};

const openTag = (scan: Markup, at: number): number => {
  const name = TAG_NAME.exec(scan.tagSource.slice(at, at + 64))?.[1];
  if (!name) return at + 1;
  const end = tagEnd(scan, at + name.length + 1);
  const selfClosing = scan.src[end - 2] === "/";
  if ((name === "script" || name === "style") && !selfClosing) {
    return embeddedBody(scan, end, name);
  }
  return end;
};

const step = (scan: Markup, at: number): number => {
  const { src } = scan;
  if (src.startsWith("<!--", at)) {
    const found = blockComment(whole(scan, at), "<!--", "-->");
    scan.hit(found);
    return found.end;
  }
  if (src[at] === "<") return openTag(scan, at);
  if (scan.expressions && src[at] === "{") return expression(scan, at);
  return at + 1;
};

export function scanMarkup(scan: MarkupScan): void {
  const markup: Markup = {
    ...scan,
    tagSource: scan.caseInsensitiveTags
      ? scan.src.replace(/[A-Z]/g, (c) => c.toLowerCase())
      : scan.src,
  };
  let i = 0;
  while (i < markup.src.length) i = step(markup, i);
}

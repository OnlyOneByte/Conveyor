import * as ts from "typescript";
import type { LineHits } from "./lcov";

export interface Body {
  header: number;
  first: number;
  last: number;
}

const runs = (statement: ts.Statement) =>
  !ts.isFunctionDeclaration(statement) &&
  !ts.isInterfaceDeclaration(statement) &&
  !ts.isTypeAliasDeclaration(statement);

export function functionBodies(path: string, source: string): Body[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const lineOf = (position: number) => file.getLineAndCharacterOfPosition(position).line + 1;
  const bodies: Body[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && "body" in node && node.body && ts.isBlock(node.body)) {
      const statements = node.body.statements;
      const first = statements.find(runs);
      const last = statements.at(-1);
      if (first && last) {
        bodies.push({
          header: lineOf(node.getStart(file)),
          first: lineOf(first.getStart(file)),
          last: lineOf(last.getEnd()),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return bodies;
}

const neverRan = (lines: LineHits, { header, first, last }: Body) =>
  lines.get(first) === 0 || (first === last && header !== first && lines.get(header) === 0);

export function withoutUnrunBodies(lines: LineHits, bodies: Body[]): LineHits {
  const out = new Map(lines);
  for (const body of bodies) {
    if (!neverRan(lines, body)) continue;
    for (let line = body.first; line <= body.last; line++) if (out.has(line)) out.set(line, 0);
  }
  return out;
}

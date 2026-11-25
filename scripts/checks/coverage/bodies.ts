import * as ts from "typescript";
import type { LineHits } from "./lcov";

export interface Body {
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
      if (first && last)
        bodies.push({ first: lineOf(first.getStart(file)), last: lineOf(last.getEnd()) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return bodies;
}

export function withoutUnrunBodies(lines: LineHits, bodies: Body[]): LineHits {
  const out = new Map(lines);
  for (const { first, last } of bodies) {
    if (lines.get(first) !== 0) continue;
    for (let line = first; line <= last; line++) if (out.has(line)) out.set(line, 0);
  }
  return out;
}

import ts from "typescript";
import type { Tree } from "../comments/tree";
import type { Counts } from "../lines/count";

const IN_SCOPE = /\.(ts|tsx|mts|cts|svelte)$/;

const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

export const inScope = (path: string) => IN_SCOPE.test(path);

const isConstAssertion = (node: ts.AsExpression) =>
  ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === "const";

function isCast(node: ts.Node): boolean {
  if (ts.isAsExpression(node)) return !isConstAssertion(node);
  return ts.isTypeAssertionExpression(node);
}

function countIn(source: ts.SourceFile): number {
  let casts = 0;
  const visit = (node: ts.Node) => {
    if (isCast(node)) casts++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return casts;
}

const scriptKindOf = (path: string) =>
  path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const parse = (path: string, text: string) =>
  ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));

const scriptsOf = (path: string, text: string) =>
  path.endsWith(".svelte") ? [...text.matchAll(SCRIPT_BLOCK)].map((m) => m[1] ?? "") : [text];

export const countCasts = (path: string, text: string): number =>
  scriptsOf(path, text).reduce((sum, script) => sum + countIn(parse(path, script)), 0);

export function measure(tree: Tree): Counts {
  const counts: Counts = {};
  for (const path of tree.list().sort()) {
    const text = inScope(path) ? tree.read(path) : null;
    const casts = text === null ? 0 : countCasts(path, text);
    if (casts > 0) counts[path] = casts;
  }
  return counts;
}

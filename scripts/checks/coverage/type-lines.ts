import * as ts from "typescript";

const SEPARATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.SemicolonToken,
]);

const isTypeOnly = (node: ts.Node) =>
  (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isTypeAliasDeclaration(node);

interface LineTokens {
  type: boolean;
  other: boolean;
}

export function typeOnlyLines(path: string, source: string): Set<number> {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const lines = new Map<number, LineTokens>();
  const lineOf = (position: number) => file.getLineAndCharacterOfPosition(position).line + 1;
  const mark = (token: ts.Node, inType: boolean) => {
    const separator = SEPARATORS.has(token.kind);
    for (let line = lineOf(token.getStart(file)); line <= lineOf(token.getEnd() - 1); line++) {
      const seen = lines.get(line) ?? { type: false, other: false };
      if (inType) seen.type = true;
      else if (!separator) seen.other = true;
      lines.set(line, seen);
    }
  };
  const visit = (node: ts.Node, inType: boolean) => {
    const typed = inType || isTypeOnly(node);
    const children = node.getChildren(file);
    if (children.length === 0) {
      mark(node, typed);
      return;
    }
    for (const child of children) visit(child, typed);
  };
  visit(file, false);
  return new Set([...lines].filter(([, seen]) => seen.type && !seen.other).map(([line]) => line));
}

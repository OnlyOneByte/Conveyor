import ts from "typescript";

export interface TempDirCall {
  line: number;
  prefix: string | null;
}

const MAKERS = new Set(["mkdtemp", "mkdtempSync"]);
export const CHECKS_ITS_OWN_PREFIX = "packages/shared/test/helpers/temp.ts";
const JOINERS = new Set(["join", "resolve"]);

const calleeName = (node: ts.Expression): string | null => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
};

const isTmpdir = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && calleeName(node.expression) === "tmpdir";

const mentionsTmpdir = (node: ts.Node): boolean =>
  isTmpdir(node) || (ts.forEachChild(node, (child) => mentionsTmpdir(child) || undefined) ?? false);

function literalPrefix(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text || null;
  if (ts.isTemplateExpression(node)) return node.head.text || null;
  return null;
}

function prefixUnderTmpdir(arg: ts.Expression): string | null | undefined {
  if (ts.isCallExpression(arg) && JOINERS.has(calleeName(arg.expression) ?? "")) {
    const [parent, prefix, ...rest] = arg.arguments;
    if (parent && isTmpdir(parent)) return rest.length === 0 ? literalPrefix(prefix) : null;
  }
  return mentionsTmpdir(arg) ? null : undefined;
}

export function tempDirCalls(source: string, fileName = "file.ts"): TempDirCall[] {
  if (fileName === CHECKS_ITS_OWN_PREFIX) return [];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const calls: TempDirCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && MAKERS.has(calleeName(node.expression) ?? "")) {
      const [arg] = node.arguments;
      const prefix = arg ? prefixUnderTmpdir(arg) : undefined;
      if (prefix !== undefined)
        calls.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, prefix });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

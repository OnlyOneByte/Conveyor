import ts from "typescript";

export type Verdict =
  | { kind: "listed"; prefix: string }
  | { kind: "inside"; parent: string }
  | { kind: "unreadable"; arg: string };

export type TempDirCall = Verdict & { line: number };

export const SCANNED = ["*.ts", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs"];

export const REVIEWED: readonly { file: string; arg: string; why: string }[] = [
  {
    file: "packages/shared/test/helpers/temp.ts",
    arg: "join(tmpdir(), prefix)",
    why: "tempDirs refuses a prefix TEMP_PREFIXES lacks before it makes a dir",
  },
  {
    file: "scripts/checks/coverage/runner.test.ts",
    arg: "join(ROOT, PROBE_PREFIX)",
    why: "the sweep probe has to sit inside the repository, and the test removes it in a finally",
  },
];

const MAKERS = new Set(["mkdtemp", "mkdtempSync"]);
const FS = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const OS = new Set(["os", "node:os"]);
const PATH = new Set(["path", "node:path"]);
const JOINS = new Set(["join", "resolve"]);

interface Names {
  makers: Set<string>;
  tmpdir: Set<string>;
  joiners: Set<string>;
}

interface Scan {
  names: Names;
  made: Set<string>;
  file: ts.SourceFile;
}

const BINDS: [modules: Set<string>, exported: Set<string>, into: keyof Names][] = [
  [FS, MAKERS, "makers"],
  [OS, new Set(["tmpdir"]), "tmpdir"],
  [PATH, JOINS, "joiners"],
];

function addBinding(names: Names, from: string, element: ts.ImportSpecifier): void {
  const imported = (element.propertyName ?? element.name).text;
  for (const [modules, exported, into] of BINDS)
    if (modules.has(from) && exported.has(imported)) names[into].add(element.name.text);
}

function addImports(names: Names, statement: ts.Statement): void {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return;
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return;
  for (const element of bindings.elements)
    addBinding(names, statement.moduleSpecifier.text, element);
}

function importedNames(file: ts.SourceFile): Names {
  const names: Names = {
    makers: new Set(MAKERS),
    tmpdir: new Set(["tmpdir"]),
    joiners: new Set(JOINS),
  };
  for (const statement of file.statements) addImports(names, statement);
  return names;
}

const memberName = (node: ts.Expression): string | null => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return node.argumentExpression.text;
  return null;
};

const isMaker = (callee: ts.Expression, names: Names): boolean =>
  ts.isIdentifier(callee) ? names.makers.has(callee.text) : MAKERS.has(memberName(callee) ?? "");

const isTmpdirCall = (node: ts.Expression, names: Names): boolean =>
  ts.isCallExpression(node) &&
  node.arguments.length === 0 &&
  (ts.isIdentifier(node.expression)
    ? names.tmpdir.has(node.expression.text)
    : ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "tmpdir");

const isJoin = (callee: ts.Expression, names: Names): boolean =>
  ts.isIdentifier(callee)
    ? names.joiners.has(callee.text)
    : ts.isPropertyAccessExpression(callee) && JOINS.has(callee.name.text);

function literalPrefix(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text || null;
  if (ts.isTemplateExpression(node)) return node.head.text || null;
  return null;
}

function judge(arg: ts.Expression, { names, made, file }: Scan): Verdict {
  const unreadable: Verdict = { kind: "unreadable", arg: arg.getText(file) };
  if (!ts.isCallExpression(arg) || !isJoin(arg.expression, names) || arg.arguments.length !== 2)
    return unreadable;
  const [parent, name] = arg.arguments;
  const prefix = name ? literalPrefix(name) : null;
  if (!parent || prefix === null) return unreadable;
  if (isTmpdirCall(parent, names)) return { kind: "listed", prefix };
  if (ts.isIdentifier(parent) && made.has(parent.text))
    return { kind: "inside", parent: parent.text };
  return unreadable;
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAwaitExpression(node) ? node.expression : node;

function madeDir(node: ts.Node, scan: Scan): string | null {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer)
    return null;
  const call = unwrap(node.initializer);
  if (!ts.isCallExpression(call) || !isMaker(call.expression, scan.names) || !call.arguments[0])
    return null;
  return judge(call.arguments[0], scan).kind === "unreadable" ? null : node.name.text;
}

export function tempDirCalls(source: string, fileName = "file.ts"): TempDirCall[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const scan: Scan = { names: importedNames(file), made: new Set<string>(), file };
  const calls: TempDirCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isMaker(node.expression, scan.names)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const [arg] = node.arguments;
      const verdict: Verdict = arg ? judge(arg, scan) : { kind: "unreadable", arg: "" };
      const reviewed =
        verdict.kind === "unreadable" &&
        REVIEWED.some((r) => r.file === fileName && r.arg === verdict.arg);
      if (!reviewed) calls.push({ ...verdict, line });
    }
    const dir = madeDir(node, scan);
    if (dir) scan.made.add(dir);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

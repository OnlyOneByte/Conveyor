import ts from "typescript";

const GLOBALS = new Set(["globalThis", "window", "self", "global"]);
const COMPILERS = new Set(["eval", "Function"]);
const TIMERS = new Set(["setTimeout", "setInterval"]);

const isGlobal = (node: ts.Expression): boolean => {
  if (ts.isIdentifier(node)) return GLOBALS.has(node.text);
  const name = memberName(node);
  return (
    name !== null &&
    GLOBALS.has(name) &&
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    isGlobal(node.expression)
  );
};

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const isFunctionValue = (node: ts.Expression): boolean => {
  const inner = unwrap(node);
  if (ts.isFunctionExpression(inner) || ts.isArrowFunction(inner)) return true;
  return (
    ts.isCallExpression(inner) &&
    memberName(inner.expression) === "getPrototypeOf" &&
    inner.arguments[0] !== undefined &&
    isFunctionValue(inner.arguments[0])
  );
};

function memberName(node: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return node.argumentExpression.text;
  return null;
}

function globalMember(node: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
  return isGlobal(node.expression) ? memberName(node) : null;
}

const isText = (node: ts.Expression | undefined): boolean =>
  node !== undefined &&
  (ts.isStringLiteralLike(node) ||
    ts.isTemplateExpression(node) ||
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (isText(node.left) || isText(node.right))));

function harmlessName(node: ts.Identifier): boolean {
  const { parent } = node;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return node.text !== "Function";
  if (!ts.isBindingElement(parent) && "name" in parent && parent.name === node) return true;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
  )
    return parent.right === node;
  if (ts.isTypeOfExpression(parent)) return true;
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    parent.name.text === "prototype"
  );
}

function compilerReference(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return COMPILERS.has(node.text) && !harmlessName(node);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const name = globalMember(node);
    if (name !== null && COMPILERS.has(name)) return true;
    return memberName(node) === "constructor" && isFunctionValue(node.expression);
  }
  return false;
}

function compilingCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const timer = ts.isIdentifier(callee) ? callee.text : globalMember(callee);
  if (timer !== null && TIMERS.has(timer)) return isText(node.arguments[0]);
  return memberName(callee) === "constructor" && isText(node.arguments[0]);
}

export function buildsCode(source: string): boolean {
  const file = ts.createSourceFile(
    "chunk.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (compilerReference(node) || compilingCall(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

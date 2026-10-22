import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';

export function isFunctionLike(node: Node): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  );
}

/** Nearest function-like ancestor (not the node itself). */
export function enclosingFunction(node: Node): Node | undefined {
  for (let cur = node.getParent(); cur; cur = cur.getParent()) {
    if (isFunctionLike(cur)) return cur;
  }
  return undefined;
}

/** Outermost function-like ancestor-or-self below the source file. */
export function outermostFunction(node: Node): Node | undefined {
  let found: Node | undefined;
  for (let cur: Node | undefined = node; cur; cur = cur.getParent()) {
    if (isFunctionLike(cur)) found = cur;
  }
  return found;
}

export function isModuleScope(node: Node): boolean {
  return enclosingFunction(node) === undefined && !node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
}

/** Literal value of a string / no-substitution-template argument. */
export function stringArg(call: CallExpression, idx: number): string | undefined {
  const arg = call.getArguments()[idx];
  if (!arg) return undefined;
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) return arg.getLiteralText();
  return undefined;
}

/** Strip parentheses, `as`, `satisfies`, `!`, type assertions and `await`. */
export function unwrap(node: Node): Node {
  let cur: Node = node;
  for (;;) {
    if (Node.isParenthesizedExpression(cur)) cur = cur.getExpression();
    else if (Node.isAsExpression(cur)) cur = cur.getExpression();
    else if (Node.isSatisfiesExpression(cur)) cur = cur.getExpression();
    else if (Node.isNonNullExpression(cur)) cur = cur.getExpression();
    else if (Node.isTypeAssertion(cur)) cur = cur.getExpression();
    else if (Node.isAwaitExpression(cur)) cur = cur.getExpression();
    else return cur;
  }
}

export function lineCol(node: Node, pos: number = node.getStart()): { line: number; column: number } {
  const lc = node.getSourceFile().getLineAndColumnAtPos(pos);
  return { line: lc.line, column: lc.column };
}

export function lineColEnd(node: Node): { line: number; column: number } {
  return lineCol(node, node.getEnd());
}

export function sourceLineText(sf: SourceFile, line: number): string {
  const text = sf.getFullText();
  let start = 0;
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) return '';
    start = nl + 1;
  }
  let end = text.indexOf('\n', start);
  if (end === -1) end = text.length;
  return text.slice(start, end).replace(/\r$/, '');
}

/** Function name for a function-like node (declaration name, or variable it is assigned to). */
export function functionName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn)) {
    const n = fn.getName();
    if (n) return n;
  }
  const parent = fn.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
  if (parent && Node.isPropertyAssignment(parent)) return parent.getName();
  return undefined;
}

/** True when `node` is `anc` or a descendant of it. */
export function isWithin(node: Node, anc: Node): boolean {
  return (
    node.getStart() >= anc.getStart() &&
    node.getEnd() <= anc.getEnd() &&
    node.getSourceFile() === anc.getSourceFile()
  );
}

export function isDirectiveStatement(stmt: Node | undefined, directive: string): boolean {
  if (!stmt || !Node.isExpressionStatement(stmt)) return false;
  const e = stmt.getExpression();
  return Node.isStringLiteral(e) && e.getLiteralText() === directive;
}

/** Names bound by a binding name node (identifier or destructuring pattern). */
export function bindingNames(nameNode: Node): string[] {
  if (Node.isIdentifier(nameNode)) return [nameNode.getText()];
  const out: string[] = [];
  if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.getElements()) {
      if (Node.isBindingElement(el)) out.push(...bindingNames(el.getNameNode()));
    }
  }
  return out;
}

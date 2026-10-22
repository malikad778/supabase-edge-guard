import { Node, SyntaxKind } from 'ts-morph';
import { bindingNames, isFunctionLike, unwrap } from './ast-utils.js';

export interface Taint {
  isTainted(node: Node): boolean;
  names: Set<string>;
}

const REQUEST_ROOTS = new Set(['req', 'request']);
const REQUEST_PROPS = new Set(['body', 'query', 'params', 'searchParams', 'nextUrl', 'url']);
const REQUEST_READERS = new Set(['json', 'formData', 'text', 'arrayBuffer']);
const TRUSTED_PARAMS = /^(supabase|client|admin|user|session|context|db|_)$/i;

function rootIdentifier(node: Node): string | undefined {
  let cur: Node = node;
  for (let i = 0; i < 50; i++) {
    cur = unwrap(cur);
    if (Node.isIdentifier(cur)) return cur.getText();
    if (Node.isPropertyAccessExpression(cur) || Node.isElementAccessExpression(cur))
      cur = cur.getExpression();
    else if (Node.isCallExpression(cur)) cur = cur.getExpression();
    else return undefined;
  }
  return undefined;
}

function isRequestSource(node: Node): boolean {
  const n = unwrap(node);
  if (Node.isPropertyAccessExpression(n)) {
    if (n.getName() === 'searchParams') return true;
    const root = rootIdentifier(n);
    if (root && REQUEST_ROOTS.has(root)) {
      // first property after the root
      let cur: Node = n;
      let first = n.getName();
      while (Node.isPropertyAccessExpression(cur)) {
        first = cur.getName();
        cur = cur.getExpression();
      }
      return REQUEST_PROPS.has(first);
    }
    return false;
  }
  if (Node.isCallExpression(n)) {
    const callee = n.getExpression();
    if (Node.isPropertyAccessExpression(callee) && REQUEST_READERS.has(callee.getName())) {
      const root = rootIdentifier(callee.getExpression());
      return root !== undefined && REQUEST_ROOTS.has(root);
    }
  }
  return false;
}

/**
 * Same-function taint: identifiers derived from request input (or from entry-point parameters).
 * `scope` is the outermost enclosing function (or source file). When `paramsTainted` is true
 * (the scope is an entry point: server action, route handler, edge handler, createServerFn),
 * its parameters count as user input.
 */
export function createTaint(scope: Node, paramsTainted: boolean): Taint {
  const names = new Set<string>();

  if (paramsTainted && isFunctionLike(scope)) {
    const params = (scope as Node & { getParameters(): Node[] }).getParameters();
    for (const p of params) {
      if (Node.isParameterDeclaration(p)) {
        for (const n of bindingNames(p.getNameNode())) if (!TRUSTED_PARAMS.test(n)) names.add(n);
      }
    }
  }

  const check = (node: Node, depth: number): boolean => {
    if (depth > 40) return false;
    const n = unwrap(node);
    if (Node.isIdentifier(n)) return names.has(n.getText());
    if (isRequestSource(n)) return true;
    if (Node.isPropertyAccessExpression(n) || Node.isElementAccessExpression(n)) {
      return check(n.getExpression(), depth + 1);
    }
    if (Node.isCallExpression(n)) {
      const callee = n.getExpression();
      if (Node.isPropertyAccessExpression(callee) && check(callee.getExpression(), depth + 1)) return true;
      return n.getArguments().some((a) => check(a, depth + 1));
    }
    if (Node.isTemplateExpression(n))
      return n.getTemplateSpans().some((s) => check(s.getExpression(), depth + 1));
    if (Node.isBinaryExpression(n)) return check(n.getLeft(), depth + 1) || check(n.getRight(), depth + 1);
    if (Node.isConditionalExpression(n))
      return check(n.getWhenTrue(), depth + 1) || check(n.getWhenFalse(), depth + 1);
    if (Node.isPrefixUnaryExpression(n) || Node.isPostfixUnaryExpression(n))
      return check(n.getOperand(), depth + 1);
    if (Node.isSpreadElement(n) || Node.isSpreadAssignment(n)) return check(n.getExpression(), depth + 1);
    if (Node.isObjectLiteralExpression(n)) {
      return n.getProperties().some((p) => {
        if (Node.isPropertyAssignment(p)) {
          const init = p.getInitializer();
          return init !== undefined && check(init, depth + 1);
        }
        if (Node.isShorthandPropertyAssignment(p)) return names.has(p.getName());
        if (Node.isSpreadAssignment(p)) return check(p.getExpression(), depth + 1);
        return false;
      });
    }
    if (Node.isArrayLiteralExpression(n)) return n.getElements().some((e) => check(e, depth + 1));
    return false;
  };

  // propagate through declarations / assignments to a fixpoint
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const vd of scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = vd.getInitializer();
      if (!init || !check(init, 0)) continue;
      for (const nm of bindingNames(vd.getNameNode())) {
        if (!names.has(nm)) {
          names.add(nm);
          changed = true;
        }
      }
    }
    for (const bin of scope.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      const left = bin.getLeft();
      if (Node.isIdentifier(left) && check(bin.getRight(), 0) && !names.has(left.getText())) {
        names.add(left.getText());
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { isTainted: (node: Node) => check(node, 0), names };
}

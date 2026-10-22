import { Node, SyntaxKind } from 'ts-morph';
import type { Finding, Fix, Rule, TextEdit } from '../core/types.js';
import { enclosingFunction, isWithin, unwrap } from '../ts/ast-utils.js';
import { enclosingBoundary } from '../ts/boundary.js';
import type { SupabaseCall } from '../ts/supabase-calls.js';

interface SessionAnalysis {
  readsUser: boolean;
  fix: Fix | null;
}

const NULLISH = /^(null|undefined)$/;

function analyze(call: SupabaseCall): SessionAnalysis {
  const node = call.node;
  const scope: Node = enclosingFunction(node) ?? node.getSourceFile();
  const scopeText = scope.getText();
  const textReadsUser = /session\??\.user\b|\.session\??\.user\b/.test(scopeText);

  // find `const { data: { session } } = await ...getSession()`
  const decl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (!decl || unwrap(decl.getInitializer() ?? node) !== node) return { readsUser: textReadsUser, fix: null };
  const nameNode = decl.getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) return { readsUser: textReadsUser, fix: null };
  const dataEl = nameNode
    .getElements()
    .find((el) => (el.getPropertyNameNode()?.getText() ?? el.getName()) === 'data');
  const inner = dataEl?.getNameNode();
  if (!dataEl || !inner || !Node.isObjectBindingPattern(inner))
    return { readsUser: textReadsUser, fix: null };
  const sessionEl = inner
    .getElements()
    .find((el) => (el.getPropertyNameNode()?.getText() ?? el.getName()) === 'session');
  if (!sessionEl || !Node.isIdentifier(sessionEl.getNameNode()) || sessionEl.getInitializer()) {
    return { readsUser: textReadsUser, fix: null };
  }
  const localName = sessionEl.getName();
  const aliased = sessionEl.getPropertyNameNode() !== undefined;
  const newLocal = aliased ? localName : 'user';

  const sf = node.getSourceFile();
  // collisions: any other declaration named newLocal (when renaming) or localName in scope
  const declaredNames = [
    ...scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration).map((d) => d.getNameNode()),
    ...scope.getDescendantsOfKind(SyntaxKind.Parameter).map((p) => p.getNameNode()),
    ...scope.getDescendantsOfKind(SyntaxKind.BindingElement).map((b) => b.getNameNode()),
  ].filter((n) => Node.isIdentifier(n));
  const clash = declaredNames.some(
    (n) => n !== sessionEl.getNameNode() && (n.getText() === newLocal || n.getText() === localName),
  );
  if (!aliased && declaredNames.some((n) => n !== sessionEl.getNameNode() && n.getText() === 'user')) {
    return { readsUser: textReadsUser, fix: null };
  }
  if (clash && aliased) return { readsUser: textReadsUser, fix: null };

  let readsUser = false;
  let mechanical = true;
  const usageEdits: TextEdit[] = [];
  const file = sf.getFilePath().replace(/^\//, '');
  for (const id of scope.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() !== localName || id === sessionEl.getNameNode()) continue;
    const parent = id.getParent();
    if (!parent) continue;
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue; // obj.session
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) continue;
    if (Node.isBindingElement(parent) && parent.getPropertyNameNode() === id) continue;
    if (!isWithin(id, scope)) continue;
    if (
      Node.isPropertyAccessExpression(parent) &&
      parent.getExpression() === id &&
      parent.getName() === 'user'
    ) {
      readsUser = true;
      usageEdits.push({ file, start: parent.getStart(), end: parent.getEnd(), text: newLocal });
      continue;
    }
    let nullCheck = false;
    if (Node.isPrefixUnaryExpression(parent) && parent.getOperatorToken() === SyntaxKind.ExclamationToken)
      nullCheck = true;
    else if (Node.isIfStatement(parent) && parent.getExpression() === id) nullCheck = true;
    else if (Node.isConditionalExpression(parent) && parent.getCondition() === id) nullCheck = true;
    else if (Node.isBinaryExpression(parent)) {
      const op = parent.getOperatorToken().getKind();
      if (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken) nullCheck = true;
      else if (
        [
          SyntaxKind.EqualsEqualsToken,
          SyntaxKind.EqualsEqualsEqualsToken,
          SyntaxKind.ExclamationEqualsToken,
          SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(op)
      ) {
        const other = parent.getLeft() === id ? parent.getRight() : parent.getLeft();
        nullCheck = NULLISH.test(other.getText());
      }
    }
    if (nullCheck) {
      usageEdits.push({ file, start: id.getStart(), end: id.getEnd(), text: newLocal });
    } else {
      mechanical = false;
    }
  }

  if (!mechanical) return { readsUser: readsUser || textReadsUser, fix: null };
  const callee = node.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return { readsUser, fix: null };
  const nameTok = callee.getNameNode();
  const edits: TextEdit[] = [{ file, start: nameTok.getStart(), end: nameTok.getEnd(), text: 'getUser' }];
  if (aliased) {
    const prop = sessionEl.getPropertyNameNode();
    if (prop) edits.push({ file, start: prop.getStart(), end: prop.getEnd(), text: 'user' });
  } else {
    const nm = sessionEl.getNameNode();
    edits.push({ file, start: nm.getStart(), end: nm.getEnd(), text: 'user' });
  }
  edits.push(...usageEdits);
  return {
    readsUser,
    fix: {
      description:
        'Replace auth.getSession() with auth.getUser() and use `user` instead of `session` / `session.user`.',
      safe: true,
      edits,
    },
  };
}

export const sg001: Rule = {
  meta: {
    id: 'SG001',
    name: 'ServerAuthGetSessionSpoof',
    severity: 'error',
    layer: 'ts',
    summary: 'auth.getSession() used for authentication in server, edge or middleware code.',
    incident:
      'getSession() reads the session straight from the cookie without asking the Auth server to verify it. ' +
      'An attacker can craft a cookie with any user id, so authorization decisions based on session.user are spoofable. ' +
      'Supabase documents this and recommends getUser() (verified) or getClaims() (verified JWT signature) on the server.',
    badExample:
      "const { data: { session } } = await supabase.auth.getSession();\nif (!session) redirect('/login');\nawait db.update(session.user.id);",
    goodExample:
      "const { data: { user } } = await supabase.auth.getUser();\nif (!user) redirect('/login');\nawait db.update(user.id);",
    fixable: 'safe',
    references: [
      'https://supabase.com/docs/guides/auth/server-side/nextjs',
      'https://supabase.com/docs/reference/javascript/auth-getsession',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const file of ctx.ts.files) {
      for (const call of file.calls) {
        if (call.kind !== 'getSession') continue;
        const b = enclosingBoundary(call.node, file.boundaryInfo);
        if (b !== 'server' && b !== 'edge' && b !== 'middleware') continue;
        const scope: Node = enclosingFunction(call.node) ?? file.sourceFile;
        const verified = file.calls.some(
          (c) => (c.kind === 'getUser' || c.kind === 'getClaims') && isWithin(c.node, scope),
        );
        const analysis = analyze(call);
        if (verified && !analysis.readsUser) continue;
        const f: Finding = ctx.report({
          ruleId: 'SG001',
          message:
            'auth.getSession() trusts an unverified cookie in server code, so the user identity can be forged; use auth.getUser() (or getClaims()) instead.',
          file: file.path,
          line: call.line,
          column: call.column,
        });
        if (analysis.fix) f.fix = analysis.fix;
        out.push(f);
      }
    }
    return out;
  },
};

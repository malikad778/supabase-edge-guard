import { Node, SyntaxKind } from 'ts-morph';
import type { Finding, Rule } from '../core/types.js';
import { enclosingFunction, lineCol, unwrap } from '../ts/ast-utils.js';

const SESSION_METHODS = new Set(['setSession', 'setAuth']);

export const sg009: Rule = {
  meta: {
    id: 'SG009',
    name: 'SharedClientSessionLeak',
    severity: 'error',
    layer: 'ts',
    summary: 'A module-scope Supabase client has its session/auth mutated per request on the server.',
    incident:
      'A client created at module scope is shared by every request handled by the same server instance. Calling auth.setSession() or setAuth() on it inside a handler ' +
      "makes the next request run with the previous user's credentials - a cross-user data leak that only shows up under concurrency.",
    badExample:
      'const supabase = createClient(url, anonKey);\nexport async function GET(req: Request) {\n  await supabase.auth.setSession({ access_token, refresh_token });\n}',
    goodExample:
      'export async function GET(req: Request) {\n  const supabase = createClient(url, anonKey); // per-request client\n  await supabase.auth.setSession({ access_token, refresh_token });\n}',
    fixable: 'none',
    references: ['https://supabase.com/docs/guides/auth/server-side/creating-a-client'],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const file of ctx.ts.files) {
      if (
        !['server', 'edge', 'middleware'].includes(file.boundary) &&
        file.boundaryInfo.source !== 'createServerFn'
      )
        continue;
      const shared = new Set<string>();
      for (const c of file.calls) {
        if (c.kind !== 'createClient' || c.serviceRole) continue;
        if (enclosingFunction(c.node) !== undefined) continue;
        const vd = c.node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (vd && unwrap(vd.getInitializer() ?? c.node) === c.node && Node.isIdentifier(vd.getNameNode()))
          shared.add(vd.getName());
      }
      if (shared.size === 0) continue;
      for (const call of file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (!Node.isPropertyAccessExpression(callee) || !SESSION_METHODS.has(callee.getName())) continue;
        const holder = callee.getExpression();
        // X.auth.setSession / X.functions.setAuth / X.realtime.setAuth
        if (!Node.isPropertyAccessExpression(holder)) continue;
        const root = holder.getExpression();
        if (!Node.isIdentifier(root) || !shared.has(root.getText())) continue;
        if (enclosingFunction(call) === undefined) continue;
        const { line, column } = lineCol(call);
        out.push(
          ctx.report({
            ruleId: 'SG009',
            message: `Module-scope client '${root.getText()}' is shared across requests but ${holder.getName()}.${callee.getName()}() changes its credentials per request, leaking one user's session into the next.`,
            file: file.path,
            line,
            column,
          }),
        );
      }
    }
    return out;
  },
};

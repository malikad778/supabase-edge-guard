import { Node } from 'ts-morph';
import type { Finding, Rule } from '../core/types.js';
import { isWithin, lineCol, outermostFunction, unwrap } from '../ts/ast-utils.js';
import { enclosingBoundary } from '../ts/boundary.js';
import { createTaint, type Taint } from '../ts/taint.js';
import { AUTH_CHECK_NAMES, calleeName, isEntryPoint, isScriptLikePath } from './helpers.js';

const OWNERISH = /^(?:user|owner|author|tenant|org|organization|team|account|created_by|profile)(?:_?id)?$/i;
const PAYLOAD_OPS = new Set(['insert', 'update', 'upsert']);
const TRUSTED_FLOW =
  /constructEvent|timingSafeEqual|verifySignature|verifyWebhook|svix|CRON_SECRET|x-cron-secret|x-webhook-secret|stripe-signature/i;

/** Walk outward from the terminal `.insert()/.update()/...` call to the end of the builder chain. */
function chainCalls(op: Node): Node[] {
  const calls: Node[] = [op];
  let top: Node = op;
  for (;;) {
    const parent = top.getParent();
    const grand = parent?.getParent();
    if (
      parent &&
      grand &&
      Node.isPropertyAccessExpression(parent) &&
      parent.getExpression() === top &&
      Node.isCallExpression(grand)
    ) {
      calls.push(grand);
      top = grand;
    } else break;
  }
  return calls;
}

function taintedPayload(arg: Node, taint: Taint): boolean {
  const e = unwrap(arg);
  if (Node.isObjectLiteralExpression(e)) {
    return e.getProperties().some((p) => {
      if (Node.isSpreadAssignment(p)) return taint.isTainted(p.getExpression());
      if (Node.isPropertyAssignment(p)) {
        const init = p.getInitializer();
        return OWNERISH.test(p.getName().replace(/['"]/g, '')) && init !== undefined && taint.isTainted(init);
      }
      if (Node.isShorthandPropertyAssignment(p))
        return OWNERISH.test(p.getName()) && taint.isTainted(p.getNameNode());
      return false;
    });
  }
  return taint.isTainted(e);
}

export const sg002: Rule = {
  meta: {
    id: 'SG002',
    name: 'ServiceRoleWithoutAuthCheck',
    severity: 'error',
    layer: 'ts',
    summary: 'service_role client used on user-controlled input or without verifying the caller first.',
    incident:
      'The service_role key bypasses every RLS policy. When a server action or route handler uses it with an id taken from the request ' +
      '(or without calling auth.getUser() first), any caller can read or modify any row. This is the classic "IDOR via admin client" bug.',
    badExample:
      "const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);\nexport async function POST(req: Request) {\n  const { id } = await req.json();\n  await admin.from('orders').delete().eq('id', id);\n}",
    goodExample:
      "const { data: { user } } = await supabase.auth.getUser();\nif (!user) return new Response('unauthorized', { status: 401 });\nawait supabase.from('orders').delete().eq('id', id); // RLS enforces ownership",
    fixable: 'none',
    references: [
      'https://supabase.com/docs/guides/api/api-keys',
      'https://supabase.com/docs/guides/database/postgres/row-level-security',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const file of ctx.ts.files) {
      if (isScriptLikePath(file.path)) continue;
      for (const call of file.calls) {
        if (call.kind !== 'fromMutation') continue;
        const b = enclosingBoundary(call.node, file.boundaryInfo);
        if (b !== 'server' && b !== 'edge') continue;
        // receiver of `.from(...)`
        const opAccess = call.node;
        if (!Node.isCallExpression(opAccess)) continue;
        const opCallee = opAccess.getExpression();
        if (!Node.isPropertyAccessExpression(opCallee)) continue;
        const fromCall = opCallee.getExpression();
        if (!Node.isCallExpression(fromCall)) continue;
        const fromCallee = fromCall.getExpression();
        if (!Node.isPropertyAccessExpression(fromCallee)) continue;
        const receiver = fromCallee.getExpression();
        if (!file.admin.isAdminReceiver(receiver)) continue;

        const scope = outermostFunction(call.node);
        const scopeNode: Node = scope ?? file.sourceFile;
        const scopeText = scopeNode.getText();
        if (TRUSTED_FLOW.test(scopeText)) continue;

        const taint = createTaint(scopeNode, scope !== undefined && isEntryPoint(scope, file));
        const chain = chainCalls(opAccess);
        let taintedArg: string | undefined;
        chain.forEach((c, i) => {
          if (taintedArg || !Node.isCallExpression(c)) return;
          const isOp = i === 0;
          const method = Node.isPropertyAccessExpression(c.getExpression())
            ? (c.getExpression() as import('ts-morph').PropertyAccessExpression).getName()
            : '';
          for (const arg of c.getArguments()) {
            const hit =
              isOp && PAYLOAD_OPS.has(method)
                ? taintedPayload(arg, taint)
                : !isOp || !PAYLOAD_OPS.has(method)
                  ? taint.isTainted(arg)
                  : false;
            if (hit) {
              taintedArg = arg.getText().replace(/\s+/g, ' ');
              if (taintedArg.length > 40) taintedArg = `${taintedArg.slice(0, 37)}...`;
              return;
            }
          }
        });

        const startPos = receiver.getStart();
        const verified = scope
          ? scope.getDescendants().some((d) => {
              if (!Node.isCallExpression(d) || d.getStart() >= startPos) return false;
              const n = calleeName(d);
              return n !== undefined && AUTH_CHECK_NAMES.has(n) && isWithin(d, scope);
            })
          : false;

        if (!taintedArg && verified) continue;
        const { line, column } = lineCol(receiver, startPos);
        out.push(
          ctx.report({
            ruleId: 'SG002',
            message: taintedArg
              ? `service_role client bypasses all RLS and '${taintedArg}' comes from user input without being checked against the authenticated user.`
              : 'service_role client bypasses all RLS and no authenticated user is verified before this query (auth.getUser()/getClaims() is not called first).',
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

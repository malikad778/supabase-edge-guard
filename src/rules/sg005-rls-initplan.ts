import type { Finding, PolicyInfo, Rule } from '../core/types.js';
import { findAuthCalls, isWrappedInSelect } from '../sql/sql-utils.js';
import { sqlPos } from './helpers.js';

function checkExpr(
  ctx: Parameters<Rule['check']>[0],
  p: PolicyInfo,
  expr: string | undefined,
  offset: number | undefined,
  out: Finding[],
): void {
  if (expr === undefined || offset === undefined) return;
  for (const hit of findAuthCalls(expr)) {
    if (isWrappedInSelect(expr, hit.offset)) continue;
    const abs = offset + hit.offset;
    const { line, column } = sqlPos(ctx.sql, p.file, abs);
    const replacement = `(select auth.${hit.fn}())`;
    const f = ctx.report({
      ruleId: 'SG005',
      message: `auth.${hit.fn}() in policy "${p.name}" is re-evaluated for every row; wrap it as ${replacement} so Postgres computes it once.`,
      file: p.file,
      line,
      column,
    });
    f.fix = {
      description: `Replace auth.${hit.fn}() with ${replacement}.`,
      safe: true,
      edits: [{ file: p.file, start: abs, end: abs + hit.len, text: replacement }],
    };
    out.push(f);
  }
}

export const sg005: Rule = {
  meta: {
    id: 'SG005',
    name: 'RlsPolicyAuthUidNotWrapped',
    severity: 'warning',
    layer: 'sql',
    summary: 'auth.uid()/jwt()/role()/email() in an RLS policy is not wrapped in (select ...).',
    incident:
      'Calling auth.uid() directly in a policy makes Postgres evaluate it once per row. Wrapping it in (select auth.uid()) turns it into an initPlan that is evaluated once per query. ' +
      'On large tables this is the difference between milliseconds and timeouts, and it is the most common finding of the Supabase database linter.',
    badExample: 'create policy "own rows" on public.notes using (user_id = auth.uid());',
    goodExample: 'create policy "own rows" on public.notes using (user_id = (select auth.uid()));',
    fixable: 'safe',
    references: [
      'https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select',
      'https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const p of ctx.sql.policies) {
      checkExpr(ctx, p, p.using, p.usingOffset, out);
      checkExpr(ctx, p, p.withCheck, p.withCheckOffset, out);
    }
    return out;
  },
};

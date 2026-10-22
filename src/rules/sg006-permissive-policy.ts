import type { Finding, Rule } from '../core/types.js';
import { maskExprLiterals } from '../sql/sql-utils.js';
import { exposedSchemas } from './helpers.js';

function normalizeUid(expr: string): string {
  return maskExprLiterals(expr).replace(/\(\s*select\s+(auth\s*\.\s*uid\s*\(\s*\))\s*\)/gi, '$1');
}

const NULL_OR =
  /\bauth\s*\.\s*uid\s*\(\s*\)\s+is\s+null\s+or\b|\bor\s+\(?\s*auth\s*\.\s*uid\s*\(\s*\)\s+is\s+null\b/i;

function isTrue(expr: string | undefined): boolean {
  if (expr === undefined) return false;
  let t = expr.trim().toLowerCase();
  while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
  return t === 'true';
}

export const sg006: Rule = {
  meta: {
    id: 'SG006',
    name: 'OverlyPermissivePolicy',
    severity: 'error',
    layer: 'sql',
    summary:
      "Policy that is effectively 'allow everyone': auth.uid() IS NULL OR ..., or USING (true) on writes.",
    incident:
      '"auth.uid() IS NULL OR owner = auth.uid()" is true for every anonymous request, and USING (true) on UPDATE/DELETE/ALL lets anon or any user rewrite the table. ' +
      'Both pass casual review because the policy "exists", yet RLS no longer protects anything.',
    badExample:
      'create policy "anyone" on public.posts for update using (true);\ncreate policy "mine" on public.notes using (auth.uid() is null or user_id = auth.uid());',
    goodExample:
      'create policy "owner updates" on public.posts for update to authenticated using (author_id = (select auth.uid()));',
    fixable: 'none',
    references: ['https://supabase.com/docs/guides/database/postgres/row-level-security'],
  },
  check(ctx) {
    const out: Finding[] = [];
    const exposed = exposedSchemas(ctx);
    for (const p of ctx.sql.policies) {
      for (const expr of [p.using, p.withCheck]) {
        if (expr !== undefined && NULL_OR.test(normalizeUid(expr))) {
          out.push(
            ctx.report({
              ruleId: 'SG006',
              message: `Policy "${p.name}" on ${p.schema}.${p.table} contains "auth.uid() IS NULL OR ...", which is true for every anonymous request.`,
              file: p.file,
              line: p.line,
              column: 1,
            }),
          );
          break;
        }
      }
      if (!exposed.has(p.schema)) continue;
      const usesTrue = isTrue(p.using) || isTrue(p.withCheck);
      if (!usesTrue) continue;
      const open = p.roles.length === 0 || p.roles.includes('anon') || p.roles.includes('public');
      if (p.command === 'SELECT') {
        out.push(
          ctx.report({
            ruleId: 'SG006',
            severity: 'info',
            message: `Policy "${p.name}" lets everyone read every row of ${p.schema}.${p.table} (USING (true)); fine for public data, review if not.`,
            file: p.file,
            line: p.line,
            column: 1,
          }),
        );
      } else if (open) {
        out.push(
          ctx.report({
            ruleId: 'SG006',
            severity: 'warning',
            message: `Policy "${p.name}" allows ${p.command} on ${p.schema}.${p.table} for anon/public with a condition of (true), so RLS does not restrict it.`,
            file: p.file,
            line: p.line,
            column: 1,
          }),
        );
      }
    }
    return out;
  },
};

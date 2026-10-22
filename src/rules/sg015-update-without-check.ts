import type { Finding, Rule } from '../core/types.js';
import { findAuthCalls, maskExprLiterals } from '../sql/sql-utils.js';
import { exposedSchemas } from './helpers.js';

const OWNER_COL = /\b([a-z][a-z0-9_]*_id|user|owner|author|created_by)\b/gi;

export const sg015: Rule = {
  meta: {
    id: 'SG015',
    name: 'UpdatePolicyWithoutWithCheck',
    severity: 'warning',
    layer: 'sql',
    summary: 'UPDATE/ALL policy has USING but no explicit WITH CHECK on an ownership column.',
    incident:
      'Without an explicit WITH CHECK, Postgres reuses USING for the new row. That usually matches intent, but ownership policies are easy to loosen later (for example by adding an OR branch to USING), ' +
      'and then a user can update a row they own and reassign user_id to someone else. An explicit WITH CHECK states the invariant for the new row.',
    badExample: 'create policy "own rows" on public.notes for update using (user_id = (select auth.uid()));',
    goodExample:
      'create policy "own rows" on public.notes for update\n  using (user_id = (select auth.uid()))\n  with check (user_id = (select auth.uid()));',
    fixable: 'none',
    references: ['https://www.postgresql.org/docs/current/sql-createpolicy.html'],
  },
  check(ctx) {
    const out: Finding[] = [];
    const exposed = exposedSchemas(ctx);
    for (const p of ctx.sql.policies) {
      if (!exposed.has(p.schema)) continue;
      if (p.command !== 'UPDATE' && p.command !== 'ALL') continue;
      if (p.using === undefined || p.withCheck !== undefined) continue;
      if (findAuthCalls(p.using).length === 0) continue;
      const table = ctx.sql.tables.get(`${p.schema}.${p.table}`);
      const masked = maskExprLiterals(p.using);
      let col: string | undefined;
      let m: RegExpExecArray | null;
      OWNER_COL.lastIndex = 0;
      while ((m = OWNER_COL.exec(masked))) {
        const c = (m[1] ?? '').toLowerCase();
        if (!table || table.columns.includes(c)) {
          col = c;
          break;
        }
      }
      if (!col) continue;
      out.push(
        ctx.report({
          ruleId: 'SG015',
          message: `Policy "${p.name}" on ${p.schema}.${p.table} allows ${p.command} with USING but no explicit WITH CHECK; add one so ownership column "${col}" cannot be reassigned.`,
          file: p.file,
          line: p.line,
          column: 1,
        }),
      );
    }
    return out;
  },
};

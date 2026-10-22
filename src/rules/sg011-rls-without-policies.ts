import type { Finding, Rule } from '../core/types.js';
import { exposedSchemas, isIgnoredTable, isInternalTableName } from './helpers.js';

export const sg011: Rule = {
  meta: {
    id: 'SG011',
    name: 'RlsEnabledWithoutPolicies',
    severity: 'info',
    layer: 'sql',
    summary: 'RLS is enabled but the table has no policies, so every client request is denied.',
    incident:
      'With RLS on and zero policies the table is locked for anon and authenticated roles. That is safe, but often an unfinished migration: the app silently gets empty results or permission errors.',
    badExample: 'alter table public.notes enable row level security;\n-- no create policy statements',
    goodExample:
      'alter table public.notes enable row level security;\ncreate policy "own notes" on public.notes using (user_id = (select auth.uid()));',
    fixable: 'none',
    references: ['https://supabase.com/docs/guides/database/postgres/row-level-security'],
  },
  check(ctx) {
    const out: Finding[] = [];
    const exposed = exposedSchemas(ctx);
    for (const t of ctx.sql.tables.values()) {
      if (!t.rlsEnabled || !exposed.has(t.schema)) continue;
      if (isIgnoredTable(ctx, t) || isInternalTableName(t.name)) continue;
      if (ctx.sql.policies.some((p) => p.schema === t.schema && p.table === t.name)) continue;
      out.push(
        ctx.report({
          ruleId: 'SG011',
          message: `Table ${t.schema}.${t.name} has RLS enabled but no policies, so all client access is denied (fine if intentional).`,
          file: t.file,
          line: t.line,
          column: 1,
        }),
      );
    }
    return out;
  },
};

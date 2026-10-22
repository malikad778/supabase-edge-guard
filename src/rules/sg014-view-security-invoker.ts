import type { Finding, Rule } from '../core/types.js';
import { parseQName } from '../sql/sql-utils.js';
import { exposedSchemas, newMigration, qualified } from './helpers.js';

export const sg014: Rule = {
  meta: {
    id: 'SG014',
    name: 'ViewBypassesRls',
    severity: 'warning',
    layer: 'sql',
    summary: 'View over an RLS-protected table is not security_invoker, so it bypasses the table policies.',
    incident:
      'Views run with the privileges of their owner (usually postgres), which bypasses RLS on the underlying tables. Exposing such a view through the API leaks rows the policies were meant to hide. ' +
      "Postgres 15 added WITH (security_invoker = true) to make the view respect the caller's RLS.",
    badExample: 'create view public.my_orders as select * from public.orders;',
    goodExample:
      'create view public.my_orders with (security_invoker = true) as select * from public.orders;',
    fixable: 'unsafe',
    references: [
      'https://supabase.com/docs/guides/database/postgres/row-level-security#views',
      'https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    const exposed = exposedSchemas(ctx);
    for (const v of ctx.sql.views) {
      if (v.securityInvoker || !exposed.has(v.schema)) continue;
      const hit = (v.referencedTables ?? [])
        .map((r) => parseQName(r))
        .map((q) => ctx.sql.tables.get(`${q.schema}.${q.name}`))
        .find((t) => t?.rlsEnabled);
      if (!hit) continue;
      const f = ctx.report({
        ruleId: 'SG014',
        message: `View ${v.schema}.${v.name} reads RLS-protected table ${hit.schema}.${hit.name} without security_invoker, so it bypasses that table's policies.`,
        file: v.file,
        line: v.line,
        column: 1,
        related: [{ file: hit.file, line: hit.line, note: `${hit.schema}.${hit.name} has RLS enabled` }],
      });
      f.fix = {
        description: `Set security_invoker = true on ${v.schema}.${v.name} (requires Postgres 15+; the view will then enforce the caller's RLS and may return fewer rows).`,
        safe: false,
        edits: [],
        newFiles: [
          {
            file: newMigration(ctx, `sg014_${v.name}`),
            content: `alter view ${qualified(v.schema, v.name)} set (security_invoker = true);\n`,
          },
        ],
      };
      out.push(f);
    }
    return out;
  },
};

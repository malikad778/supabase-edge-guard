import type { Finding, Rule } from '../core/types.js';
import { exposedSchemas, isIgnoredTable, isInternalTableName, newMigration, qualified } from './helpers.js';

export const sg010: Rule = {
  meta: {
    id: 'SG010',
    name: 'TableWithoutRls',
    severity: 'error',
    layer: 'sql',
    summary: 'Table in an exposed schema never has ROW LEVEL SECURITY enabled.',
    incident:
      'Every table in the public schema is reachable through the auto-generated REST API with the anon key. Without RLS the table is fully readable and writable by anyone who knows your project URL. ' +
      'Forgetting ENABLE ROW LEVEL SECURITY on a new table is the single most common Supabase data leak.',
    badExample: 'create table public.orders (id uuid primary key, user_id uuid, total numeric);',
    goodExample:
      'create table public.orders (id uuid primary key, user_id uuid, total numeric);\nalter table public.orders enable row level security;\ncreate policy "own orders" on public.orders using (user_id = (select auth.uid()));',
    fixable: 'safe',
    references: [
      'https://supabase.com/docs/guides/database/postgres/row-level-security',
      'https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    const exposed = exposedSchemas(ctx);
    for (const t of ctx.sql.tables.values()) {
      if (!exposed.has(t.schema) || t.rlsEnabled) continue;
      if (isIgnoredTable(ctx, t) || isInternalTableName(t.name)) continue;
      const full = qualified(t.schema, t.name);
      const f = ctx.report({
        ruleId: 'SG010',
        message: `Table ${t.schema}.${t.name} has no Row Level Security, so anyone with the anon key can read and write every row through the REST API.`,
        file: t.file,
        line: t.line,
        column: 1,
      });
      f.fix = {
        description: `Add a migration that enables RLS on ${t.schema}.${t.name} (add policies afterwards so your app can still access it).`,
        safe: true,
        edits: [],
        newFiles: [
          {
            file: newMigration(ctx, `sg010_enable_rls_${t.name}`),
            content: `alter table ${full} enable row level security;\n`,
          },
        ],
      };
      out.push(f);
    }
    return out;
  },
};

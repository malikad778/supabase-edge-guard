import type { Finding, PolicyInfo, Rule, TableInfo } from '../core/types.js';
import { maskExprLiterals } from '../sql/sql-utils.js';
import { exposedSchemas, isIgnoredTable, newMigration, qualified } from './helpers.js';

function policyColumns(p: PolicyInfo): string[] {
  const cols = new Set<string>();
  for (const expr of [p.using, p.withCheck]) {
    if (!expr) continue;
    const m = maskExprLiterals(expr).replace(/\(\s*select\s+(auth\s*\.\s*uid\s*\(\s*\))\s*\)/gi, '$1');
    const col = '(?:[a-z_][a-z0-9_]*\\.)?([a-z_][a-z0-9_]*)';
    const a = new RegExp(`${col}\\s*=\\s*auth\\s*\\.\\s*uid\\s*\\(\\s*\\)`, 'gi');
    const b = new RegExp(`auth\\s*\\.\\s*uid\\s*\\(\\s*\\)\\s*=\\s*${col}`, 'gi');
    for (const re of [a, b]) {
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(m))) if (mm[1]) cols.add(mm[1].toLowerCase());
    }
  }
  return [...cols];
}

export const sg007: Rule = {
  meta: {
    id: 'SG007',
    name: 'MissingIndexOnPolicyOrFkColumn',
    severity: 'warning',
    layer: 'sql',
    summary: 'Foreign-key column or column used in an RLS policy has no index.',
    incident:
      'RLS predicates such as user_id = auth.uid() run on every query. Without an index on that column Postgres scans the whole table for each request; the same applies to foreign keys on joins and cascading deletes. ' +
      'The slowdown appears only once the table grows.',
    badExample:
      'create table public.notes (id uuid primary key, user_id uuid references auth.users(id));\n-- no index on user_id',
    goodExample: 'create index if not exists idx_notes_user_id on public.notes (user_id);',
    fixable: 'safe',
    references: ['https://supabase.com/docs/guides/database/postgres/row-level-security#add-indexes'],
  },
  check(ctx) {
    const out: Finding[] = [];
    const exposed = exposedSchemas(ctx);

    const isIndexed = (t: TableInfo, col: string): boolean => {
      if (t.primaryKey[0] === col) return true;
      if (t.uniqueCols.some((u) => u[0] === col)) return true;
      return ctx.sql.indexes.some((i) => i.schema === t.schema && i.table === t.name && i.columns[0] === col);
    };

    const wanted = new Map<
      string,
      { table: TableInfo; col: string; file: string; line: number; why: string }
    >();
    for (const t of ctx.sql.tables.values()) {
      if (!exposed.has(t.schema) || isIgnoredTable(ctx, t)) continue;
      for (const fk of t.foreignKeys) {
        const key = `${t.schema}.${t.name}.${fk.column}`;
        if (!wanted.has(key))
          wanted.set(key, { table: t, col: fk.column, file: t.file, line: t.line, why: 'is a foreign key' });
      }
    }
    for (const p of ctx.sql.policies) {
      const t = ctx.sql.tables.get(`${p.schema}.${p.table}`);
      if (!t || !exposed.has(t.schema) || isIgnoredTable(ctx, t)) continue;
      for (const col of policyColumns(p)) {
        if (!t.columns.includes(col)) continue;
        wanted.set(`${t.schema}.${t.name}.${col}`, {
          table: t,
          col,
          file: p.file,
          line: p.line,
          why: `is used by RLS policy "${p.name}"`,
        });
      }
    }

    for (const w of wanted.values()) {
      if (isIndexed(w.table, w.col)) continue;
      const f = ctx.report({
        ruleId: 'SG007',
        message: `Column ${w.table.schema}.${w.table.name}.${w.col} ${w.why} but has no index, which forces sequential scans as the table grows.`,
        file: w.file,
        line: w.line,
        column: 1,
      });
      f.fix = {
        description: `Create an index on ${w.table.schema}.${w.table.name}(${w.col}).`,
        safe: true,
        edits: [],
        newFiles: [
          {
            file: newMigration(ctx, `sg007_index_${w.table.name}_${w.col}`),
            content: `create index if not exists idx_${w.table.name}_${w.col} on ${qualified(w.table.schema, w.table.name)} (${w.col});\n`,
          },
        ],
      };
      out.push(f);
    }
    return out;
  },
};

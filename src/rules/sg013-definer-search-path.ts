import type { Finding, Rule } from '../core/types.js';
import { allFunctions } from '../sql/schema-index.js';
import { newMigration, qualified } from './helpers.js';

export const sg013: Rule = {
  meta: {
    id: 'SG013',
    name: 'SecurityDefinerWithoutSearchPath',
    severity: 'warning',
    layer: 'sql',
    summary: 'SECURITY DEFINER function without SET search_path.',
    incident:
      "A SECURITY DEFINER function resolves unqualified names using the caller's search_path. An attacker can create a same-named object in a schema they control and have the function run it with owner privileges (CVE-2018-1058 style). " +
      'Pin search_path on every definer function.',
    badExample:
      'create function public.bump() returns void language sql security definer as $$ update counters set n = n + 1 $$;',
    goodExample:
      "create function public.bump() returns void language sql security definer set search_path = '' as $$ update public.counters set n = n + 1 $$;",
    fixable: 'unsafe',
    references: [
      'https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker',
      'https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const fn of allFunctions(ctx.sql)) {
      if (!fn.securityDefiner || fn.searchPathSet) continue;
      const sig = `${qualified(fn.schema, fn.name)}(${fn.argTypes.join(', ')})`;
      const f = ctx.report({
        ruleId: 'SG013',
        message: `SECURITY DEFINER function ${fn.schema}.${fn.name} does not pin search_path, so a hostile schema earlier in the path can hijack it.`,
        file: fn.file,
        line: fn.line,
        column: 1,
      });
      f.fix = {
        description: `Pin search_path on ${sig}. Unsafe: the body must use schema-qualified names (public.table) or it will fail.`,
        safe: false,
        edits: [],
        newFiles: [
          {
            file: newMigration(ctx, `sg013_${fn.name}`),
            content: `alter function ${sig} set search_path = '';\n`,
          },
        ],
      };
      out.push(f);
    }
    return out;
  },
};

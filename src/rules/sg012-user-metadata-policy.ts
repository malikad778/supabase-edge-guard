import type { Finding, Rule } from '../core/types.js';
import { maskComments } from '../sql/tokenizer.js';

const META_RE = /\b(?:user_metadata|raw_user_meta_data)\b/;

export const sg012: Rule = {
  meta: {
    id: 'SG012',
    name: 'PolicyTrustsUserMetadata',
    severity: 'error',
    layer: 'sql',
    summary: 'RLS policy reads user_metadata / raw_user_meta_data, which users can edit themselves.',
    incident:
      "user_metadata is writable by the signed-in user through auth.updateUser(). A policy such as (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' lets any user make themselves admin. " +
      'Authorization data belongs in app_metadata or a table only the server can write.',
    badExample:
      "create policy \"admins\" on public.secrets using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');",
    goodExample:
      "create policy \"admins\" on public.secrets using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');",
    fixable: 'none',
    references: [
      'https://supabase.com/docs/guides/database/postgres/row-level-security#use-security-definer-functions',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const p of ctx.sql.policies) {
      for (const expr of [p.using, p.withCheck]) {
        if (expr === undefined || !META_RE.test(maskComments(expr))) continue;
        out.push(
          ctx.report({
            ruleId: 'SG012',
            message: `Policy "${p.name}" on ${p.schema}.${p.table} trusts user_metadata, which every user can modify; use app_metadata or a server-managed table instead.`,
            file: p.file,
            line: p.line,
            column: 1,
          }),
        );
        break;
      }
    }
    return out;
  },
};

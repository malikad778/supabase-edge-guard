import type { Finding, FunctionInfo, ProjectContext, Rule } from '../core/types.js';
import { grantAppliesToFunction } from '../sql/schema-index.js';
import { newMigration, qualified } from './helpers.js';

const UID_LINE = /\b(if|where|raise|and|or|when|exists|case|assert)\b|[=<>!]/i;

function bodyChecksAuthUid(body: string): boolean {
  const re = /\bauth\s*\.\s*uid\s*\(\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const ls = body.lastIndexOf('\n', m.index) + 1;
    let le = body.indexOf('\n', m.index);
    if (le === -1) le = body.length;
    if (UID_LINE.test(body.slice(ls, le))) return true;
  }
  return false;
}

/** Simulate EXECUTE privileges for PUBLIC/anon on one function from the GRANT/REVOKE history. */
export function anonCanExecute(ctx: ProjectContext, fn: FunctionInfo): boolean {
  let pub = true;
  let anon = true;
  const applicable = ctx.sql.grants
    .filter((g) => /\b(execute|all)\b/i.test(g.privilege) && grantAppliesToFunction(g, fn))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const g of applicable) {
    const value = g.kind === 'GRANT';
    for (const r of g.roles) {
      if (r === 'public') pub = value;
      else if (r === 'anon') anon = value;
    }
  }
  return pub || anon;
}

export const sg004: Rule = {
  meta: {
    id: 'SG004',
    name: 'SecurityDefinerRpcExposed',
    severity: 'error',
    layer: 'cross',
    summary:
      'supabase.rpc() calls a SECURITY DEFINER function that is callable by anon/public and does not check auth.uid().',
    incident:
      "SECURITY DEFINER functions run with the owner's privileges and therefore bypass RLS. PostgREST exposes every function in an exposed schema as /rpc/<name>, " +
      'and Postgres grants EXECUTE to PUBLIC by default. Unless the body checks auth.uid() or EXECUTE is revoked, anyone with the anon key can call it.',
    badExample:
      "create function public.delete_account(p_id uuid) returns void\nlanguage sql security definer as $$ delete from profiles where id = p_id $$;\n-- app: supabase.rpc('delete_account', { p_id })",
    goodExample:
      'revoke execute on function public.delete_account(uuid) from public, anon;\ngrant execute on function public.delete_account(uuid) to authenticated;\n-- and check auth.uid() = p_id inside the body',
    fixable: 'safe',
    references: [
      'https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker',
      'https://supabase.com/docs/guides/api/securing-your-api',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const call of ctx.ts.calls) {
      if (call.kind !== 'rpc' || !call.rpcName) continue;
      const fn =
        ctx.sql.functions.get(`public.${call.rpcName.toLowerCase()}`) ??
        ctx.sql.functions.get(`public.${call.rpcName}`);
      if (!fn) continue;
      const candidates = [fn, ...(fn.overloads ?? [])];
      for (const def of candidates) {
        if (!def.securityDefiner) continue;
        if (bodyChecksAuthUid(def.body)) continue;
        if (!anonCanExecute(ctx, def)) continue;
        const sig = `${qualified(def.schema, def.name)}(${def.argTypes.join(', ')})`;
        const f = ctx.report({
          ruleId: 'SG004',
          message: `supabase.rpc('${call.rpcName}') targets a SECURITY DEFINER function that anon/public can execute and that never checks auth.uid(), so it bypasses RLS for everyone.`,
          file: call.file,
          line: call.line,
          column: call.column,
          related: [
            { file: def.file, line: def.line, note: `SECURITY DEFINER function ${def.schema}.${def.name}` },
          ],
        });
        f.fix = {
          description: `Revoke EXECUTE on ${sig} from PUBLIC and anon.`,
          safe: true,
          edits: [],
          newFiles: [
            {
              file: newMigration(ctx, `sg004_revoke_${def.name}`),
              content: `revoke execute on function ${sig} from public, anon;\n`,
            },
          ],
        };
        out.push(f);
      }
    }
    return out;
  },
};

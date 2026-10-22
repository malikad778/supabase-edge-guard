import { afterAll, describe, expect, it } from 'vitest';
import { cleanupProjects, only, scanFiles } from '../helpers.js';

afterAll(cleanupProjects);

const mig = (sql: string, extra: Record<string, string> = {}) =>
  scanFiles({ 'supabase/migrations/20240101000000_a.sql': sql, ...extra });

describe('SG010 table without RLS', () => {
  it('flags tables without RLS and offers a migration fix', () => {
    const f = only(mig('create table public.orders (id int);').findings, 'SG010');
    expect(f).toHaveLength(1);
    expect(f[0]?.line).toBe(1);
    expect(f[0]?.fix?.newFiles?.[0]?.content).toBe('alter table public.orders enable row level security;\n');
    expect(f[0]?.fix?.newFiles?.[0]?.file).toMatch(
      /^supabase\/migrations\/\d{14}_sg010_enable_rls_orders\.sql$/,
    );
  });

  it('accepts RLS enabled in the same or a later migration', () => {
    expect(
      only(mig('create table t (id int); alter table t enable row level security;').findings, 'SG010'),
    ).toHaveLength(0);
    const r = scanFiles({
      'supabase/migrations/1.sql': 'create table t (id int);',
      'supabase/migrations/2.sql': 'alter table public.t enable row level security;',
    });
    expect(only(r.findings, 'SG010')).toHaveLength(0);
  });

  it('respects exposed schemas, ignoreTables, internal names and temp tables', () => {
    expect(only(mig('create table private.t (id int);').findings, 'SG010')).toHaveLength(0);
    expect(
      only(mig('create table _prisma (id int); create temp table x (id int);').findings, 'SG010'),
    ).toHaveLength(0);
    const cfg = { 'supabase-edge-guard.config.json': JSON.stringify({ ignoreTables: ['public.lookup'] }) };
    expect(only(mig('create table public.lookup (id int);', cfg).findings, 'SG010')).toHaveLength(0);
    const toml = { 'supabase/config.toml': '[api]\nschemas = ["public", "app"]\n' };
    expect(only(mig('create table app.t (id int);', toml).findings, 'SG010')).toHaveLength(1);
  });

  it('new migration sorts after existing ones', () => {
    const f = only(mig('create table t (id int);').findings, 'SG010')[0];
    const name = f?.fix?.newFiles?.[0]?.file.split('/').pop() ?? '';
    expect(name > '20240101000000_a.sql').toBe(true);
  });
});

describe('SG011 / SG012 / SG013 / SG014 / SG015', () => {
  it('SG011 flags RLS without policies', () => {
    const base = 'create table t (id int); alter table t enable row level security;';
    expect(only(mig(base).findings, 'SG011')).toHaveLength(1);
    expect(only(mig(`${base} create policy p on t using (true);`).findings, 'SG011')).toHaveLength(0);
  });

  it('SG012 flags user_metadata / raw_user_meta_data but not app_metadata or comments', () => {
    const p = (e: string) =>
      `create table t (id int); alter table t enable row level security; create policy p on t using (${e});`;
    expect(
      only(mig(p("(select auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'")).findings, 'SG012'),
    ).toHaveLength(1);
    expect(
      only(mig(p('(select raw_user_meta_data from auth.users) is not null')).findings, 'SG012'),
    ).toHaveLength(1);
    expect(
      only(mig(p("(select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'")).findings, 'SG012'),
    ).toHaveLength(0);
    expect(only(mig(p('true /* user_metadata */')).findings, 'SG012')).toHaveLength(0);
  });

  it('SG013 flags definer functions without search_path and clears after ALTER', () => {
    const fn = 'create function f() returns int language sql security definer as $$ select 1 $$;';
    expect(only(mig(fn).findings, 'SG013')).toHaveLength(1);
    expect(only(mig(`${fn} alter function f() set search_path = '';`).findings, 'SG013')).toHaveLength(0);
    expect(
      only(
        mig(
          'create function f() returns int language sql security definer set search_path = public as $$ select 1 $$;',
        ).findings,
        'SG013',
      ),
    ).toHaveLength(0);
    expect(
      only(mig('create function f() returns int language sql as $$ select 1 $$;').findings, 'SG013'),
    ).toHaveLength(0);
    expect(only(mig(fn).findings, 'SG013')[0]?.fix?.safe).toBe(false);
  });

  it('SG014 flags views over RLS tables without security_invoker', () => {
    const t = 'create table t (id int); alter table t enable row level security;';
    expect(only(mig(`${t} create view v as select * from t;`).findings, 'SG014')).toHaveLength(1);
    expect(
      only(mig(`${t} create view v with (security_invoker = true) as select * from t;`).findings, 'SG014'),
    ).toHaveLength(0);
    expect(
      only(mig('create table t (id int); create view v as select * from t;').findings, 'SG014'),
    ).toHaveLength(0);
    expect(
      only(
        mig(`${t} create view v as select * from t; alter view v set (security_invoker = on);`).findings,
        'SG014',
      ),
    ).toHaveLength(0);
  });

  it('SG015 flags UPDATE/ALL policies with USING but no WITH CHECK on owner columns', () => {
    const t = 'create table t (id int, user_id uuid); alter table t enable row level security;';
    expect(
      only(
        mig(`${t} create policy p on t for update using (user_id = (select auth.uid()));`).findings,
        'SG015',
      ),
    ).toHaveLength(1);
    expect(
      only(mig(`${t} create policy p on t using (user_id = (select auth.uid()));`).findings, 'SG015'),
    ).toHaveLength(1);
    expect(
      only(
        mig(
          `${t} create policy p on t for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));`,
        ).findings,
        'SG015',
      ),
    ).toHaveLength(0);
    expect(
      only(
        mig(`${t} create policy p on t for select using (user_id = (select auth.uid()));`).findings,
        'SG015',
      ),
    ).toHaveLength(0);
    expect(only(mig(`${t} create policy p on t for update using (true);`).findings, 'SG015')).toHaveLength(0);
  });
});

describe('SG005 initplan', () => {
  const p = (e: string) =>
    `create table t (id int, user_id uuid); alter table t enable row level security; create policy p on t using (${e});`;

  it('flags each unwrapped call with a precise edit', () => {
    const sql = p("user_id = auth.uid() or auth.role() = 'x'");
    const f = only(mig(sql).findings, 'SG005');
    expect(f).toHaveLength(2);
    const edit = f[0]?.fix?.edits[0];
    expect(sql.slice(edit?.start, edit?.end)).toBe('auth.uid()');
    expect(edit?.text).toBe('(select auth.uid())');
  });

  it('ignores wrapped calls, string literals and comments; checks WITH CHECK too', () => {
    expect(only(mig(p('user_id = (select auth.uid())')).findings, 'SG005')).toHaveLength(0);
    expect(only(mig(p("'auth.uid()' = 'x'")).findings, 'SG005')).toHaveLength(0);
    expect(only(mig(p('true /* auth.uid() */')).findings, 'SG005')).toHaveLength(0);
    expect(
      only(
        mig(`${p('true')} create policy q on t for insert with check (user_id = auth.uid());`).findings,
        'SG005',
      ),
    ).toHaveLength(1);
  });

  it('reports the exact line of the call in multi-line policies', () => {
    const sql = 'create table t (id int);\ncreate policy p on t\n  using (\n    id = auth.uid()\n  );';
    expect(only(mig(sql).findings, 'SG005')[0]?.line).toBe(4);
  });
});

describe('SG006 permissive policies', () => {
  const t = 'create table public.t (id int); alter table t enable row level security;';
  it('flags auth.uid() IS NULL OR in both forms', () => {
    expect(
      only(mig(`${t} create policy p on t using (auth.uid() is null or id = 1);`).findings, 'SG006'),
    ).toHaveLength(1);
    expect(
      only(mig(`${t} create policy p on t using (id = 1 or (select auth.uid()) is null);`).findings, 'SG006'),
    ).toHaveLength(1);
    expect(
      only(mig(`${t} create policy p on t using (auth.uid() is not null);`).findings, 'SG006'),
    ).toHaveLength(0);
  });

  it('USING (true): warning for anon writes, info for selects, silent for authenticated-only', () => {
    const w = only(mig(`${t} create policy p on t for update to anon using (true);`).findings, 'SG006');
    expect(w.map((f) => f.severity)).toEqual(['warning']);
    const all = only(mig(`${t} create policy p on t for all using (true);`).findings, 'SG006');
    expect(all.map((f) => f.severity)).toEqual(['warning']);
    const s = only(mig(`${t} create policy p on t for select using (true);`).findings, 'SG006');
    expect(s.map((f) => f.severity)).toEqual(['info']);
    expect(
      only(mig(`${t} create policy p on t for update to authenticated using (true);`).findings, 'SG006'),
    ).toHaveLength(0);
  });
});

describe('SG007 indexes', () => {
  it('flags FK and policy columns without indexes and fixes with CREATE INDEX', () => {
    const sql =
      'create table public.n (id int primary key, user_id uuid references auth.users(id)); alter table n enable row level security; create policy p on n using (user_id = (select auth.uid()));';
    const f = only(mig(sql).findings, 'SG007');
    expect(f).toHaveLength(1);
    expect(f[0]?.fix?.newFiles?.[0]?.content).toBe(
      'create index if not exists idx_n_user_id on public.n (user_id);\n',
    );
  });

  it('accepts leading-column indexes, primary keys and unique constraints', () => {
    const base =
      'create table n (id uuid primary key references auth.users(id), a uuid references x(id), b uuid unique references x(id));';
    expect(only(mig(`${base} create index on n (a, b);`).findings, 'SG007')).toHaveLength(0);
    expect(only(mig(base).findings, 'SG007').map((f) => f.message)).toEqual([expect.stringContaining('.a ')]);
    expect(only(mig(`${base} create index on n (b, a);`).findings, 'SG007')).toHaveLength(1);
  });

  it('works for ALTER TABLE ADD COLUMN + policy', () => {
    const sql =
      'create table n (id int); alter table n add column owner_id uuid; alter table n enable row level security; create policy p on n using (owner_id = auth.uid());';
    expect(only(mig(sql).findings, 'SG007')).toHaveLength(1);
  });
});

describe('SG016 verify_jwt and SG017 env secrets', () => {
  const toml = '[functions.hook]\nverify_jwt = false\n\n[functions.ok]\nverify_jwt = true\n';
  it('SG016 flags unauthenticated functions and accepts guards', () => {
    const bad = scanFiles({
      'supabase/config.toml': toml,
      'supabase/functions/hook/index.ts': 'Deno.serve(() => new Response("hi"));',
    });
    const f = only(bad.findings, 'SG016');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ file: 'supabase/config.toml', line: 2 });
    for (const guard of [
      "req.headers.get('x-webhook-secret')",
      'stripe.webhooks.constructEvent(a, b, c)',
      'await supabase.auth.getUser()',
    ]) {
      const ok = scanFiles({
        'supabase/config.toml': toml,
        'supabase/functions/hook/index.ts': `Deno.serve(async (req) => { ${guard}; return new Response('ok'); });`,
      });
      expect(only(ok.findings, 'SG016')).toHaveLength(0);
    }
  });

  it('SG016 handles quoted function names and invalid TOML', () => {
    const r = scanFiles({
      'supabase/config.toml': '[functions."my-fn"]\nverify_jwt = false\n',
      'supabase/functions/my-fn/index.ts': 'Deno.serve(() => new Response("x"));',
    });
    expect(only(r.findings, 'SG016')).toHaveLength(1);
    const bad = scanFiles({ 'supabase/config.toml': '[functions\nverify_jwt = ' });
    expect(only(bad.findings, 'SG000')[0]?.ruleName).toBe('ParseError');
  });

  it('SG017 flags public-prefixed secrets in env files and code', () => {
    const r = scanFiles({
      '.gitignore': '.env*\n',
      '.env':
        'NEXT_PUBLIC_SUPABASE_URL=a\nNEXT_PUBLIC_STRIPE_SECRET_KEY=b\nVITE_OPENAI_API_KEY=c\nSUPABASE_SERVICE_ROLE_KEY=d\n',
      'src/a.ts':
        'export const k = import.meta.env.VITE_SERVICE_ROLE_KEY; export const ok = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;',
    });
    const f = only(r.findings, 'SG017');
    expect(f.map((x) => x.file + ':' + x.line).sort()).toEqual(['.env:3', '.env:2', 'src/a.ts:1'].sort());
  });

  it('SG017 warns when .env / .env.local are not git-ignored', () => {
    const r = scanFiles({ '.env.local': 'A=1\n', '.gitignore': 'node_modules\n' });
    expect(only(r.findings, 'SG017').map((f) => f.severity)).toEqual(['warning']);
    for (const ignore of ['.env.local', '.env*', '*.local', '.env*.local', '/.env.local']) {
      const ok = scanFiles({ '.env.local': 'A=1\n', '.gitignore': `${ignore}\n` });
      expect(only(ok.findings, 'SG017')).toHaveLength(0);
    }
    expect(
      only(scanFiles({ '.env.local': 'A=1\n', '.gitignore': '.env.local\n!.env.local\n' }).findings, 'SG017'),
    ).toHaveLength(1);
    expect(only(scanFiles({ '.env.example': 'NEXT_PUBLIC_SECRET=x\n' }).findings, 'SG017')).toHaveLength(0);
  });
});

describe('SG017 false-positive guards', () => {
  it('does not treat public ids/orgs as secrets, but flags provider keys', () => {
    const r = scanFiles({
      '.gitignore': '.env\n',
      '.env':
        'NEXT_PUBLIC_OPENAI_ORGANIZATION_ID=org\nNEXT_PUBLIC_OPENAI_API_KEY=k\nNEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk\n',
    });
    expect(only(r.findings, 'SG017').map((f) => f.line)).toEqual([2]);
  });

  it('skips vendored bundles and huge files', () => {
    const big = `export const x = ${JSON.stringify('a'.repeat(1_100_000))}; supabase.auth.getSession();`;
    const r = scanFiles({
      'package.json': '{"dependencies":{"next":"14"}}',
      '.yarn/releases/y.cjs': big,
      'app/api/x/route.ts': big,
    });
    expect(r.stats.tsFiles).toBe(0);
  });
});

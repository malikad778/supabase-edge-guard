import { afterAll, describe, expect, it } from 'vitest';
import { cleanupProjects, NEXT_PKG, only, scanFiles, TANSTACK_PKG, VITE_PKG } from '../helpers.js';

afterAll(cleanupProjects);

const next = (files: Record<string, string>) => scanFiles({ 'package.json': NEXT_PKG, ...files });

describe('SG001 getSession', () => {
  const action = (body: string) =>
    next({
      'app/actions.ts': `'use server';\nimport { createClient } from '@supabase/supabase-js';\nconst sb = () => createClient('u','k');\nexport async function a() {\n  const supabase = sb();\n${body}\n}`,
    });

  it('flags server getSession and offers a mechanical fix', () => {
    const r = action(
      "  const { data: { session } } = await supabase.auth.getSession();\n  if (!session) throw new Error('x');\n  return session.user.id;",
    );
    const f = only(r.findings, 'SG001');
    expect(f).toHaveLength(1);
    expect(f[0]?.fix?.safe).toBe(true);
    expect(f[0]?.fix?.edits.map((e) => e.text).sort()).toEqual(['getUser', 'user', 'user', 'user']);
  });

  it('handles extra destructured fields', () => {
    const r = action(
      '  const { data: { session }, error } = await supabase.auth.getSession();\n  return session?.user?.id ?? error;',
    );
    expect(only(r.findings, 'SG001')[0]?.fix).toBeDefined();
  });

  it('handles an aliased session binding', () => {
    const r = action(
      '  const { data: { session: s } } = await supabase.auth.getSession();\n  return s?.user.id;',
    );
    const fix = only(r.findings, 'SG001')[0]?.fix;
    expect(fix?.edits.map((e) => e.text).sort()).toEqual(['getUser', 's', 'user']);
  });

  it('reports without a fix when session is used non-mechanically', () => {
    const r = action(
      '  const { data: { session } } = await supabase.auth.getSession();\n  return session.access_token;',
    );
    const f = only(r.findings, 'SG001');
    expect(f).toHaveLength(1);
    expect(f[0]?.fix).toBeUndefined();
  });

  it('reports without a fix when result is not destructured', () => {
    const r = action('  const res = await supabase.auth.getSession();\n  return res.data.session?.user.id;');
    expect(only(r.findings, 'SG001')[0]?.fix).toBeUndefined();
  });

  it('does not flag getUser or client components', () => {
    expect(
      only(
        action('  const { data: { user } } = await supabase.auth.getUser();\n  return user;').findings,
        'SG001',
      ),
    ).toHaveLength(0);
    const r = next({
      'app/C.tsx':
        "'use client';\nexport async function f(supabase: any) { const { data: { session } } = await supabase.auth.getSession(); return session; }",
    });
    expect(only(r.findings, 'SG001')).toHaveLength(0);
  });

  it('allows getSession alongside getUser unless session.user is read', () => {
    const ok = action(
      '  const { data: { user } } = await supabase.auth.getUser();\n  const { data: { session } } = await supabase.auth.getSession();\n  return [user, session?.access_token];',
    );
    expect(only(ok.findings, 'SG001')).toHaveLength(0);
    const bad = action(
      '  const { data: { user } } = await supabase.auth.getUser();\n  const { data: { session } } = await supabase.auth.getSession();\n  return [user, session?.user];',
    );
    expect(only(bad.findings, 'SG001')).toHaveLength(1);
  });

  it('flags middleware and route handlers', () => {
    const r = next({
      'middleware.ts':
        'export async function middleware(sb: any) { const { data: { session } } = await sb.auth.getSession(); return session; }',
      'app/api/x/route.ts':
        'export async function GET(sb: any) { return (await sb.auth.getSession()).data; }',
    });
    expect(
      only(r.findings, 'SG001')
        .map((f) => f.file)
        .sort(),
    ).toEqual(['app/api/x/route.ts', 'middleware.ts']);
  });

  it('TanStack: only inside createServerFn handlers', () => {
    const r = scanFiles({
      'package.json': TANSTACK_PKG,
      'src/routes/a.tsx': `import { createServerFn } from '@tanstack/react-start';
export const load = createServerFn().handler(async () => { const { data: { session } } = await supabase.auth.getSession(); return session; });
export function Comp() { supabase.auth.getSession(); return null; }`,
    });
    expect(only(r.findings, 'SG001')).toHaveLength(1);
    expect(only(r.findings, 'SG001')[0]?.line).toBe(2);
  });

  it('Lovable: only edge functions, never src/', () => {
    const r = scanFiles({
      'package.json': VITE_PKG,
      'src/a.ts': 'export async function f(supabase: any) { return supabase.auth.getSession(); }',
      'supabase/functions/x/index.ts':
        'Deno.serve(async () => { const r = await supabase.auth.getSession(); return new Response(String(r)); });',
    });
    expect(only(r.findings, 'SG001').map((f) => f.file)).toEqual(['supabase/functions/x/index.ts']);
  });
});

describe('SG002 service_role without auth', () => {
  const admin =
    "import { createClient } from '@supabase/supabase-js';\nconst admin = createClient(process.env.URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);\n";

  it('flags tainted ids in route handlers', () => {
    const r = next({
      'app/api/x/route.ts': `${admin}export async function POST(req: Request) {\n  const { id } = await req.json();\n  await admin.from('t').delete().eq('id', id);\n  return new Response('ok');\n}`,
    });
    const f = only(r.findings, 'SG002');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("'id'");
  });

  it('flags server-action parameters and flows through intermediate variables', () => {
    const r = next({
      'app/a.ts': `'use server';\n${admin}export async function del(raw: string) {\n  const id = Number(raw);\n  const q = { id };\n  await admin.from('t').delete().match(q);\n}`,
    });
    expect(only(r.findings, 'SG002')).toHaveLength(1);
  });

  it('flags a missing auth check even without tainted input', () => {
    const r = next({
      'app/api/x/route.ts': `${admin}export async function GET() {\n  const { data } = await admin.from('t').select('*');\n  return Response.json(data);\n}`,
    });
    expect(only(r.findings, 'SG002')[0]?.message).toContain('no authenticated user is verified');
  });

  it('accepts a prior getUser with a trusted filter', () => {
    const r = next({
      'app/a.ts': `'use server';\n${admin}export async function upd(supabase: any, name: string) {\n  const { data: { user } } = await supabase.auth.getUser();\n  if (!user) throw new Error('no');\n  await admin.from('profiles').update({ name }).eq('id', user.id);\n}`,
    });
    expect(only(r.findings, 'SG002')).toHaveLength(0);
  });

  it('flags an owner column taken from the request even after getUser', () => {
    const r = next({
      'app/a.ts': `'use server';\n${admin}export async function ins(supabase: any, ownerId: string) {\n  const { data: { user } } = await supabase.auth.getUser();\n  await admin.from('docs').insert({ user_id: ownerId, by: user?.id });\n}`,
    });
    expect(only(r.findings, 'SG002')).toHaveLength(1);
  });

  it('skips webhooks, scripts, client code and non-admin clients', () => {
    expect(
      only(
        next({
          'app/api/w/route.ts': `${admin}export async function POST(req: Request) {\n  const ev = stripe.webhooks.constructEvent(await req.text(), sig, secret);\n  await admin.from('t').update({ a: 1 }).eq('id', ev.id);\n}`,
        }).findings,
        'SG002',
      ),
    ).toHaveLength(0);
    expect(
      only(
        next({
          'scripts/seed.ts': `${admin}export async function run() { await admin.from('t').delete().eq('id', 1); }`,
        }).findings,
        'SG002',
      ),
    ).toHaveLength(0);
    expect(
      only(
        next({
          'app/api/x/route.ts':
            "import { createClient } from '@supabase/supabase-js';\nconst sb = createClient('u','anon');\nexport async function POST(req: Request) { const { id } = await req.json(); await sb.from('t').delete().eq('id', id); }",
        }).findings,
        'SG002',
      ),
    ).toHaveLength(0);
  });

  it('tracks admin clients per scope and imported admin names', () => {
    const r = next({
      'app/api/x/route.ts': `import { supabaseAdmin } from '@/lib/admin';\nexport async function POST(req: Request) {\n  const body = await req.json();\n  await supabaseAdmin.from('t').update({ a: 1 }).eq('id', body.id);\n}`,
    });
    expect(only(r.findings, 'SG002')).toHaveLength(1);
  });
});

describe('SG003 service_role in client bundle', () => {
  it('flags a client component using the key', () => {
    const r = next({
      'app/C.tsx':
        "'use client';\nconst k = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;\nexport const x = k;",
    });
    expect(only(r.findings, 'SG003')).toHaveLength(1);
  });

  it('flags transitive imports with the chain in the message', () => {
    const r = next({
      'app/C.tsx': "'use client';\nimport { a } from '../lib/a';\nexport const x = a;",
      'lib/a.ts': "import { b } from './b';\nexport const a = b;",
      'lib/b.ts': 'export const b = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    });
    const f = only(r.findings, 'SG003');
    expect(f).toHaveLength(1);
    expect(f[0]?.file).toBe('lib/b.ts');
    expect(f[0]?.message).toContain('app/C.tsx → lib/a.ts → lib/b.ts');
  });

  it('does not flag server-only usage, server actions imported by clients, or type-only imports', () => {
    const r = next({
      'app/C.tsx':
        "'use client';\nimport { act } from './actions';\nimport type { T } from '../lib/t';\nexport const x = act;",
      'app/actions.ts': "'use server';\nexport const act = process.env.SUPABASE_SERVICE_ROLE_KEY;",
      'lib/t.ts': 'export type T = string; export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      'app/api/x/route.ts': 'export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    });
    expect(only(r.findings, 'SG003')).toHaveLength(0);
  });

  it('Lovable: every src module is client', () => {
    const r = scanFiles({
      'package.json': VITE_PKG,
      'src/a.ts': 'export const k = import.meta.env.VITE_SERVICE_ROLE_KEY;',
    });
    expect(only(r.findings, 'SG003')).toHaveLength(1);
  });
});

describe('SG004 / SG008 / SG009 / SG018', () => {
  const rpcSql = (extra = '') =>
    `create function public.wipe(p_id uuid) returns void language sql security definer set search_path = '' as $$ delete from public.t where id = p_id $$;\n${extra}`;
  const rpcCall = "export async function f(supabase: any) { await supabase.rpc('wipe', { p_id: 1 }); }";

  it('SG004 flags exposed definer RPCs and offers a revoke fix', () => {
    const r = next({ 'supabase/migrations/1.sql': rpcSql(), 'app/a.ts': rpcCall });
    const f = only(r.findings, 'SG004');
    expect(f).toHaveLength(1);
    expect(f[0]?.fix?.newFiles?.[0]?.content).toContain(
      'revoke execute on function public.wipe(uuid) from public, anon',
    );
    expect(f[0]?.related?.[0]?.file).toBe('supabase/migrations/1.sql');
  });

  it('SG004 accepts auth.uid() checks, invoker functions and revokes', () => {
    const guarded =
      "create function public.wipe(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$ begin if auth.uid() <> p_id then raise exception 'no'; end if; end $$;";
    expect(
      only(next({ 'supabase/migrations/1.sql': guarded, 'app/a.ts': rpcCall }).findings, 'SG004'),
    ).toHaveLength(0);
    const invoker = 'create function public.wipe(p_id uuid) returns void language sql as $$ select 1 $$;';
    expect(
      only(next({ 'supabase/migrations/1.sql': invoker, 'app/a.ts': rpcCall }).findings, 'SG004'),
    ).toHaveLength(0);
    const revoked = rpcSql('revoke execute on function public.wipe(uuid) from public, anon;');
    expect(
      only(next({ 'supabase/migrations/1.sql': revoked, 'app/a.ts': rpcCall }).findings, 'SG004'),
    ).toHaveLength(0);
    const partial = rpcSql('revoke execute on function public.wipe(uuid) from public;');
    expect(
      only(next({ 'supabase/migrations/1.sql': partial, 'app/a.ts': rpcCall }).findings, 'SG004'),
    ).toHaveLength(1);
    const schemaWide = rpcSql('revoke all on all functions in schema public from public, anon;');
    expect(
      only(next({ 'supabase/migrations/1.sql': schemaWide, 'app/a.ts': rpcCall }).findings, 'SG004'),
    ).toHaveLength(0);
  });

  it('SG004 ignores rpc calls to unknown functions and auth.uid() inside comments only', () => {
    expect(
      only(
        next({
          'supabase/migrations/1.sql': rpcSql(),
          'app/a.ts': "export const f = (s: any) => s.rpc('other')",
        }).findings,
        'SG004',
      ),
    ).toHaveLength(0);
    const commentOnly =
      "create function public.wipe(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$ begin -- if auth.uid() <> p_id\n delete from t; end $$;";
    expect(
      only(next({ 'supabase/migrations/1.sql': commentOnly, 'app/a.ts': rpcCall }).findings, 'SG004'),
    ).toHaveLength(1);
  });

  const storagePolicy = (cond: string, roles = 'authenticated') =>
    `create policy "w" on storage.objects for insert to ${roles} with check (${cond});`;
  const upload =
    "'use client';\nexport async function f(supabase: any) { await supabase.storage.from('avatars').upload('a', new Blob()); }";

  it('SG008 flags missing and non-owner storage policies, accepts owner-scoped ones', () => {
    expect(only(next({ 'app/U.tsx': upload }).findings, 'SG008')).toHaveLength(1);
    expect(
      only(
        next({ 'app/U.tsx': upload, 'supabase/migrations/1.sql': storagePolicy("bucket_id = 'avatars'") })
          .findings,
        'SG008',
      ),
    ).toHaveLength(1);
    const owner = storagePolicy(
      "bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text",
    );
    expect(
      only(next({ 'app/U.tsx': upload, 'supabase/migrations/1.sql': owner }).findings, 'SG008'),
    ).toHaveLength(0);
  });

  it('SG008 flags anon write policies on public buckets and ignores server uploads', () => {
    const sql = `insert into storage.buckets (id, name, public) values ('pub','pub',true);\n${storagePolicy("bucket_id = 'pub'", 'anon')}`;
    expect(only(next({ 'supabase/migrations/1.sql': sql }).findings, 'SG008')).toHaveLength(1);
    const server =
      "export async function POST(supabase: any) { await supabase.storage.from('avatars').upload('a', new Blob()); }";
    expect(only(next({ 'app/api/x/route.ts': server }).findings, 'SG008')).toHaveLength(0);
  });

  it('SG009 flags per-request session mutation on a module-scope client', () => {
    const bad =
      "import { createClient } from '@supabase/supabase-js';\nconst sb = createClient('u','k');\nexport async function POST(r: Request) { await sb.auth.setSession(await r.json()); }";
    expect(only(next({ 'app/api/x/route.ts': bad }).findings, 'SG009')).toHaveLength(1);
    const good =
      "import { createClient } from '@supabase/supabase-js';\nexport async function POST(r: Request) { const sb = createClient('u','k'); await sb.auth.setSession(await r.json()); }";
    expect(only(next({ 'app/api/x/route.ts': good }).findings, 'SG009')).toHaveLength(0);
    const client =
      "'use client';\nimport { createClient } from '@supabase/supabase-js';\nconst sb = createClient('u','k');\nexport const f = (t: any) => sb.auth.setSession(t);";
    expect(only(next({ 'app/C.tsx': client }).findings, 'SG009')).toHaveLength(0);
  });

  it('SG018 flags unguarded LLM calls and accepts guards', () => {
    const bad =
      "import { streamText } from 'ai';\nexport async function POST(r: Request) { return streamText({ model: m, prompt: await r.text() }).toDataStreamResponse(); }";
    expect(only(next({ 'app/api/c/route.ts': bad }).findings, 'SG018')).toHaveLength(1);
    expect(
      only(next({ 'app/api/c/route.ts': `export const maxDuration = 30;\n${bad}` }).findings, 'SG018'),
    ).toHaveLength(0);
    expect(
      only(
        next({ 'app/api/c/route.ts': `import { Ratelimit } from '@upstash/ratelimit';\n${bad}` }).findings,
        'SG018',
      ),
    ).toHaveLength(0);
    const raw =
      "export async function POST() { return fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' }); }";
    expect(only(next({ 'app/api/c/route.ts': raw }).findings, 'SG018')).toHaveLength(1);
    const client =
      "'use client';\nimport { generateText } from 'ai';\nexport const f = () => generateText({});";
    expect(only(next({ 'app/C.tsx': client }).findings, 'SG018')).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { allFunctions, buildSchemaIndex } from '../../src/sql/schema-index.js';

const f = (file: string, text: string) => ({ file, text });

describe('buildSchemaIndex', () => {
  it('applies migrations in filename order regardless of input order', () => {
    const idx = buildSchemaIndex([
      f('m/002.sql', 'alter table public.t enable row level security;'),
      f('m/001.sql', 'create table public.t (id int);'),
    ]);
    expect(idx.tables.get('public.t')?.rlsEnabled).toBe(true);
  });

  it('later DISABLE and DROP TABLE are honoured', () => {
    const idx = buildSchemaIndex([
      f(
        '1.sql',
        'create table a (id int); alter table a enable row level security; create policy p on a using (true); create index i on a (id);',
      ),
      f('2.sql', 'alter table a disable row level security;'),
      f('3.sql', 'create table b (id int); drop table a cascade;'),
    ]);
    expect(idx.tables.has('public.a')).toBe(false);
    expect(idx.policies).toHaveLength(0);
    expect(idx.indexes).toHaveLength(0);
    expect(idx.tables.has('public.b')).toBe(true);
  });

  it('DROP POLICY and ALTER POLICY update policies', () => {
    const idx = buildSchemaIndex([
      f(
        '1.sql',
        'create table t (id int); create policy p on t using (a = auth.uid()); create policy q on t using (true);',
      ),
      f('2.sql', 'drop policy q on t; alter policy p on t using (a = (select auth.uid()));'),
    ]);
    expect(idx.policies.map((p) => p.name)).toEqual(['p']);
    expect(idx.policies[0]?.using).toContain('select');
  });

  it('CREATE OR REPLACE replaces; different args create overloads', () => {
    const idx = buildSchemaIndex([
      f('1.sql', 'create function f(a int) returns int language sql as $$ select 1 $$;'),
      f(
        '2.sql',
        'create or replace function f(a int) returns int language sql security definer as $$ select 2 $$;',
      ),
      f('3.sql', 'create function f(a text) returns int language sql as $$ select 3 $$;'),
    ]);
    const all = allFunctions(idx);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.argTypes[0] === 'integer')?.securityDefiner).toBe(true);
  });

  it('ALTER FUNCTION SET search_path clears SG013 state; DROP FUNCTION removes grants', () => {
    const idx = buildSchemaIndex([
      f(
        '1.sql',
        "create function f() returns int language sql security definer as $$ select 1 $$; alter function f() set search_path = '';",
      ),
      f(
        '2.sql',
        'revoke execute on function f() from public; drop function f(); create function f() returns int language sql as $$ select 1 $$;',
      ),
    ]);
    expect(idx.grants).toHaveLength(0);
    expect(allFunctions(idx)[0]?.securityDefiner).toBe(false);
  });

  it('tracks views, buckets and security_invoker changes', () => {
    const idx = buildSchemaIndex([
      f(
        '1.sql',
        "create view v as select * from t; insert into storage.buckets (id, public) values ('x', false); update storage.buckets set public = true where id = 'x';",
      ),
      f('2.sql', 'alter view v set (security_invoker = true);'),
    ]);
    expect(idx.views[0]?.securityInvoker).toBe(true);
    expect(idx.buckets).toEqual([expect.objectContaining({ id: 'x', public: true })]);
  });

  it('does not choke on garbage', () => {
    expect(() => buildSchemaIndex([f('1.sql', "create table (; alter ; 'unterminated")])).not.toThrow();
  });
});

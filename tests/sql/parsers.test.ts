import { describe, expect, it } from 'vitest';
import { parseBucketStatement } from '../../src/sql/parse-bucket.js';
import { parseAlterFunction, parseCreateFunction } from '../../src/sql/parse-function.js';
import { parseGrants } from '../../src/sql/parse-grants.js';
import { parseCreateIndex } from '../../src/sql/parse-index.js';
import { parseCreatePolicy } from '../../src/sql/parse-policy.js';
import { parseAlterTable, parseCreateTable } from '../../src/sql/parse-table.js';
import { parseAlterView, parseCreateView } from '../../src/sql/parse-view.js';
import { splitStatements } from '../../src/sql/splitter.js';
import {
  findAuthCalls,
  isWrappedInSelect,
  normalizeType,
  parseArgTypes,
  parseQName,
  splitTopLevel,
} from '../../src/sql/sql-utils.js';

const one = (sql: string) => splitStatements(sql)[0]!;

describe('sql-utils', () => {
  it('parses qualified names and quoted identifiers', () => {
    expect(parseQName('public.Orders')).toEqual({ schema: 'public', name: 'orders' });
    expect(parseQName('"My Schema"."Tab"')).toEqual({ schema: 'My Schema', name: 'Tab' });
    expect(parseQName('t')).toEqual({ schema: 'public', name: 't' });
  });

  it('splits on top-level commas only', () => {
    expect(splitTopLevel("a, f(b, c), 'x,y', d[1,2]")).toHaveLength(4);
  });

  it('normalizes types', () => {
    expect(normalizeType('INT4')).toBe('integer');
    expect(normalizeType('public.text[]')).toBe('text[]');
    expect(normalizeType('varchar(255)')).toBe('character varying');
    expect(normalizeType('timestamptz')).toBe('timestamp with time zone');
  });

  it('extracts argument types', () => {
    expect(parseArgTypes("p_id uuid, p_t text default 'x', double precision, in n int")).toEqual([
      'uuid',
      'text',
      'double precision',
      'integer',
    ]);
    expect(parseArgTypes('')).toEqual([]);
  });

  it('finds auth calls and ignores literals', () => {
    const calls = findAuthCalls("user_id = auth.uid() and x = 'auth.uid()' and auth . role () = 'a'");
    expect(calls.map((c) => c.fn)).toEqual(['uid', 'role']);
  });

  it('detects (select ...) wrapping', () => {
    const e = 'a = (select auth.uid()) and b = auth.uid()';
    const [c1, c2] = findAuthCalls(e);
    expect(isWrappedInSelect(e, c1!.offset)).toBe(true);
    expect(isWrappedInSelect(e, c2!.offset)).toBe(false);
    const f = 'lower(auth.email()) = x';
    expect(isWrappedInSelect(f, findAuthCalls(f)[0]!.offset)).toBe(false);
  });
});

describe('table parsing', () => {
  it('parses columns, keys and foreign keys', () => {
    const t = parseCreateTable(
      one(`create table if not exists public.orders (
        id uuid primary key,
        user_id uuid references auth.users(id) on delete cascade,
        email text unique,
        note text default 'a,b',
        constraint chk check (id is not null),
        unique (user_id, email)
      )`),
    )!;
    expect(t.columns).toEqual(['id', 'user_id', 'email', 'note']);
    expect(t.primaryKey).toEqual(['id']);
    expect(t.uniqueCols).toEqual([['email'], ['user_id', 'email']]);
    expect(t.foreignKeys).toEqual([{ column: 'user_id', refTable: 'auth.users' }]);
  });

  it('skips temp tables and handles table-level keys', () => {
    expect(parseCreateTable(one('create temp table t (id int)'))).toBeNull();
    const t = parseCreateTable(
      one('create table t (a int, b int, primary key (a, b), foreign key (b) references other (id))'),
    )!;
    expect(t.primaryKey).toEqual(['a', 'b']);
    expect(t.foreignKeys).toEqual([{ column: 'b', refTable: 'public.other' }]);
  });

  it('parses ALTER TABLE RLS, columns and rename', () => {
    const a = parseAlterTable(
      one('alter table only public.t enable row level security, force row level security'),
    )!;
    expect(a.rls).toEqual(['enable', 'force']);
    expect(parseAlterTable(one('alter table t add column if not exists user_id uuid'))!.addColumns).toEqual([
      'user_id',
    ]);
    expect(parseAlterTable(one('alter table t rename to u'))!.renameTo).toBe('u');
  });
});

describe('policy parsing', () => {
  it('parses all clauses with absolute offsets', () => {
    const sql = `create policy "p" on public.t as restrictive for update to authenticated, anon
      using (a = (select auth.uid()) and b in (select 1)) with check (c = 'x)')`;
    const stmt = one(sql);
    const p = parseCreatePolicy(stmt)!;
    expect(p.command).toBe('UPDATE');
    expect(p.roles).toEqual(['authenticated', 'anon']);
    expect(p.using).toBe('a = (select auth.uid()) and b in (select 1)');
    expect(p.withCheck).toBe("c = 'x)'");
    expect(sql.slice(p.usingOffset!, p.usingOffset! + 5)).toBe('a = (');
  });

  it('defaults to ALL / no roles and ignores comments', () => {
    const p = parseCreatePolicy(one('create policy p on t using (true /* x */)'))!;
    expect(p.command).toBe('ALL');
    expect(p.roles).toEqual([]);
    expect(p.using?.replace(/\s+/g, '')).toBe('true');
  });
});

describe('function parsing', () => {
  it('detects security definer, search_path and body', () => {
    const f = parseCreateFunction(
      one(`create or replace function public.f(a uuid, b text) returns void
      language plpgsql security definer set search_path = '' as $body$
      begin -- security invoker in comment
        perform 1;
      end; $body$`),
    )!;
    expect(f.securityDefiner).toBe(true);
    expect(f.searchPathSet).toBe(true);
    expect(f.argTypes).toEqual(['uuid', 'text']);
    expect(f.body).toContain('perform 1');
    expect(f.body).not.toContain('security invoker');
    expect(f.orReplace).toBe(true);
  });

  it('options after the body are honoured and body text is not mistaken for options', () => {
    const f = parseCreateFunction(
      one("create function f() returns int as $$ select 'security definer' $$ language sql security definer"),
    )!;
    expect(f.securityDefiner).toBe(true);
    const g = parseCreateFunction(
      one("create function g() returns int as $$ select 'security definer' $$ language sql"),
    )!;
    expect(g.securityDefiner).toBe(false);
  });

  it('parses ALTER FUNCTION', () => {
    const a = parseAlterFunction(one("alter function public.f(uuid) set search_path = ''"))!;
    expect(a).toMatchObject({ name: 'f', argTypes: ['uuid'], searchPathSet: true });
  });
});

describe('grants, index, view, bucket', () => {
  it('parses function grants and revokes', () => {
    const [g] = parseGrants(one('revoke execute on function public.f(uuid, text) from public, anon'));
    expect(g).toMatchObject({
      kind: 'REVOKE',
      fnName: 'f',
      fnArgTypes: ['uuid', 'text'],
      roles: ['public', 'anon'],
    });
    const [h] = parseGrants(one('grant all on all functions in schema public to service_role'));
    expect(h).toMatchObject({ scope: 'all-in-schema', fnSchema: 'public' });
    const [d] = parseGrants(
      one('alter default privileges in schema public revoke execute on functions from anon'),
    );
    expect(d).toMatchObject({ scope: 'default', schemas: ['public'], kind: 'REVOKE' });
  });

  it('parses indexes including expression columns', () => {
    const i = parseCreateIndex(
      one(
        'create unique index concurrently if not exists ix on public.t using btree (lower(email), user_id desc)',
      ),
    )!;
    expect(i).toMatchObject({ name: 'ix', table: 't', unique: true });
    expect(i.columns).toEqual(['<expr>', 'user_id']);
  });

  it('parses views and security_invoker', () => {
    const v = parseCreateView(
      one(
        'create or replace view public.v with (security_invoker = true) as select * from public.a join b on true',
      ),
    )!;
    expect(v.securityInvoker).toBe(true);
    expect(v.referencedTables).toEqual(['public.a', 'b']);
    expect(parseCreateView(one('create materialized view m as select 1'))).toBeNull();
    expect(parseAlterView(one('alter view v set (security_invoker = on)'))?.securityInvoker).toBe(true);
  });

  it('parses bucket inserts', () => {
    const b = parseBucketStatement(
      one("insert into storage.buckets (id, name, public) values ('a','a',true), ('b','b',false)"),
    );
    expect(b).toEqual([
      { id: 'a', public: true },
      { id: 'b', public: false },
    ]);
  });
});

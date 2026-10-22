import type {
  BucketInfo,
  FunctionInfo,
  GrantInfo,
  IndexInfo,
  PolicyInfo,
  SchemaIndex,
  TableInfo,
  ViewInfo,
} from '../core/types.js';
import { baseName } from '../utils/fs.js';
import { parseBucketStatement } from './parse-bucket.js';
import { parseAlterFunction, parseCreateFunction } from './parse-function.js';
import { parseGrants } from './parse-grants.js';
import { parseCreateIndex } from './parse-index.js';
import { parseAlterPolicy, parseCreatePolicy } from './parse-policy.js';
import { parseAlterTable, parseCreateTable } from './parse-table.js';
import { parseAlterView, parseCreateView } from './parse-view.js';
import { splitStatements, type Statement } from './splitter.js';
import {
  IDENT,
  QNAME,
  findMatchingParen,
  parseArgTypes,
  parseQName,
  splitTopLevel,
  unquoteIdent,
} from './sql-utils.js';

export function allFunctions(index: SchemaIndex): FunctionInfo[] {
  const out: FunctionInfo[] = [];
  for (const f of index.functions.values()) {
    out.push(f);
    if (f.overloads) out.push(...f.overloads);
  }
  return out;
}

export function sortMigrationFiles<T extends { file: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const ba = baseName(a.file);
    const bb = baseName(b.file);
    if (ba < bb) return -1;
    if (ba > bb) return 1;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
}

function sameArgs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** True when a grant/revoke target applies to function f. */
export function grantAppliesToFunction(g: GrantInfo, f: FunctionInfo): boolean {
  if (g.objectType !== 'FUNCTION') return false;
  if (g.scope === 'function') {
    if (g.fnSchema !== f.schema || g.fnName !== f.name) return false;
    return g.fnArgTypes === undefined || sameArgs(g.fnArgTypes, f.argTypes);
  }
  if (g.scope === 'all-in-schema') {
    return g.fnSchema === f.schema && (g.seq ?? 0) > (f.seq ?? 0);
  }
  if (g.scope === 'default') {
    const inScope = !g.schemas || g.schemas.length === 0 || g.schemas.includes(f.schema);
    return inScope && (g.seq ?? 0) < (f.seq ?? 0);
  }
  return false;
}

const DROP_POLICY = new RegExp(
  String.raw`^\s*drop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QNAME})`,
  'i',
);
const DROP_FN =
  /^\s*drop\s+(?:function|procedure|routine)\s+(?:if\s+exists\s+)?([\s\S]*?)\s*(?:cascade|restrict)?\s*$/i;
const DROP_OBJ =
  /^\s*drop\s+(table|view|index|materialized\s+view)\s+(?:concurrently\s+)?(?:if\s+exists\s+)?([\s\S]*?)\s*(?:cascade|restrict)?\s*$/i;

export function buildSchemaIndex(inputFiles: { file: string; text: string }[]): SchemaIndex {
  const files = sortMigrationFiles(inputFiles);
  const tables = new Map<string, TableInfo>();
  let policies: PolicyInfo[] = [];
  const fnLists = new Map<string, FunctionInfo[]>();
  let views: ViewInfo[] = [];
  let indexes: IndexInfo[] = [];
  let grants: GrantInfo[] = [];
  const buckets: BucketInfo[] = [];
  let seq = 0;

  const dropFunction = (schema: string, name: string, argTypes: string[] | undefined): void => {
    const key = `${schema}.${name}`;
    const list = fnLists.get(key);
    if (!list) return;
    const removed = list.filter((f) => argTypes === undefined || sameArgs(f.argTypes, argTypes));
    const kept = list.filter((f) => !removed.includes(f));
    if (kept.length === 0) fnLists.delete(key);
    else fnLists.set(key, kept);
    grants = grants.filter(
      (g) => !removed.some((f) => g.scope === 'function' && grantAppliesToFunction(g, f)),
    );
  };

  const handle = (file: string, stmt: Statement): void => {
    seq++;
    const first = /^\s*(\w+)/.exec(stmt.code)?.[1]?.toLowerCase();
    if (!first) return;
    const line = stmt.startLine;

    if (first === 'create') {
      const t = parseCreateTable(stmt);
      if (t) {
        const key = `${t.schema}.${t.name}`;
        if (/^\s*create\s+(?:[\w\s]*?)table\s+if\s+not\s+exists\b/i.test(stmt.code) && tables.has(key))
          return;
        tables.set(key, {
          schema: t.schema,
          name: t.name,
          file,
          line,
          rlsEnabled: false,
          rlsForced: false,
          columns: t.columns,
          primaryKey: t.primaryKey,
          uniqueCols: t.uniqueCols,
          foreignKeys: t.foreignKeys,
        });
        return;
      }
      const p = parseCreatePolicy(stmt);
      if (p) {
        policies = policies.filter(
          (x) => !(x.name === p.name && x.schema === p.schema && x.table === p.table),
        );
        policies.push({ ...p, file, line });
        return;
      }
      const f = parseCreateFunction(stmt);
      if (f) {
        const { orReplace: _orReplace, ...rest } = f;
        const info: FunctionInfo = { ...rest, file, line, seq };
        const key = `${info.schema}.${info.name}`;
        const list = (fnLists.get(key) ?? []).filter((x) => !sameArgs(x.argTypes, info.argTypes));
        list.push(info);
        fnLists.set(key, list);
        return;
      }
      const ix = parseCreateIndex(stmt);
      if (ix) {
        if (ix.name) indexes = indexes.filter((x) => !(x.name === ix.name && x.schema === ix.schema));
        const info: IndexInfo = {
          schema: ix.schema,
          table: ix.table,
          columns: ix.columns,
          unique: ix.unique,
          file,
          line,
        };
        if (ix.name) info.name = ix.name;
        indexes.push(info);
        return;
      }
      const v = parseCreateView(stmt);
      if (v) {
        views = views.filter((x) => !(x.schema === v.schema && x.name === v.name));
        views.push({
          schema: v.schema,
          name: v.name,
          securityInvoker: v.securityInvoker,
          file,
          line,
          definition: v.definition,
          referencedTables: v.referencedTables,
        });
      }
      return;
    }

    if (first === 'alter') {
      const a = parseAlterTable(stmt);
      if (a) {
        const key = `${a.schema}.${a.name}`;
        const t = tables.get(key);
        if (!t) return;
        for (const op of a.rls) {
          if (op === 'enable') t.rlsEnabled = true;
          else if (op === 'disable') t.rlsEnabled = false;
          else if (op === 'force') t.rlsForced = true;
          else t.rlsForced = false;
        }
        for (const c of a.addColumns) if (!t.columns.includes(c)) t.columns.push(c);
        t.columns = t.columns.filter((c) => !a.dropColumns.includes(c));
        if (a.primaryKey) t.primaryKey = a.primaryKey;
        t.uniqueCols.push(...a.uniqueCols);
        t.foreignKeys.push(...a.foreignKeys);
        if (a.renameTo) {
          tables.delete(key);
          t.name = a.renameTo;
          tables.set(`${a.schema}.${a.renameTo}`, t);
          for (const p of policies) if (p.schema === a.schema && p.table === a.name) p.table = a.renameTo;
          for (const i of indexes) if (i.schema === a.schema && i.table === a.name) i.table = a.renameTo;
        }
        return;
      }
      const ap = parseAlterPolicy(stmt);
      if (ap) {
        const p = policies.find((x) => x.name === ap.name && x.schema === ap.schema && x.table === ap.table);
        if (!p) return;
        const c = ap.clauses;
        if (c.roles) p.roles = c.roles;
        if (c.using !== undefined) {
          p.using = c.using;
          if (c.usingOffset !== undefined) p.usingOffset = c.usingOffset;
          p.file = file;
        }
        if (c.withCheck !== undefined) {
          p.withCheck = c.withCheck;
          if (c.withCheckOffset !== undefined) p.withCheckOffset = c.withCheckOffset;
          p.file = file;
        }
        if (c.renameTo) p.name = c.renameTo;
        return;
      }
      const af = parseAlterFunction(stmt);
      if (af) {
        const list = fnLists.get(`${af.schema}.${af.name}`) ?? [];
        for (const f of list) {
          if (af.argTypes !== undefined && !sameArgs(af.argTypes, f.argTypes)) continue;
          if (af.securityDefiner !== undefined) f.securityDefiner = af.securityDefiner;
          if (af.searchPathSet !== undefined) f.searchPathSet = af.searchPathSet;
        }
        return;
      }
      const av = parseAlterView(stmt);
      if (av) {
        for (const v of views)
          if (v.schema === av.schema && v.name === av.name) v.securityInvoker = av.securityInvoker;
        return;
      }
      for (const g of parseGrants(stmt)) grants.push({ ...g, file, line, seq });
      return;
    }

    if (first === 'drop') {
      const dp = DROP_POLICY.exec(stmt.code);
      if (dp) {
        const { schema, name: table } = parseQName(dp[2] ?? '');
        const name = unquoteIdent(dp[1] ?? '');
        policies = policies.filter((x) => !(x.name === name && x.schema === schema && x.table === table));
        return;
      }
      const df = DROP_FN.exec(stmt.code);
      if (df && /^\s*drop\s+(?:function|procedure|routine)\b/i.test(stmt.code)) {
        for (const item of splitTopLevel(df[1] ?? '')) {
          const im = new RegExp(`^\\s*(${QNAME})\\s*(\\()?`).exec(item);
          if (!im) continue;
          const { schema, name } = parseQName(im[1] ?? '');
          let args: string[] | undefined;
          if (im[2]) {
            const open = item.indexOf('(', im[0].length - 1);
            const close = findMatchingParen(item, open);
            if (close !== -1) args = parseArgTypes(item.slice(open + 1, close));
          }
          dropFunction(schema, name, args);
        }
        return;
      }
      const dobj = DROP_OBJ.exec(stmt.code);
      if (dobj) {
        const kind = (dobj[1] ?? '').toLowerCase();
        for (const item of splitTopLevel(dobj[2] ?? '')) {
          const { schema, name } = parseQName(item.trim());
          if (kind === 'table') {
            tables.delete(`${schema}.${name}`);
            policies = policies.filter((p) => !(p.schema === schema && p.table === name));
            indexes = indexes.filter((i) => !(i.schema === schema && i.table === name));
          } else if (kind === 'index') {
            indexes = indexes.filter((i) => !(i.name === name && i.schema === schema));
          } else {
            views = views.filter((v) => !(v.schema === schema && v.name === name));
          }
        }
      }
      return;
    }

    if (first === 'grant' || first === 'revoke') {
      for (const g of parseGrants(stmt)) grants.push({ ...g, file, line, seq });
      return;
    }

    if (first === 'insert' || first === 'update') {
      for (const b of parseBucketStatement(stmt)) {
        const existing = buckets.findIndex((x) => x.id === b.id);
        if (existing !== -1) buckets.splice(existing, 1);
        buckets.push({ id: b.id, public: b.public, file, line });
      }
    }
  };

  for (const f of files) {
    for (const stmt of splitStatements(f.text)) handle(f.file, stmt);
  }

  const functions = new Map<string, FunctionInfo>();
  for (const [key, list] of fnLists) {
    const sorted = [...list].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
    const primary = sorted[0];
    if (!primary) continue;
    const others = sorted.slice(1);
    if (others.length > 0) primary.overloads = others;
    functions.set(key, primary);
  }

  return {
    tables,
    policies,
    functions,
    views,
    indexes,
    grants,
    buckets,
    files: files.map((f) => ({ ...f })),
  };
}

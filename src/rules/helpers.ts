import { Node, SyntaxKind } from 'ts-morph';
import type { ProjectContext, SchemaIndex, TableInfo } from '../core/types.js';
import { migrationPath } from '../fixes/migration-name.js';
import type { TsFileInfo } from '../ts/project.js';
import { createLineMap, type LineMap } from '../utils/line-map.js';
import { isRouteHandlerPath } from '../ts/boundary.js';
import { isFunctionLike, isDirectiveStatement, unwrap } from '../ts/ast-utils.js';
import { leadingDirectives } from '../ts/boundary.js';

const lineMapCache = new WeakMap<SchemaIndex, Map<string, LineMap>>();

/** 1-based line/column for an absolute offset inside a migration file. */
export function sqlPos(sql: SchemaIndex, file: string, offset: number): { line: number; column: number } {
  let m = lineMapCache.get(sql);
  if (!m) {
    m = new Map();
    lineMapCache.set(sql, m);
  }
  let lm = m.get(file);
  if (!lm) {
    const text = sql.files.find((f) => f.file === file)?.text ?? '';
    lm = createLineMap(text);
    m.set(file, lm);
  }
  return lm.offsetToLineCol(offset);
}

export function sqlFileText(sql: SchemaIndex, file: string): string {
  return sql.files.find((f) => f.file === file)?.text ?? '';
}

export function exposedSchemas(ctx: ProjectContext): Set<string> {
  const set = new Set<string>(['public', ...ctx.config.exposedSchemas]);
  for (const s of ctx.supabaseConfig?.apiSchemas ?? []) set.add(s);
  return set;
}

export function isIgnoredTable(ctx: ProjectContext, t: Pick<TableInfo, 'schema' | 'name'>): boolean {
  const full = `${t.schema}.${t.name}`;
  return ctx.config.ignoreTables.some((x) => x === full || (t.schema === 'public' && x === t.name));
}

export function isInternalTableName(name: string): boolean {
  return name.startsWith('_') || name.startsWith('pg_');
}

export function newMigration(ctx: ProjectContext, suffix: string): string {
  return migrationPath(
    ctx.config.migrationsDir,
    ctx.sql.files.map((f) => f.file),
    suffix,
  );
}

export function quoteIdentIfNeeded(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

export function qualified(schema: string, name: string): string {
  return `${quoteIdentIfNeeded(schema)}.${quoteIdentIfNeeded(name)}`;
}

/** Files that are not request-handling application code (scripts, seeds). */
export function isScriptLikePath(p: string): boolean {
  return (
    /(?:^|\/)scripts\//.test(p) ||
    /(?:^|\/)seed[^/]*\.[a-z]+$/i.test(p) ||
    /\.(?:test|spec)\.[a-z]+$/.test(p) ||
    /(?:^|\/)__tests__\//.test(p)
  );
}

export const AUTH_CHECK_NAMES = new Set([
  'getUser',
  'getClaims',
  'requireUser',
  'requireAuth',
  'requireSession',
  'getCurrentUser',
  'getServerSession',
  'currentUser',
  'getAuthUser',
  'verifyJwt',
  'jwtVerify',
  'auth',
]);

export function calleeName(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const e = call.getExpression();
  if (Node.isIdentifier(e)) return e.getText();
  if (Node.isPropertyAccessExpression(e)) return e.getName();
  return undefined;
}

const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function isExportedFunction(fn: Node): boolean {
  if (Node.isFunctionDeclaration(fn)) return fn.isExported() || fn.isDefaultExport();
  const vd = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (vd && unwrap(vd.getInitializer() ?? fn) === fn) {
    const stmt = vd.getVariableStatement();
    return stmt?.isExported() ?? false;
  }
  return false;
}

function fnDeclaredName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn)) return fn.getName();
  const vd = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  return vd?.getName();
}

/** Is this function a request entry point (server action, route handler, edge handler, createServerFn handler)? */
export function isEntryPoint(fn: Node, file: TsFileInfo): boolean {
  if (!isFunctionLike(fn)) return false;
  const body = (fn as Node & { getBody?: () => Node | undefined }).getBody?.();
  if (body && Node.isBlock(body) && isDirectiveStatement(body.getStatements()[0], 'use server')) return true;
  if (leadingDirectives(file.text).has('use server') && isExportedFunction(fn)) return true;
  if (isRouteHandlerPath(file.path)) {
    const name = fnDeclaredName(fn);
    if (name && HTTP_VERBS.has(name) && isExportedFunction(fn)) return true;
    if (isExportedFunction(fn) && Node.isFunctionDeclaration(fn) && fn.isDefaultExport()) return true;
  }
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent();
    if (parent && Node.isCallExpression(parent)) {
      const callee = parent.getExpression();
      const text = callee.getText();
      if (text === 'serve' || text === 'Deno.serve') return true;
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'handler') {
        let cur: Node = callee.getExpression();
        for (let i = 0; i < 30; i++) {
          if (Node.isCallExpression(cur)) {
            const ce = cur.getExpression();
            if (Node.isIdentifier(ce) && ce.getText() === 'createServerFn') return true;
            cur = ce;
          } else if (Node.isPropertyAccessExpression(cur)) cur = cur.getExpression();
          else break;
        }
      }
    }
  }
  if (file.boundary === 'edge' || file.boundary === 'server') {
    const first = (fn as Node & { getParameters?: () => Node[] }).getParameters?.()[0];
    if (first && Node.isParameterDeclaration(first)) {
      const n = first.getName();
      if (n === 'req' || n === 'request') return true;
    }
  }
  return false;
}

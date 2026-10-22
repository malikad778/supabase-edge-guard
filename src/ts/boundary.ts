import { Node, type SourceFile } from 'ts-morph';
import { toPosix } from '../utils/fs.js';
import type { Boundary, Framework } from '../core/types.js';
import { isDirectiveStatement, isFunctionLike } from './ast-utils.js';

export type BoundarySource = 'path' | 'directive' | 'createServerFn' | 'default';

export interface BoundaryInfo {
  boundary: Boundary;
  source: BoundarySource;
}

/** Leading string-literal directives of a module (after comments / whitespace). */
export function leadingDirectives(text: string): Set<string> {
  const out = new Set<string>();
  let i = 0;
  const n = text.length;
  const skipTrivia = (): void => {
    while (i < n) {
      const c = text[i] ?? '';
      if (/\s/.test(c) || c === '\uFEFF') i++;
      else if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
      } else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
      } else if (c === '#' && text[i + 1] === '!' && i === 0) {
        while (i < n && text[i] !== '\n') i++;
      } else break;
    }
  };
  for (;;) {
    skipTrivia();
    const m = /^(['"])([^'"\n]*)\1\s*;?/.exec(text.slice(i, i + 200));
    if (!m) break;
    out.add(m[2] ?? '');
    i += m[0].length;
  }
  return out;
}

const MIDDLEWARE_NAMES = new Set([
  'middleware.ts',
  'middleware.js',
  'middleware.mts',
  'middleware.mjs',
  'proxy.ts',
  'proxy.js',
]);
const ROUTE_RE = /(?:^|\/)app\/(?:.*\/)?route\.(?:ts|js|tsx|jsx|mjs|mts)$/;
const PAGES_API_RE = /(?:^|\/)pages\/api\//;
const APP_SERVER_FILE_RE = /(?:^|\/)app\/(?:.*\/)?(?:page|layout|template|loading|error)\.(?:tsx|jsx)$/;

export function isEdgeFunctionPath(p: string, functionsDir: string): boolean {
  const posix = toPosix(p);
  const dir = toPosix(functionsDir).replace(/\/+$/, '');
  return posix.startsWith(`${dir}/`) || posix.includes(`/${dir}/`);
}

export function isRouteHandlerPath(p: string): boolean {
  const posix = toPosix(p);
  return ROUTE_RE.test(posix) || PAGES_API_RE.test(posix);
}

/** Text-based classification (works for files that are not parsed with ts-morph). */
export function classifyBoundaryText(
  relPath: string,
  text: string,
  framework: Framework,
  functionsDir = 'supabase/functions',
): BoundaryInfo {
  const p = toPosix(relPath);
  const slash = p.lastIndexOf('/');
  const base = slash === -1 ? p : p.slice(slash + 1);
  const dir = slash === -1 ? '' : p.slice(0, slash);

  if (isEdgeFunctionPath(p, functionsDir)) return { boundary: 'edge', source: 'path' };
  if (MIDDLEWARE_NAMES.has(base) && (dir === '' || dir === 'src'))
    return { boundary: 'middleware', source: 'path' };
  const directives = leadingDirectives(text);
  if (directives.has('use client')) return { boundary: 'client', source: 'directive' };
  if (directives.has('use server')) return { boundary: 'server', source: 'directive' };
  if (isRouteHandlerPath(p)) return { boundary: 'server', source: 'path' };
  if (APP_SERVER_FILE_RE.test(p)) return { boundary: 'server', source: 'path' };
  if (/\bcreateServerFn\s*\(/.test(text)) return { boundary: 'server', source: 'createServerFn' };
  if (framework === 'lovable-vite' && p.startsWith('src/')) return { boundary: 'client', source: 'path' };
  return { boundary: 'unknown', source: 'default' };
}

export function classifyBoundary(
  sourceFile: SourceFile,
  framework: Framework = 'generic',
  relPath?: string,
  functionsDir = 'supabase/functions',
): Boundary {
  const p = relPath ?? sourceFile.getFilePath().replace(/^\//, '');
  return classifyBoundaryText(p, sourceFile.getFullText(), framework, functionsDir).boundary;
}

function chainHasCreateServerFn(call: Node): boolean {
  let cur: Node | undefined = call;
  while (cur) {
    if (Node.isCallExpression(cur)) {
      const callee = cur.getExpression();
      if (Node.isIdentifier(callee) && callee.getText() === 'createServerFn') return true;
      cur = callee;
    } else if (Node.isPropertyAccessExpression(cur)) cur = cur.getExpression();
    else if (Node.isParenthesizedExpression(cur) || Node.isAwaitExpression(cur)) cur = cur.getExpression();
    else if (Node.isIdentifier(cur)) return cur.getText() === 'createServerFn';
    else return false;
  }
  return false;
}

export function isInsideCreateServerFn(node: Node): boolean {
  for (let cur: Node | undefined = node; cur; cur = cur.getParent()) {
    if (Node.isCallExpression(cur) && chainHasCreateServerFn(cur)) return true;
  }
  return false;
}

/** Function-level `'use server'` makes any nested node a server context. */
export function hasUseServerFunctionAncestor(node: Node): boolean {
  for (let cur: Node | undefined = node; cur; cur = cur.getParent()) {
    if (isFunctionLike(cur)) {
      const body = (cur as Node & { getBody?: () => Node | undefined }).getBody?.();
      if (body && Node.isBlock(body) && isDirectiveStatement(body.getStatements()[0], 'use server'))
        return true;
    }
  }
  return false;
}

export function enclosingBoundary(node: Node, file: BoundaryInfo): Boundary {
  if (hasUseServerFunctionAncestor(node)) return 'server';
  if (file.source === 'createServerFn') return isInsideCreateServerFn(node) ? 'server' : 'unknown';
  return file.boundary;
}

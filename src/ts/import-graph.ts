import path from 'node:path';
import { ts } from 'ts-morph';
import { toPosix } from '../utils/fs.js';
import type { Boundary } from '../core/types.js';

export interface AliasRule {
  prefix: string;
  exact: boolean;
  targets: string[]; // posix dirs/files relative to project root (without trailing wildcard)
}

export interface ImportGraph {
  edges: Map<string, Set<string>>;
}

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

export function parseTsconfigAliases(tsconfigText: string | null, fileNames: Set<string>): AliasRule[] {
  const rules: AliasRule[] = [];
  let baseUrl = '';
  if (tsconfigText !== null) {
    const parsed = ts.parseConfigFileTextToJson('tsconfig.json', tsconfigText);
    const cfg: unknown = parsed.config;
    if (typeof cfg === 'object' && cfg !== null) {
      const co = (cfg as { compilerOptions?: unknown }).compilerOptions;
      if (typeof co === 'object' && co !== null) {
        const opts = co as { baseUrl?: unknown; paths?: unknown };
        if (typeof opts.baseUrl === 'string')
          baseUrl = toPosix(opts.baseUrl).replace(/^\.\//, '').replace(/^\.$/, '');
        if (typeof opts.paths === 'object' && opts.paths !== null) {
          for (const [pattern, targets] of Object.entries(opts.paths as Record<string, unknown>)) {
            if (!Array.isArray(targets)) continue;
            const exact = !pattern.includes('*');
            const prefix = exact ? pattern : pattern.slice(0, pattern.indexOf('*'));
            const resolved = targets
              .filter((t): t is string => typeof t === 'string')
              .map((t) =>
                path.posix
                  .normalize(path.posix.join(baseUrl, toPosix(t).replace(/\*.*$/, '')))
                  .replace(/^\.\//, ''),
              );
            rules.push({ prefix, exact, targets: resolved });
          }
        }
      }
    }
  }
  const hasSrc = [...fileNames].some((f) => f.startsWith('src/'));
  for (const alias of ['@/', '~/']) {
    if (!rules.some((r) => r.prefix === alias)) {
      rules.push({ prefix: alias, exact: false, targets: [hasSrc ? 'src/' : ''] });
    }
  }
  return rules;
}

function candidates(base: string): string[] {
  const out: string[] = [];
  const stripped = base.replace(/\/$/, '');
  out.push(stripped);
  const extMatch = /\.(js|jsx|mjs|cjs)$/.exec(stripped);
  if (extMatch) {
    const stem = stripped.slice(0, -extMatch[0].length);
    for (const e of ['.ts', '.tsx', '.mts', '.cts']) out.push(stem + e);
  }
  for (const e of EXTS) out.push(stripped + e);
  for (const e of EXTS) out.push(`${stripped}/index${e}`);
  return out;
}

export function resolveSpecifier(
  fromFile: string,
  spec: string,
  files: Set<string>,
  aliases: AliasRule[],
): string | null {
  const bases: string[] = [];
  if (spec.startsWith('.')) {
    bases.push(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)));
  } else {
    for (const rule of aliases) {
      if (rule.exact ? spec === rule.prefix : spec.startsWith(rule.prefix)) {
        const rest = rule.exact ? '' : spec.slice(rule.prefix.length);
        for (const t of rule.targets)
          bases.push(path.posix.normalize(path.posix.join(t, rest)).replace(/^\.\//, ''));
      }
    }
  }
  for (const b of bases) {
    for (const c of candidates(b)) if (files.has(c)) return c;
  }
  return null;
}

function isTypeOnlyImport(text: string, pos: number): boolean {
  const before = text.slice(Math.max(0, pos - 500), pos);
  const idx = Math.max(before.lastIndexOf('import'), before.lastIndexOf('export'));
  if (idx === -1) return false;
  return /^(?:import|export)\s+type\b/.test(before.slice(idx));
}

/** Module specifiers imported by a file's text, excluding type-only imports. */
export function extractImports(text: string): string[] {
  const pre = ts.preProcessFile(text, true, true);
  const out: string[] = [];
  for (const ref of pre.importedFiles) {
    if (isTypeOnlyImport(text, ref.pos)) continue;
    out.push(ref.fileName);
  }
  return out;
}

export function buildImportGraph(texts: Map<string, string>, aliases: AliasRule[]): ImportGraph {
  const files = new Set(texts.keys());
  const edges = new Map<string, Set<string>>();
  for (const [file, text] of texts) {
    const set = new Set<string>();
    if (/\b(?:import|export|require)\b/.test(text)) {
      for (const spec of extractImports(text)) {
        const target = resolveSpecifier(file, spec, files, aliases);
        if (target && target !== file) set.add(target);
      }
    }
    edges.set(file, set);
  }
  return { edges };
}

const NEVER_IN_CLIENT_BUNDLE = new Set<Boundary>(['server', 'edge', 'middleware']);

export interface ClientReach {
  reachable: Set<string>;
  parents: Map<string, string>;
}

/** BFS from all client files. Does not traverse into server/edge/middleware modules. Depth cap 20. */
export function computeClientReachable(graph: ImportGraph, boundaries: Map<string, Boundary>): ClientReach {
  const reachable = new Set<string>();
  const parents = new Map<string, string>();
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const [file, b] of boundaries) {
    if (b === 'client') {
      reachable.add(file);
      depth.set(file, 0);
      queue.push(file);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi] as string;
    const d = depth.get(cur) ?? 0;
    if (d >= 20) continue;
    for (const next of graph.edges.get(cur) ?? []) {
      if (reachable.has(next)) continue;
      const b = boundaries.get(next) ?? 'unknown';
      if (NEVER_IN_CLIENT_BUNDLE.has(b)) continue;
      reachable.add(next);
      parents.set(next, cur);
      depth.set(next, d + 1);
      queue.push(next);
    }
  }
  return { reachable, parents };
}

/** Chain of files from the client root to `file`, e.g. ['app/Client.tsx', 'lib/a.ts', 'lib/admin.ts']. */
export function clientChain(reach: ClientReach, file: string): string[] {
  const chain = [file];
  let cur = file;
  for (let i = 0; i < 25; i++) {
    const p = reach.parents.get(cur);
    if (!p) break;
    chain.unshift(p);
    cur = p;
  }
  return chain;
}

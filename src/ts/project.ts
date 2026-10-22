import path from 'node:path';
import { Project, ts, type SourceFile } from 'ts-morph';
import type { Boundary, Framework } from '../core/types.js';
import { readText } from '../utils/fs.js';
import { classifyBoundaryText, type BoundaryInfo } from './boundary.js';
import {
  buildImportGraph,
  computeClientReachable,
  parseTsconfigAliases,
  type ClientReach,
  type ImportGraph,
} from './import-graph.js';
import { findSupabaseCalls, buildAdminIndex, type AdminIndex, type SupabaseCall } from './supabase-calls.js';

export interface TsFileInfo {
  path: string;
  text: string;
  sourceFile: SourceFile;
  boundary: Boundary;
  boundaryInfo: BoundaryInfo;
  calls: SupabaseCall[];
  admin: AdminIndex;
}

export interface TsParseError {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface TsIndex {
  project: Project;
  /** Files parsed with ts-morph (those passing the keyword pre-filter). */
  files: TsFileInfo[];
  byPath: Map<string, TsFileInfo>;
  /** All discovered TS/JS files and their text. */
  texts: Map<string, string>;
  boundaries: Map<string, Boundary>;
  graph: ImportGraph;
  clientReach: ClientReach;
  clientReachable: Set<string>;
  calls: SupabaseCall[];
  parseErrors: TsParseError[];
}

export const PREFILTER_KEYWORDS = [
  'supabase',
  'createServerFn',
  'createClient',
  'createServerClient',
  'use server',
  'use client',
  'Deno.serve',
  'NEXT_PUBLIC_',
  'SERVICE_ROLE',
  '.rpc(',
  '.storage',
  // additions needed by SG001 / SG018 for files that never mention "supabase"
  'getSession',
  'getClaims',
  'streamText',
  'generateText',
  'streamObject',
  'generateObject',
  'chat.completions',
  'messages.create',
  'api.openai.com',
  'api.anthropic.com',
];

export function passesPrefilter(text: string): boolean {
  return PREFILTER_KEYWORDS.some((k) => text.includes(k));
}

export interface BuildTsIndexOptions {
  root: string;
  framework: Framework;
  functionsDir: string;
  /** Provide texts directly (tests); otherwise read from disk. */
  texts?: Map<string, string>;
}

export function buildTsIndex(files: string[], opts: BuildTsIndexOptions): TsIndex {
  const texts = new Map<string, string>();
  for (const f of files) {
    const text = opts.texts?.get(f) ?? readText(path.join(opts.root, f));
    if (text !== null && text !== undefined) texts.set(f, text);
  }

  const boundaryInfos = new Map<string, BoundaryInfo>();
  const boundaries = new Map<string, Boundary>();
  for (const [f, text] of texts) {
    const info = classifyBoundaryText(f, text, opts.framework, opts.functionsDir);
    boundaryInfos.set(f, info);
    boundaries.set(f, info.boundary);
  }

  const tsconfigText =
    readText(path.join(opts.root, 'tsconfig.json')) ?? readText(path.join(opts.root, 'jsconfig.json'));
  const aliases = parseTsconfigAliases(tsconfigText, new Set(texts.keys()));
  const graph = buildImportGraph(texts, aliases);
  const clientReach = computeClientReachable(graph, boundaries);

  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      noLib: true,
      noResolve: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });

  const infos: TsFileInfo[] = [];
  const byPath = new Map<string, TsFileInfo>();
  const allCalls: SupabaseCall[] = [];
  const parseErrors: TsParseError[] = [];

  for (const [f, text] of texts) {
    if (!passesPrefilter(text)) continue;
    let sf: SourceFile;
    try {
      sf = project.createSourceFile(`/${f}`, text, { overwrite: true });
    } catch (err) {
      parseErrors.push({
        file: f,
        line: 1,
        column: 1,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const bi = boundaryInfos.get(f) ?? { boundary: 'unknown' as Boundary, source: 'default' as const };
    const calls = findSupabaseCalls(f, sf);
    const info: TsFileInfo = {
      path: f,
      text,
      sourceFile: sf,
      boundary: bi.boundary,
      boundaryInfo: bi,
      calls,
      admin: buildAdminIndex(sf, calls),
    };
    infos.push(info);
    byPath.set(f, info);
    allCalls.push(...calls);
  }

  if (infos.length > 0) {
    const program = project.getProgram();
    for (const info of infos) {
      const diags = program.getSyntacticDiagnostics(info.sourceFile);
      const first = diags[0];
      if (first) {
        const msg = first.getMessageText();
        parseErrors.push({
          file: info.path,
          line: first.getLineNumber() ?? 1,
          column: 1,
          message: typeof msg === 'string' ? msg : msg.getMessageText(),
        });
      }
    }
  }

  return {
    project,
    files: infos,
    byPath,
    texts,
    boundaries,
    graph,
    clientReach,
    clientReachable: clientReach.reachable,
    calls: allCalls,
    parseErrors,
  };
}

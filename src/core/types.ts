import type { ResolvedConfig } from './config.js';
import type { TsIndex } from '../ts/project.js';
import type { SupabaseConfig } from '../config-files/toml.js';
import type { EnvFile } from '../config-files/env-files.js';

export type { ResolvedConfig, TsIndex, SupabaseConfig, EnvFile };

export type Severity = 'error' | 'warning' | 'info';
export type Layer = 'ts' | 'sql' | 'cross' | 'config';
export type Boundary = 'client' | 'server' | 'edge' | 'middleware' | 'unknown';

export interface TextEdit {
  file: string; // relative path
  start: number; // 0-based char offset, inclusive
  end: number; // 0-based char offset, exclusive
  text: string; // replacement
}

export interface NewFile {
  file: string; // relative path, e.g. supabase/migrations/20260101000000_sg004_revoke_fn.sql
  content: string;
}

export interface Fix {
  description: string;
  safe: boolean; // false => requires --unsafe
  edits: TextEdit[];
  newFiles?: NewFile[];
}

export interface Finding {
  ruleId: string; // 'SG001'
  ruleName: string; // 'ServerAuthGetSessionSpoof'
  severity: Severity;
  message: string; // one sentence, says WHAT and WHY
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string; // the offending line, trimmed
  related?: { file: string; line: number; note: string }[]; // e.g. the SQL def of an RPC
  fix?: Fix;
  docsUrl: string; // https://github.com/malikad778/supabase-edge-guard/blob/main/docs/rules/SG001.md
}

export interface RuleMeta {
  id: string;
  name: string;
  severity: Severity;
  layer: Layer;
  summary: string; // 1 line
  incident: string; // real-world failure this prevents (2-3 sentences)
  badExample: string; // code block text
  goodExample: string;
  fixable: 'none' | 'safe' | 'unsafe' | 'both';
  references: string[]; // URLs (Supabase docs etc.)
  frameworks?: string[]; // omit = all
}

export type ReportInput = Omit<Finding, 'docsUrl' | 'ruleName' | 'severity'> & { severity?: Severity };

export interface Rule {
  meta: RuleMeta;
  check(ctx: ProjectContext): Finding[];
}

export type Framework = 'next-app' | 'next-pages' | 'tanstack-start' | 'lovable-vite' | 'generic';

export interface ProjectContext {
  root: string;
  config: ResolvedConfig;
  framework: Framework;
  ts: TsIndex; // from src/ts
  sql: SchemaIndex; // from src/sql
  supabaseConfig: SupabaseConfig | null; // parsed supabase/config.toml
  envFiles: EnvFile[];
  /** Contents of the root .gitignore, or null when absent. */
  gitignore: string | null;
  report(f: ReportInput): Finding; // helper that fills defaults is created per-rule in scanner
}

export interface SchemaIndex {
  tables: Map<string, TableInfo>; // key 'schema.name' (default schema 'public')
  policies: PolicyInfo[];
  functions: Map<string, FunctionInfo>; // key 'schema.name' (extra overloads: info.overloads)
  views: ViewInfo[];
  indexes: IndexInfo[];
  grants: GrantInfo[]; // GRANT/REVOKE EXECUTE statements
  buckets: BucketInfo[]; // INSERT INTO storage.buckets / UPDATE storage.buckets
  files: { file: string; text: string }[];
}

export interface TableInfo {
  schema: string;
  name: string;
  file: string;
  line: number;
  rlsEnabled: boolean;
  rlsForced: boolean;
  columns: string[];
  primaryKey: string[];
  uniqueCols: string[][];
  foreignKeys: { column: string; refTable: string }[];
}

export interface PolicyInfo {
  name: string;
  schema: string;
  table: string;
  command: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  roles: string[];
  using?: string;
  withCheck?: string;
  file: string;
  line: number;
  usingOffset?: number;
  withCheckOffset?: number; // offsets into file text
}

export interface FunctionInfo {
  schema: string;
  name: string;
  argTypes: string[];
  securityDefiner: boolean;
  searchPathSet: boolean;
  body: string;
  file: string;
  line: number;
  /** Other overloads sharing schema.name (the map value is the most recently defined one). */
  overloads?: FunctionInfo[];
  /** Global statement sequence number (ordering across files). */
  seq?: number;
}

export interface ViewInfo {
  schema: string;
  name: string;
  securityInvoker: boolean;
  file: string;
  line: number;
  /** Comment-masked SELECT text of the view definition. */
  definition?: string;
  /** Tables referenced after FROM / JOIN, as written (schema-qualified when given). */
  referencedTables?: string[];
}

export interface IndexInfo {
  schema: string;
  table: string;
  columns: string[];
  unique: boolean;
  file: string;
  line: number;
  name?: string;
}

export interface GrantInfo {
  kind: 'GRANT' | 'REVOKE';
  privilege: string;
  objectType: 'FUNCTION' | 'TABLE' | 'OTHER';
  objectName: string;
  roles: string[];
  file: string;
  line: number;
  scope?: 'function' | 'all-in-schema' | 'default';
  fnSchema?: string;
  fnName?: string;
  fnArgTypes?: string[];
  /** For scope 'default': schemas the default privilege applies to (empty = all). */
  schemas?: string[];
  seq?: number;
}

export interface BucketInfo {
  id: string;
  public: boolean;
  file: string;
  line: number;
}

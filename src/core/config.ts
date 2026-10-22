import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Severity } from './types.js';

export type FailOn = 'error' | 'warning' | 'info' | 'never';
export type RuleSetting = 'off' | Severity;

export const DEFAULT_EXCLUDE = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'];
export const HARD_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.output/**',
  '**/.vercel/**',
  '**/.turbo/**',
  '**/.svelte-kit/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/.cache/**',
  '**/.yarn/**',
  '**/.pnpm-store/**',
  '**/.expo/**',
  '**/.docusaurus/**',
];

const ruleSetting = z.enum(['off', 'error', 'warning', 'info']);

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    migrationsDir: z.string().optional(),
    functionsDir: z.string().optional(),
    rules: z.record(z.string(), ruleSetting).optional(),
    ignoreTables: z.array(z.string()).optional(),
    exposedSchemas: z.array(z.string()).optional(),
    failOn: z.enum(['error', 'warning', 'info', 'never']).optional(),
  })
  .passthrough();

export type RawConfig = z.infer<typeof configSchema>;

export interface ResolvedConfig {
  include: string[];
  exclude: string[];
  migrationsDir: string;
  functionsDir: string;
  rules: Record<string, RuleSetting>;
  ignoreTables: string[];
  exposedSchemas: string[];
  failOn: FailOn;
  /** Relative path of the config file that was loaded, or null for defaults. */
  configFile: string | null;
  /** Non-fatal problems (e.g. unknown keys). */
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function defaultConfig(): ResolvedConfig {
  return {
    include: ['**/*'],
    exclude: [...DEFAULT_EXCLUDE],
    migrationsDir: 'supabase/migrations',
    functionsDir: 'supabase/functions',
    rules: {},
    ignoreTables: [],
    exposedSchemas: ['public'],
    failOn: 'error',
    configFile: null,
    warnings: [],
  };
}

const CONFIG_FILES = ['supabase-edge-guard.config.json', '.supabase-edge-guardrc.json'];

function stripDir(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\//, '');
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((i) => `  - ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('\n');
}

export function resolveConfig(raw: unknown, source: string | null): ResolvedConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid configuration${source ? ` in ${source}` : ''}:\n${formatIssues(parsed.error.issues)}`,
    );
  }
  const data = parsed.data;
  const base = defaultConfig();
  const warnings: string[] = [];
  const known = new Set(Object.keys(configSchema.shape));
  for (const key of Object.keys(data)) {
    if (!known.has(key))
      warnings.push(`Unknown config key "${key}"${source ? ` in ${source}` : ''} (ignored).`);
  }
  const rules: Record<string, RuleSetting> = {};
  for (const [id, v] of Object.entries(data.rules ?? {})) rules[id.toUpperCase()] = v;
  return {
    include: data.include ?? base.include,
    exclude: data.exclude ?? base.exclude,
    migrationsDir: stripDir(data.migrationsDir ?? base.migrationsDir),
    functionsDir: stripDir(data.functionsDir ?? base.functionsDir),
    rules,
    ignoreTables: data.ignoreTables ?? base.ignoreTables,
    exposedSchemas: data.exposedSchemas ?? base.exposedSchemas,
    failOn: data.failOn ?? base.failOn,
    configFile: source,
    warnings,
  };
}

function readJson(abs: string, label: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    throw new ConfigError(`Cannot read ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ConfigError(`${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Load config from supabase-edge-guard.config.json, .supabase-edge-guardrc.json or package.json "edgeGuard". */
export function loadConfig(root: string): ResolvedConfig {
  for (const name of CONFIG_FILES) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) return resolveConfig(readJson(abs, name), name);
  }
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as unknown;
    } catch {
      pkg = null;
    }
    if (typeof pkg === 'object' && pkg !== null && 'edgeGuard' in pkg) {
      return resolveConfig((pkg as { edgeGuard: unknown }).edgeGuard, 'package.json#edgeGuard');
    }
  }
  return defaultConfig();
}

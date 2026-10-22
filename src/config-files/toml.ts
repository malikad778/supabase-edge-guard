import { parse } from 'smol-toml';

export interface FunctionConfig {
  name: string;
  verifyJwt: boolean | undefined;
  /** 1-based line of the `[functions.<name>]` header. */
  headerLine: number;
  /** 1-based line of the `verify_jwt = ...` entry, when present. */
  verifyJwtLine?: number;
}

export interface SupabaseConfig {
  file: string;
  raw: string;
  apiSchemas: string[];
  functions: Record<string, FunctionConfig>;
}

export class TomlParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'TomlParseError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const HEADER = /^\s*\[\s*functions\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/;
const VERIFY = /^\s*verify_jwt\s*=\s*(true|false)\b/;

/** Parse supabase/config.toml. Throws TomlParseError on invalid TOML. */
export function parseSupabaseConfig(file: string, raw: string): SupabaseConfig {
  let data: Record<string, unknown>;
  try {
    data = parse(raw);
  } catch (err) {
    const line = typeof (err as { line?: unknown }).line === 'number' ? (err as { line: number }).line : 1;
    throw new TomlParseError(
      err instanceof Error ? (err.message.split('\n')[0] ?? 'invalid TOML') : 'invalid TOML',
      line,
    );
  }

  const api = isRecord(data.api) ? data.api : {};
  const schemas = Array.isArray(api.schemas)
    ? api.schemas.filter((s): s is string => typeof s === 'string')
    : [];

  const functions: Record<string, FunctionConfig> = {};
  const fnData = isRecord(data.functions) ? data.functions : {};
  for (const [name, value] of Object.entries(fnData)) {
    if (!isRecord(value)) continue;
    const verify = typeof value.verify_jwt === 'boolean' ? value.verify_jwt : undefined;
    functions[name] = { name, verifyJwt: verify, headerLine: 1 };
  }

  // Line numbers by scanning for headers / verify_jwt entries.
  const lines = raw.split(/\r?\n/);
  let current: string | null = null;
  lines.forEach((text, i) => {
    const h = HEADER.exec(text);
    if (h) {
      current = h[1] ?? h[2] ?? h[3] ?? null;
      const cfg = current ? functions[current] : undefined;
      if (cfg) cfg.headerLine = i + 1;
      return;
    }
    if (ANY_HEADER.test(text)) {
      current = null;
      return;
    }
    if (current) {
      const v = VERIFY.exec(text);
      const cfg = functions[current];
      if (v && cfg) cfg.verifyJwtLine = i + 1;
    }
  });

  return { file, raw, apiSchemas: schemas, functions };
}

import { maskLiterals, tokenizeSql } from './tokenizer.js';

export const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*)`;
export const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

/** "Foo" -> Foo (case kept); unquoted -> lowercased. */
export function unquoteIdent(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1).replace(/""/g, '"');
  return s.toLowerCase();
}

export function parseQName(raw: string, defaultSchema = 'public'): { schema: string; name: string } {
  const m = new RegExp(`^\\s*(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?\\s*$`).exec(raw);
  if (!m) return { schema: defaultSchema, name: unquoteIdent(raw) };
  if (m[2] !== undefined) return { schema: unquoteIdent(m[1] ?? ''), name: unquoteIdent(m[2]) };
  return { schema: defaultSchema, name: unquoteIdent(m[1] ?? '') };
}

/** Index of the `)` matching the `(` at openIdx, ignoring quotes. -1 if unbalanced. */
export function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < text.length) {
        if (text[i] === q) {
          if (text[i + 1] === q) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
    } else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on a separator at paren/bracket depth 0, ignoring quotes. */
export function splitTopLevel(text: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < text.length) {
        if (text[i] === q) {
          if (text[i + 1] === q) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
    } else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Blank string-literal contents of a SQL expression. Same length as the input. */
export function maskExprLiterals(expr: string): string {
  return maskLiterals(expr, tokenizeSql(expr));
}

export type AuthFn = 'uid' | 'jwt' | 'role' | 'email' | 'current_setting';

export interface AuthCall {
  fn: AuthFn;
  offset: number;
  len: number;
}

/**
 * Finds auth.uid()/jwt()/role()/email() calls (optionally current_setting(...)) in an expression.
 * String literals are ignored. Offsets are relative to `expr`.
 */
export function findAuthCalls(expr: string, opts: { includeSettings?: boolean } = {}): AuthCall[] {
  const masked = maskExprLiterals(expr);
  const out: AuthCall[] = [];
  const re = /\bauth\s*\.\s*(uid|jwt|role|email)\s*\(\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    out.push({ fn: (m[1] ?? 'uid').toLowerCase() as AuthFn, offset: m.index, len: m[0].length });
  }
  if (opts.includeSettings) {
    const sre = /\bcurrent_setting\s*\(/gi;
    while ((m = sre.exec(masked))) {
      const open = m.index + m[0].length - 1;
      const close = findMatchingParen(expr, open);
      if (close !== -1) out.push({ fn: 'current_setting', offset: m.index, len: close + 1 - m.index });
    }
    out.sort((a, b) => a.offset - b.offset);
  }
  return out;
}

/**
 * Walks backwards from `offset` to the nearest unmatched `(`; true when the text after it
 * starts with `select` (case-insensitive) - i.e. the call is wrapped in `(select ...)` (initPlan).
 */
export function isWrappedInSelect(expr: string, offset: number): boolean {
  const masked = maskExprLiterals(expr);
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) return /^\s*select\b/i.test(masked.slice(i + 1));
      depth--;
    }
  }
  return false;
}

const TYPE_ALIASES: Record<string, string> = {
  int: 'integer',
  int4: 'integer',
  int2: 'smallint',
  int8: 'bigint',
  bool: 'boolean',
  float4: 'real',
  float8: 'double precision',
  varchar: 'character varying',
  char: 'character',
  bpchar: 'character',
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  timetz: 'time with time zone',
  time: 'time without time zone',
  decimal: 'numeric',
};

/** Normalise a SQL type for comparison: lowercase, no schema, no sizes, aliases resolved. */
export function normalizeType(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  t = t.replace(/"/g, '');
  t = t.replace(/\(\s*[\d\s,]+\)/g, '');
  const arr = /(\[\s*\d*\s*\])+$/.exec(t);
  let suffix = '';
  if (arr) {
    suffix = '[]'.repeat((arr[0].match(/\[/g) ?? []).length);
    t = t.slice(0, arr.index).trim();
  }
  if (/\barray$/.test(t)) {
    t = t.replace(/\s*array$/, '');
    suffix += '[]';
  }
  t = t.replace(/^(?:public|pg_catalog|extensions)\./, '');
  t = t.replace(/^timestamp (with|without) time zone$/, 'timestamp $1 time zone');
  t = t.replace(/^time (with|without) time zone$/, 'time $1 time zone');
  const alias = TYPE_ALIASES[t];
  if (alias) t = alias;
  return t + suffix;
}

const MULTI_WORD_TYPE_START =
  /^(double\s+precision|character\s+varying|bit\s+varying|timestamp(?:\s*\(\d+\))?\s+with(?:out)?\s+time\s+zone|time(?:\s*\(\d+\))?\s+with(?:out)?\s+time\s+zone|national\s+character)/i;

/** Extract argument types from the text between the parentheses of a function signature. */
export function parseArgTypes(argText: string): string[] {
  const trimmed = argText.trim();
  if (trimmed === '') return [];
  const types: string[] = [];
  for (const rawArg of splitTopLevel(trimmed)) {
    let arg = rawArg.trim();
    if (arg === '') continue;
    // strip default values
    const defMatch = /\s+default\s+|\s*=\s*/i.exec(maskExprLiterals(arg));
    if (defMatch) arg = arg.slice(0, defMatch.index).trim();
    // strip mode
    const mode = /^(in|out|inout|variadic)\s+/i.exec(arg);
    if (mode) {
      if (/^out$/i.test(mode[1] ?? '')) continue;
      arg = arg.slice(mode[0].length);
    }
    if (MULTI_WORD_TYPE_START.test(arg) || !/\s/.test(arg.replace(/\(.*?\)/g, ''))) {
      types.push(normalizeType(arg));
      continue;
    }
    // first token is the parameter name
    const m = new RegExp(`^${IDENT}\\s+([\\s\\S]+)$`).exec(arg);
    types.push(normalizeType(m ? (m[1] ?? arg) : arg));
  }
  return types;
}

export function stripOuterParens(s: string): string {
  let t = s.trim();
  while (t.startsWith('(') && findMatchingParen(t, 0) === t.length - 1) t = t.slice(1, -1).trim();
  return t;
}

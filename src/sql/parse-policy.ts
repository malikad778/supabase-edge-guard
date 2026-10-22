import type { PolicyInfo } from '../core/types.js';
import type { Statement } from './splitter.js';
import { IDENT, QNAME, findMatchingParen, parseQName, unquoteIdent } from './sql-utils.js';

export type ParsedPolicy = Omit<PolicyInfo, 'file' | 'line'>;

export interface PolicyClauses {
  command?: PolicyInfo['command'];
  roles?: string[];
  using?: string;
  withCheck?: string;
  usingOffset?: number;
  withCheckOffset?: number;
  renameTo?: string;
}

/**
 * Parses the clause list that follows `ON table` in CREATE/ALTER POLICY.
 * `masked` = comments blanked (strings intact), `code` = literals blanked too; both same length.
 * `base` is the absolute offset of index 0.
 */
export function parsePolicyClauses(masked: string, code: string, start: number, base: number): PolicyClauses {
  const out: PolicyClauses = {};
  let pos = start;
  while (pos < code.length) {
    const rest = code.slice(pos);
    const ws = /^\s+/.exec(rest);
    if (ws) {
      pos += ws[0].length;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^as\s+(?:permissive|restrictive)\b/i.exec(rest))) {
      pos += m[0].length;
    } else if ((m = /^for\s+(all|select|insert|update|delete)\b/i.exec(rest))) {
      out.command = (m[1] ?? 'all').toUpperCase() as PolicyInfo['command'];
      pos += m[0].length;
    } else if ((m = new RegExp(String.raw`^rename\s+to\s+(${IDENT})`, 'i').exec(rest))) {
      out.renameTo = unquoteIdent(m[1] ?? '');
      pos += m[0].length;
    } else if ((m = /^to\s+/i.exec(rest))) {
      const from = pos + m[0].length;
      const tail = code.slice(from);
      const end = /\busing\s*\(|\bwith\s+check\s*\(/i.exec(tail);
      const rolesText = end ? tail.slice(0, end.index) : tail;
      out.roles = rolesText
        .split(',')
        .map((r) => unquoteIdent(r.trim()))
        .filter((r) => r !== '');
      pos = from + rolesText.length;
    } else if ((m = /^using\s*\(/i.exec(rest))) {
      const open = pos + m[0].length - 1;
      const close = findMatchingParen(code, open);
      if (close === -1) break;
      out.using = masked.slice(open + 1, close);
      out.usingOffset = base + open + 1;
      pos = close + 1;
    } else if ((m = /^with\s+check\s*\(/i.exec(rest))) {
      const open = pos + m[0].length - 1;
      const close = findMatchingParen(code, open);
      if (close === -1) break;
      out.withCheck = masked.slice(open + 1, close);
      out.withCheckOffset = base + open + 1;
      pos = close + 1;
    } else break;
  }
  return out;
}

const CREATE_POLICY = new RegExp(String.raw`^\s*create\s+policy\s+(${IDENT})\s+on\s+(${QNAME})`, 'i');

export function parseCreatePolicy(stmt: Statement): ParsedPolicy | null {
  const head = CREATE_POLICY.exec(stmt.code);
  if (!head) return null;
  const { schema, name: table } = parseQName(head[2] ?? '');
  const c = parsePolicyClauses(stmt.masked, stmt.code, head[0].length, stmt.startOffset);
  const policy: ParsedPolicy = {
    name: unquoteIdent(head[1] ?? ''),
    schema,
    table,
    command: c.command ?? 'ALL',
    roles: c.roles ?? [],
  };
  if (c.using !== undefined) {
    policy.using = c.using;
    if (c.usingOffset !== undefined) policy.usingOffset = c.usingOffset;
  }
  if (c.withCheck !== undefined) {
    policy.withCheck = c.withCheck;
    if (c.withCheckOffset !== undefined) policy.withCheckOffset = c.withCheckOffset;
  }
  return policy;
}

const ALTER_POLICY = new RegExp(String.raw`^\s*alter\s+policy\s+(${IDENT})\s+on\s+(${QNAME})`, 'i');

export interface ParsedAlterPolicy {
  name: string;
  schema: string;
  table: string;
  clauses: PolicyClauses;
}

export function parseAlterPolicy(stmt: Statement): ParsedAlterPolicy | null {
  const head = ALTER_POLICY.exec(stmt.code);
  if (!head) return null;
  const { schema, name: table } = parseQName(head[2] ?? '');
  return {
    name: unquoteIdent(head[1] ?? ''),
    schema,
    table,
    clauses: parsePolicyClauses(stmt.masked, stmt.code, head[0].length, stmt.startOffset),
  };
}

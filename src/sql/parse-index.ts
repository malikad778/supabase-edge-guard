import type { Statement } from './splitter.js';
import { IDENT, QNAME, findMatchingParen, parseQName, splitTopLevel, unquoteIdent } from './sql-utils.js';

export interface ParsedIndex {
  schema: string;
  table: string;
  name?: string;
  columns: string[];
  unique: boolean;
}

const CREATE_INDEX = new RegExp(
  String.raw`^\s*create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:(?!on\s)(${IDENT})\s+)?on\s+(?:only\s+)?(${QNAME})\s*(?:using\s+\w+\s*)?\(`,
  'i',
);

export const EXPR_COLUMN = '<expr>';

function leadingColumn(el: string): string {
  const t = el.trim();
  if (t.startsWith('(')) return EXPR_COLUMN;
  const m = new RegExp(`^(${IDENT})\\s*(\\(|$|\\s)`).exec(t);
  if (!m) return EXPR_COLUMN;
  if (m[2] === '(') return EXPR_COLUMN; // function call, e.g. lower(email)
  return unquoteIdent(m[1] ?? '');
}

export function parseCreateIndex(stmt: Statement): ParsedIndex | null {
  const m = CREATE_INDEX.exec(stmt.code);
  if (!m) return null;
  const open = m[0].length - 1;
  const close = findMatchingParen(stmt.code, open);
  if (close === -1) return null;
  const { schema, name: table } = parseQName(m[3] ?? '');
  const columns = splitTopLevel(stmt.code.slice(open + 1, close)).map(leadingColumn);
  const out: ParsedIndex = { schema, table, columns, unique: Boolean(m[1]) };
  if (m[2]) out.name = unquoteIdent(m[2]);
  return out;
}

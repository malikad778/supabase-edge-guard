import type { Statement } from './splitter.js';
import { IDENT, QNAME, findMatchingParen, parseQName, splitTopLevel, unquoteIdent } from './sql-utils.js';

export interface ParsedTable {
  schema: string;
  name: string;
  columns: string[];
  primaryKey: string[];
  uniqueCols: string[][];
  foreignKeys: { column: string; refTable: string }[];
}

const CREATE_TABLE = new RegExp(
  String.raw`^\s*create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QNAME})`,
  'i',
);
const TEMP_TABLE = /^\s*create\s+(?:global\s+|local\s+)?(?:temp|temporary)\b/i;

function colList(raw: string): string[] {
  return splitTopLevel(raw)
    .map((c) => unquoteIdent(c.trim().split(/\s+/)[0] ?? ''))
    .filter((c) => c !== '');
}

const T_PK = new RegExp(String.raw`^(?:constraint\s+${IDENT}\s+)?primary\s+key\s*\(([^)]*)\)`, 'i');
const T_UNIQUE = new RegExp(
  String.raw`^(?:constraint\s+${IDENT}\s+)?unique\s*(?:nulls\s+(?:not\s+)?distinct\s*)?\(([^)]*)\)`,
  'i',
);
const T_FK = new RegExp(
  String.raw`^(?:constraint\s+${IDENT}\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(${QNAME})`,
  'i',
);

export function parseCreateTable(stmt: Statement): ParsedTable | null {
  if (TEMP_TABLE.test(stmt.code)) return null;
  const m = CREATE_TABLE.exec(stmt.code);
  if (!m) return null;
  const { schema, name } = parseQName(m[1] ?? '');
  const table: ParsedTable = { schema, name, columns: [], primaryKey: [], uniqueCols: [], foreignKeys: [] };

  const rest = stmt.code.slice(m[0].length);
  const openRel = rest.search(/\S/);
  if (openRel === -1 || rest[openRel] !== '(') return table; // PARTITION OF / OF type
  const openIdx = m[0].length + openRel;
  const closeIdx = findMatchingParen(stmt.code, openIdx);
  if (closeIdx === -1) return table;
  const inner = stmt.code.slice(openIdx + 1, closeIdx);

  for (const el of splitTopLevel(inner)) {
    const t = el.trim();
    if (t === '') continue;
    let mm: RegExpExecArray | null;
    if ((mm = T_PK.exec(t))) {
      table.primaryKey = colList(mm[1] ?? '');
      continue;
    }
    if ((mm = T_UNIQUE.exec(t))) {
      table.uniqueCols.push(colList(mm[1] ?? ''));
      continue;
    }
    if ((mm = T_FK.exec(t))) {
      const ref = parseQName(mm[2] ?? '');
      for (const c of colList(mm[1] ?? ''))
        table.foreignKeys.push({ column: c, refTable: `${ref.schema}.${ref.name}` });
      continue;
    }
    if (/^(constraint|check|exclude|like)\b/i.test(t)) continue;
    const colMatch = new RegExp(`^(${IDENT})(?:\\s+([\\s\\S]*))?$`).exec(t);
    if (!colMatch) continue;
    const col = unquoteIdent(colMatch[1] ?? '');
    const def = colMatch[2] ?? '';
    table.columns.push(col);
    if (/\bprimary\s+key\b/i.test(def)) table.primaryKey = [col];
    if (/\bunique\b/i.test(def)) table.uniqueCols.push([col]);
    const ref = new RegExp(String.raw`\breferences\s+(${QNAME})`, 'i').exec(def);
    if (ref) {
      const r = parseQName(ref[1] ?? '');
      table.foreignKeys.push({ column: col, refTable: `${r.schema}.${r.name}` });
    }
  }
  return table;
}

export interface AlterTableResult {
  schema: string;
  name: string;
  /** Sequential RLS operations in statement order. */
  rls: ('enable' | 'disable' | 'force' | 'noforce')[];
  addColumns: string[];
  dropColumns: string[];
  primaryKey?: string[];
  uniqueCols: string[][];
  foreignKeys: { column: string; refTable: string }[];
  renameTo?: string;
}

const ALTER_TABLE = new RegExp(
  String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+([\s\S]*)$`,
  'i',
);

export function parseAlterTable(stmt: Statement): AlterTableResult | null {
  const m = ALTER_TABLE.exec(stmt.code);
  if (!m) return null;
  const { schema, name } = parseQName(m[1] ?? '');
  const rest = m[2] ?? '';
  const out: AlterTableResult = {
    schema,
    name,
    rls: [],
    addColumns: [],
    dropColumns: [],
    uniqueCols: [],
    foreignKeys: [],
  };

  const rlsRe = /\b(enable|disable|force|no\s+force)\s+row\s+level\s+security\b/gi;
  let mm: RegExpExecArray | null;
  while ((mm = rlsRe.exec(rest))) {
    const w = (mm[1] ?? '').toLowerCase().replace(/\s+/g, '');
    out.rls.push(w === 'noforce' ? 'noforce' : (w as 'enable' | 'disable' | 'force'));
  }

  const addCol = new RegExp(String.raw`\badd\s+column\s+(?:if\s+not\s+exists\s+)?(${IDENT})`, 'gi');
  while ((mm = addCol.exec(rest))) out.addColumns.push(unquoteIdent(mm[1] ?? ''));
  const addBare = new RegExp(
    String.raw`(?:^|,)\s*add\s+(?!constraint\b|primary\b|unique\b|foreign\b|check\b|exclude\b|column\b)(${IDENT})\s+\S`,
    'gi',
  );
  while ((mm = addBare.exec(rest))) out.addColumns.push(unquoteIdent(mm[1] ?? ''));
  const dropCol = new RegExp(String.raw`\bdrop\s+column\s+(?:if\s+exists\s+)?(${IDENT})`, 'gi');
  while ((mm = dropCol.exec(rest))) out.dropColumns.push(unquoteIdent(mm[1] ?? ''));

  const pk = new RegExp(
    String.raw`\badd\s+(?:constraint\s+${IDENT}\s+)?primary\s+key\s*\(([^)]*)\)`,
    'i',
  ).exec(rest);
  if (pk) out.primaryKey = colList(pk[1] ?? '');
  const uq = new RegExp(String.raw`\badd\s+(?:constraint\s+${IDENT}\s+)?unique\s*\(([^)]*)\)`, 'gi');
  while ((mm = uq.exec(rest))) out.uniqueCols.push(colList(mm[1] ?? ''));
  const fk = new RegExp(
    String.raw`\badd\s+(?:constraint\s+${IDENT}\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(${QNAME})`,
    'gi',
  );
  while ((mm = fk.exec(rest))) {
    const ref = parseQName(mm[2] ?? '');
    for (const c of colList(mm[1] ?? ''))
      out.foreignKeys.push({ column: c, refTable: `${ref.schema}.${ref.name}` });
  }
  const rn = new RegExp(String.raw`^\s*rename\s+to\s+(${IDENT})\s*$`, 'i').exec(rest);
  if (rn) out.renameTo = unquoteIdent(rn[1] ?? '');
  return out;
}

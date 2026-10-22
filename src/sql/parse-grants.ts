import type { GrantInfo } from '../core/types.js';
import type { Statement } from './splitter.js';
import {
  IDENT,
  QNAME,
  findMatchingParen,
  parseArgTypes,
  parseQName,
  splitTopLevel,
  unquoteIdent,
} from './sql-utils.js';

export type ParsedGrant = Omit<GrantInfo, 'file' | 'line' | 'seq'>;

function parseRoles(raw: string): string[] {
  return splitTopLevel(raw.replace(/\b(with\s+grant\s+option|cascade|restrict)\b[\s\S]*$/i, ''))
    .map((r) => r.trim().replace(/^group\s+/i, ''))
    .filter((r) => r !== '')
    .map((r) => unquoteIdent(r));
}

const GRANT_RE =
  /^\s*(grant|revoke)\s+(?:grant\s+option\s+for\s+)?([\s\S]+?)\s+on\s+([\s\S]+?)\s+(to|from)\s+([\s\S]+)$/i;
const DEFAULT_PRIV_RE = new RegExp(
  String.raw`^\s*alter\s+default\s+privileges\s+(?:for\s+(?:role|user)\s+[\s\S]+?\s+)?(?:in\s+schema\s+(${IDENT}(?:\s*,\s*${IDENT})*)\s+)?(grant|revoke)\s+([\s\S]+?)\s+on\s+(functions|routines|tables|sequences|types|schemas)\s+(to|from)\s+([\s\S]+)$`,
  'i',
);

function privilegeCoversExecute(priv: string): boolean {
  return /\b(execute|all)\b/i.test(priv);
}

/** Parse GRANT / REVOKE (functions & tables) and ALTER DEFAULT PRIVILEGES. Returns 0..n grants. */
export function parseGrants(stmt: Statement): ParsedGrant[] {
  const out: ParsedGrant[] = [];
  const code = stmt.code;

  const d = DEFAULT_PRIV_RE.exec(code);
  if (d) {
    const kind = (d[2] ?? '').toUpperCase() as 'GRANT' | 'REVOKE';
    const target = (d[4] ?? '').toLowerCase();
    const schemas = d[1] ? splitTopLevel(d[1]).map((s) => unquoteIdent(s.trim())) : [];
    out.push({
      kind,
      privilege: (d[3] ?? '').trim().toUpperCase(),
      objectType: target === 'functions' || target === 'routines' ? 'FUNCTION' : 'OTHER',
      objectName: `DEFAULT ${target.toUpperCase()}`,
      roles: parseRoles(d[6] ?? ''),
      scope: 'default',
      schemas,
    });
    return out;
  }

  const m = GRANT_RE.exec(code);
  if (!m) return out;
  const kind = (m[1] ?? '').toUpperCase() as 'GRANT' | 'REVOKE';
  const privilege = (m[2] ?? '').trim().toUpperCase();
  const target = (m[3] ?? '').trim();
  const roles = parseRoles(m[5] ?? '');

  const allFn = /^all\s+(?:functions|routines)\s+in\s+schema\s+([\s\S]+)$/i.exec(target);
  if (allFn) {
    for (const s of splitTopLevel(allFn[1] ?? '')) {
      out.push({
        kind,
        privilege,
        objectType: 'FUNCTION',
        objectName: `ALL FUNCTIONS IN SCHEMA ${unquoteIdent(s.trim())}`,
        roles,
        scope: 'all-in-schema',
        fnSchema: unquoteIdent(s.trim()),
      });
    }
    return out;
  }

  const fn = /^(?:function|routine)\s+([\s\S]+)$/i.exec(target);
  if (fn && privilegeCoversExecute(privilege)) {
    const list = fn[1] ?? '';
    // Split targets on top-level commas; each is QNAME[(args)]
    for (const item of splitTopLevel(list)) {
      const im = new RegExp(`^\\s*(${QNAME})\\s*(\\()?`).exec(item);
      if (!im) continue;
      const { schema, name } = parseQName(im[1] ?? '');
      const g: ParsedGrant = {
        kind,
        privilege,
        objectType: 'FUNCTION',
        objectName: `${schema}.${name}`,
        roles,
        scope: 'function',
        fnSchema: schema,
        fnName: name,
      };
      if (im[2]) {
        const openIdx = item.indexOf('(', im[0].length - 1);
        const closeIdx = findMatchingParen(item, openIdx);
        if (closeIdx !== -1) {
          g.fnArgTypes = parseArgTypes(item.slice(openIdx + 1, closeIdx));
          g.objectName = `${schema}.${name}(${g.fnArgTypes.join(',')})`;
        }
      }
      out.push(g);
    }
    return out;
  }

  const tbl = /^(?:table\s+)?([\s\S]+)$/i.exec(target);
  if (tbl && !/^(?:schema|sequence|database|type|domain|all)\b/i.test(target)) {
    out.push({ kind, privilege, objectType: 'TABLE', objectName: (tbl[1] ?? '').trim(), roles });
  }
  return out;
}

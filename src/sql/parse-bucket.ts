import type { Statement } from './splitter.js';
import { findMatchingParen, splitTopLevel, unquoteIdent } from './sql-utils.js';

export interface ParsedBucket {
  id: string;
  public: boolean;
}

function lit(v: string): string {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function truthy(v: string): boolean {
  return /^(true|t|on|yes|1)$/i.test(lit(v));
}

const INSERT_BUCKETS =
  /^\s*insert\s+into\s+(?:"?storage"?\s*\.\s*)"?buckets"?\s*\(([^)]*)\)\s*values\s*([\s\S]*)$/i;
const UPDATE_BUCKETS =
  /^\s*update\s+(?:"?storage"?\s*\.\s*)"?buckets"?\s+set\s+public\s*=\s*('?\w+'?)\s+where\s+(?:id|name)\s*=\s*'([^']+)'/i;

export function parseBucketStatement(stmt: Statement): ParsedBucket[] {
  const out: ParsedBucket[] = [];
  const upd = UPDATE_BUCKETS.exec(stmt.masked);
  if (upd) return [{ id: upd[2] ?? '', public: truthy(upd[1] ?? '') }];
  const m = INSERT_BUCKETS.exec(stmt.masked);
  if (!m) return out;
  const cols = splitTopLevel(m[1] ?? '').map((c) => unquoteIdent(c.trim()));
  const valuesText = m[2] ?? '';
  const idIdx = cols.indexOf('id') !== -1 ? cols.indexOf('id') : cols.indexOf('name');
  const pubIdx = cols.indexOf('public');
  let pos = 0;
  while (pos < valuesText.length) {
    const open = valuesText.indexOf('(', pos);
    if (open === -1) break;
    const close = findMatchingParen(valuesText, open);
    if (close === -1) break;
    const vals = splitTopLevel(valuesText.slice(open + 1, close));
    const id = idIdx >= 0 ? lit(vals[idIdx] ?? '') : '';
    if (id !== '') out.push({ id, public: pubIdx >= 0 ? truthy(vals[pubIdx] ?? '') : false });
    pos = close + 1;
    if (/^\s*on\s+conflict/i.test(valuesText.slice(pos))) break;
  }
  return out;
}

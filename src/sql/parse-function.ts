import type { FunctionInfo } from '../core/types.js';
import type { Statement } from './splitter.js';
import { maskComments, tokenizeSql } from './tokenizer.js';
import { QNAME, findMatchingParen, parseArgTypes, parseQName } from './sql-utils.js';

export type ParsedFunction = Omit<FunctionInfo, 'file' | 'line' | 'seq' | 'overloads'> & {
  orReplace: boolean;
};

const CREATE_FN = new RegExp(
  String.raw`^\s*create\s+(or\s+replace\s+)?(function|procedure)\s+(${QNAME})\s*\(`,
  'i',
);

function lastSecurityMode(header: string): boolean | null {
  const re = /\bsecurity\s+(definer|invoker)\b/gi;
  let m: RegExpExecArray | null;
  let result: boolean | null = null;
  while ((m = re.exec(header))) result = (m[1] ?? '').toLowerCase() === 'definer';
  return result;
}

export function parseCreateFunction(stmt: Statement): ParsedFunction | null {
  const m = CREATE_FN.exec(stmt.code);
  if (!m) return null;
  const { schema, name } = parseQName(m[3] ?? '');
  const open = m[0].length - 1;
  const close = findMatchingParen(stmt.code, open);
  if (close === -1) return null;
  const argTypes = parseArgTypes(stmt.masked.slice(open + 1, close));

  // Locate the body: first dollar-quoted (or quoted) segment that follows an AS keyword.
  const segs = tokenizeSql(stmt.text);
  let body = '';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (!seg || seg.start <= close) continue;
    if (seg.kind !== 'dollar' && seg.kind !== 'string') continue;
    const prev = segs[i - 1];
    if (prev && prev.kind === 'code' && /\bas\s*$/i.test(stmt.text.slice(prev.start, prev.end))) {
      const raw = stmt.text.slice(seg.start, seg.end);
      if (seg.kind === 'dollar') {
        const tag = /^\$[^$]*\$/.exec(raw)?.[0] ?? '$$';
        const inner =
          raw.endsWith(tag) && raw.length >= tag.length * 2
            ? raw.slice(tag.length, -tag.length)
            : raw.slice(tag.length);
        body = maskComments(inner);
      } else {
        body = raw.slice(1, raw.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
      }
      break;
    }
  }

  const header = stmt.code.slice(close + 1);
  const definer = lastSecurityMode(header);
  return {
    schema,
    name,
    argTypes,
    securityDefiner: definer === true,
    searchPathSet: /\bset\s+search_path\b/i.test(header),
    body,
    orReplace: Boolean(m[1]),
  };
}

export interface ParsedAlterFunction {
  schema: string;
  name: string;
  argTypes?: string[];
  securityDefiner?: boolean;
  searchPathSet?: boolean;
}

const ALTER_FN = new RegExp(
  String.raw`^\s*alter\s+(?:function|procedure|routine)\s+(?:if\s+exists\s+)?(${QNAME})\s*`,
  'i',
);

export function parseAlterFunction(stmt: Statement): ParsedAlterFunction | null {
  const m = ALTER_FN.exec(stmt.code);
  if (!m) return null;
  const { schema, name } = parseQName(m[1] ?? '');
  let pos = m[0].length;
  let argTypes: string[] | undefined;
  if (stmt.code[pos] === '(') {
    const close = findMatchingParen(stmt.code, pos);
    if (close === -1) return null;
    argTypes = parseArgTypes(stmt.masked.slice(pos + 1, close));
    pos = close + 1;
  }
  const rest = stmt.code.slice(pos);
  const out: ParsedAlterFunction = { schema, name };
  if (argTypes) out.argTypes = argTypes;
  const sec = lastSecurityMode(rest);
  if (sec !== null) out.securityDefiner = sec;
  if (/\bset\s+search_path\b/i.test(rest)) out.searchPathSet = true;
  else if (/\breset\s+(search_path|all)\b/i.test(rest)) out.searchPathSet = false;
  return out;
}

import type { Statement } from './splitter.js';
import { QNAME, parseQName, maskExprLiterals } from './sql-utils.js';

export interface ParsedView {
  schema: string;
  name: string;
  securityInvoker: boolean;
  definition: string;
  referencedTables: string[];
}

const CREATE_VIEW = new RegExp(
  String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary)\s+)?(?:recursive\s+)?view\s+(${QNAME})\s*(?:\([^)]*\)\s*)?(?:with\s*\(([^)]*)\)\s*)?as\s+([\s\S]*)$`,
  'i',
);

export function isSecurityInvokerOption(options: string): boolean | null {
  const m = /security_invoker\s*(?:=\s*(?:'?(true|on|1|yes|t)'?|'?(false|off|0|no|f)'?))?/i.exec(options);
  if (!m) return null;
  if (m[2]) return false;
  return true;
}

export function extractReferencedTables(definition: string): string[] {
  const masked = maskExprLiterals(definition);
  const refs: string[] = [];
  const re = new RegExp(String.raw`\b(?:from|join)\s+(?:only\s+)?(${QNAME})`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) refs.push((m[1] ?? '').replace(/\s+/g, ''));
  return refs;
}

export function parseCreateView(stmt: Statement): ParsedView | null {
  const m = CREATE_VIEW.exec(stmt.masked);
  if (!m) return null;
  const { schema, name } = parseQName(m[1] ?? '');
  const definition = m[3] ?? '';
  return {
    schema,
    name,
    securityInvoker: m[2] ? isSecurityInvokerOption(m[2]) === true : false,
    definition,
    referencedTables: extractReferencedTables(definition),
  };
}

const ALTER_VIEW = new RegExp(
  String.raw`^\s*alter\s+view\s+(?:if\s+exists\s+)?(${QNAME})\s+(set|reset)\s*\(([^)]*)\)`,
  'i',
);

export function parseAlterView(
  stmt: Statement,
): { schema: string; name: string; securityInvoker: boolean } | null {
  const m = ALTER_VIEW.exec(stmt.masked);
  if (!m) return null;
  const { schema, name } = parseQName(m[1] ?? '');
  const opts = m[3] ?? '';
  if ((m[2] ?? '').toLowerCase() === 'reset') {
    if (/security_invoker/i.test(opts)) return { schema, name, securityInvoker: false };
    return null;
  }
  const v = isSecurityInvokerOption(opts);
  if (v === null) return null;
  return { schema, name, securityInvoker: v };
}

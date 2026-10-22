import type { Finding } from './types.js';
import { DOCS_BASE } from './version.js';

export interface Suppression {
  file: string;
  line: number;
  kind: 'next-line' | 'file';
  ruleIds: Set<string>;
  reason: string | null;
}

const SUPPRESS_RE =
  /(?:\/\/|--|\/\*|#)\s*edge-guard-disable-(next-line|file)\s+(SG\d{3}(?:\s*,\s*SG\d{3})*)\s*(?:--\s*(.*?))?\s*(?:\*\/\s*\}?)?\s*$/i;

export function parseSuppressions(file: string, text: string): Suppression[] {
  if (!text.includes('edge-guard-disable')) return [];
  const out: Suppression[] = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    const m = SUPPRESS_RE.exec(lineText);
    if (!m) return;
    const reason = (m[3] ?? '').trim();
    out.push({
      file,
      line: i + 1,
      kind: (m[1] ?? '').toLowerCase() === 'file' ? 'file' : 'next-line',
      ruleIds: new Set((m[2] ?? '').split(',').map((s) => s.trim().toUpperCase())),
      reason: reason === '' ? null : reason,
    });
  });
  return out;
}

export interface SuppressionResult {
  kept: Finding[];
  suppressed: Finding[];
  extra: Finding[];
}

export function applySuppressions(findings: Finding[], texts: Map<string, string>): SuppressionResult {
  const byFile = new Map<string, Suppression[]>();
  const extra: Finding[] = [];
  for (const [file, text] of texts) {
    const sups = parseSuppressions(file, text);
    if (sups.length === 0) continue;
    byFile.set(file, sups);
    for (const s of sups) {
      if (s.reason === null) {
        extra.push({
          ruleId: 'SG000',
          ruleName: 'SuppressionWithoutReason',
          severity: 'info',
          message: `Suppression ignored: a reason is required (e.g. "-- edge-guard-disable-next-line ${[...s.ruleIds].join(',')} -- why this is safe").`,
          file,
          line: s.line,
          column: 1,
          docsUrl: `${DOCS_BASE}/SG000.md`,
        });
      }
    }
  }

  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const f of findings) {
    const sups = (byFile.get(f.file) ?? []).filter((s) => s.reason !== null && s.ruleIds.has(f.ruleId));
    const hit =
      f.ruleId !== 'SG000' &&
      sups.some((s) => s.kind === 'file' || (s.kind === 'next-line' && s.line + 1 === f.line));
    (hit ? suppressed : kept).push(f);
  }
  return { kept, suppressed, extra };
}

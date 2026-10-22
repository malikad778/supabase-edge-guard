import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from './types.js';

export interface BaselineEntry {
  ruleId: string;
  file: string;
  fingerprint: string;
}

export const DEFAULT_BASELINE = '.edge-guard-baseline.json';

export function normalizeSnippet(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** Line-independent fingerprint: sha1(ruleId + file + normalized snippet). */
export function fingerprint(f: Pick<Finding, 'ruleId' | 'file' | 'snippet' | 'message'>): string {
  return createHash('sha1')
    .update(f.ruleId + f.file + normalizeSnippet(f.snippet ?? f.message))
    .digest('hex');
}

export function toBaseline(findings: Finding[]): BaselineEntry[] {
  return findings
    .filter((f) => f.ruleId !== 'SG000')
    .map((f) => ({ ruleId: f.ruleId, file: f.file, fingerprint: fingerprint(f) }));
}

export function writeBaseline(abs: string, findings: Finding[]): number {
  const entries = toBaseline(findings);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(entries, null, 2)}\n`);
  return entries.length;
}

export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineError';
  }
}

export function readBaseline(abs: string): BaselineEntry[] | null {
  if (!fs.existsSync(abs)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new BaselineError(
      `Baseline ${abs} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) throw new BaselineError(`Baseline ${abs} must be a JSON array.`);
  const out: BaselineEntry[] = [];
  for (const e of parsed) {
    if (
      typeof e === 'object' &&
      e !== null &&
      typeof (e as BaselineEntry).ruleId === 'string' &&
      typeof (e as BaselineEntry).file === 'string' &&
      typeof (e as BaselineEntry).fingerprint === 'string'
    ) {
      out.push(e as BaselineEntry);
    }
  }
  return out;
}

/** Each baseline entry hides exactly one matching finding (multiset semantics). */
export function applyBaseline(
  findings: Finding[],
  entries: BaselineEntry[],
): { kept: Finding[]; baselined: Finding[] } {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.fingerprint, (counts.get(e.fingerprint) ?? 0) + 1);
  const kept: Finding[] = [];
  const baselined: Finding[] = [];
  for (const f of findings) {
    const fp = fingerprint(f);
    const n = counts.get(fp) ?? 0;
    if (f.ruleId !== 'SG000' && n > 0) {
      counts.set(fp, n - 1);
      baselined.push(f);
    } else kept.push(f);
  }
  return { kept, baselined };
}

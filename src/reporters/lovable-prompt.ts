import type { Finding } from '../core/types.js';
import type { Reporter } from './types.js';

export function describeFinding(f: Finding, n: number): string {
  const where = `${f.file} (line ${f.line})`;
  const parts: string[] = [];
  if (f.ruleId === 'SG010') {
    const table = /Table ([\w."]+)/.exec(f.message)?.[1] ?? 'the table';
    parts.push(
      `${n}. [SG010] In ${where} the table ${table} has no Row Level Security. Add a NEW migration that enables RLS on it and add policies so each user can only access their own rows (for example where user_id = (select auth.uid())). Do not edit the existing migration.`,
    );
  } else if (f.ruleId === 'SG001') {
    parts.push(
      `${n}. [SG001] In ${where}, replace supabase.auth.getSession() with supabase.auth.getUser() and use data.user instead of session.user, because getSession() trusts an unverified cookie on the server.`,
    );
  } else {
    parts.push(`${n}. [${f.ruleId}] In ${where}: ${f.message}`);
  }
  if (f.fix) parts.push(`   Fix: ${f.fix.description}`);
  for (const nf of f.fix?.newFiles ?? []) {
    parts.push(
      '   SQL:',
      '   ```sql',
      ...nf.content
        .trimEnd()
        .split('\n')
        .map((l) => `   ${l}`),
      '   ```',
    );
  }
  return parts.join('\n');
}

export const lovablePromptReporter: Reporter = (result) => {
  const actionable = result.findings.filter((f) => f.ruleId !== 'SG000');
  if (actionable.length === 0) return 'No security issues were found. No changes are needed.\n';
  const lines = [
    'Fix the following security issues in my Supabase project. Make the smallest change that resolves each one, do not change unrelated code, and do not disable or weaken any security feature.',
    '',
    ...actionable.map((f, i) => describeFinding(f, i + 1)),
    '',
    'After applying the changes, list every file you changed.',
  ];
  return `${lines.join('\n')}\n`;
};

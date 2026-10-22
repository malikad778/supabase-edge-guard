import { computeScore } from '../core/score.js';
import type { Finding } from '../core/types.js';
import type { Reporter } from './types.js';

export const MARKDOWN_MARKER = '<!-- supabase-edge-guard -->';

const COLORS: Record<string, string> = { A: 'brightgreen', B: 'green', C: 'yellow', D: 'orange', F: 'red' };

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export const markdownReporter: Reporter = (result) => {
  const s = computeScore(result.findings);
  const out: string[] = [MARKDOWN_MARKER];
  const badge = `https://img.shields.io/badge/edge--guard-${result.grade}%20(${result.score})-${COLORS[result.grade] ?? 'lightgrey'}`;
  out.push(`## supabase-edge-guard - Grade ${result.grade} (${result.score}/100) ![grade](${badge})`);
  out.push('');
  if (result.findings.length === 0) {
    out.push('✅ No issues found.');
    return `${out.join('\n')}\n`;
  }
  out.push(
    '| Severity | Count |',
    '|---|---|',
    `| 🔴 Error | ${s.errors} |`,
    `| 🟠 Warning | ${s.warnings} |`,
    `| 🔵 Info | ${s.infos} |`,
    '',
  );
  const byRule = new Map<string, Finding[]>();
  for (const f of result.findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  for (const [id, list] of [...byRule].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const first = list[0] as Finding;
    out.push(`<details><summary><b>${id}</b> ${first.ruleName} - ${list.length}</summary>`, '');
    for (const f of list) out.push(`- \`${f.file}:${f.line}\` - ${esc(f.message)}`);
    out.push('', `[Rule documentation](${first.docsUrl})`, '', '</details>', '');
  }
  return `${out.join('\n')}`;
};

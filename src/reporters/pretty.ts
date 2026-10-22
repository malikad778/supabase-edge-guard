import pc from 'picocolors';
import { frameworkLabel } from '../core/framework-detect.js';
import { computeScore } from '../core/score.js';
import type { Finding } from '../core/types.js';
import { VERSION } from '../core/version.js';
import type { Reporter } from './types.js';

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

export const prettyReporter: Reporter = (result, opts) => {
  const c = pc.createColors(opts.color ?? false);
  const lines: string[] = [];
  const s = computeScore(result.findings);

  if (!opts.quiet) {
    lines.push(
      ` ${c.bold('supabase-edge-guard')} v${VERSION} - ${frameworkLabel(result.framework)} · ${plural(result.stats.tsFiles, 'TS file')} · ${plural(result.stats.migrations, 'migration')}`,
    );
    lines.push('');
  }

  const rank = (f: Finding): number =>
    f.ruleId === 'SG010' ? -1 : f.severity === 'error' ? 0 : f.severity === 'warning' ? 1 : 2;
  const ordered = [...result.findings].sort(
    (a, b) => rank(a) - rank(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
  );

  if (ordered.length === 0) {
    lines.push(` ${c.green('✔')} No issues found`);
  }
  for (const f of ordered) {
    const badge =
      f.severity === 'error'
        ? c.red('✖ error  ')
        : f.severity === 'warning'
          ? c.yellow('⚠ warning')
          : c.cyan('ℹ info   ');
    lines.push(` ${badge} ${c.bold(f.ruleId)}  ${f.message}`);
    lines.push(`    ${c.dim(`${f.file}:${f.line}:${f.column}`)}`);
    if (f.snippet) {
      const num = String(f.line).padStart(4, ' ');
      lines.push(`    ${c.dim(`${num} │`)} ${f.snippet}`);
    }
    for (const r of f.related ?? []) lines.push(`    ${c.dim(`↳ ${r.file}:${r.line} - ${r.note}`)}`);
    if (f.fix) {
      lines.push(
        `    ${c.green(f.fix.safe ? 'fix available → run with --fix' : 'fix available → run with --fix --unsafe')}`,
      );
    }
    lines.push(`    ${c.dim(f.docsUrl)}`);
    lines.push('');
  }

  const summary = `Score ${s.score}/100 (${s.grade}) · ${plural(s.errors, 'error')} · ${plural(s.warnings, 'warning')} · ${s.infos} info`;
  lines.push(` ${c.bold(summary)}`);
  const fixable = result.findings.filter((f) => f.fix);
  if (!opts.quiet && fixable.length > 0) {
    lines.push(
      ` Next: ${c.cyan('npx supabase-edge-guard --fix')}  (${plural(fixable.length, 'finding')} auto-fixable)`,
    );
  }
  for (const w of result.warnings) lines.push(` ${c.yellow('warning:')} ${w}`);
  return `${lines.join('\n')}\n`;
};

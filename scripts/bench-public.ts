/*
 * Aggregate findings across public repositories you have already cloned.
 *
 *   pnpm tsx scripts/bench-public.ts <dir-with-clones> [--out docs/state-of-supabase-security.md]
 *
 * The scanner never touches the network; cloning is your job (git clone --depth 1 ...).
 * Only real numbers from the repositories found in <dir> are written; nothing is fabricated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../src/core/scanner.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const out = outIdx !== -1 ? args[outIdx + 1] : undefined;
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: pnpm tsx scripts/bench-public.ts <dir-with-clones> [--out file.md]');
  process.exit(2);
}

const repos = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  .sort();

const perRule = new Map<string, { findings: number; repos: Set<string> }>();
const rows: string[] = [];
let withSupabase = 0;
for (const name of repos) {
  const root = path.join(dir, name);
  const started = Date.now();
  try {
    const r = scan({ root, baseline: false });
    const hasSupabase = fs.existsSync(path.join(root, 'supabase')) || r.stats.migrations > 0;
    if (hasSupabase) withSupabase++;
    for (const f of r.findings) {
      if (f.ruleId === 'SG000') continue;
      const e = perRule.get(f.ruleId) ?? { findings: 0, repos: new Set<string>() };
      e.findings++;
      e.repos.add(name);
      perRule.set(f.ruleId, e);
    }
    rows.push(
      `| ${name} | ${r.framework} | ${r.stats.tsFiles} | ${r.stats.migrations} | ${r.findings.length} | ${r.grade} (${r.score}) | ${Date.now() - started} ms |`,
    );
  } catch (err) {
    rows.push(
      `| ${name} | - | - | - | scan failed: ${(err instanceof Error ? err.message : String(err)).replace(/\|/g, '/')} | - | - |`,
    );
  }
}

const md = [
  '# State of Supabase security (measured by supabase-edge-guard)',
  '',
  `Repositories scanned: ${repos.length} (${withSupabase} with Supabase migrations or a supabase/ directory).`,
  '',
  '## Findings by rule',
  '',
  '| Rule | Findings | Repositories affected |',
  '|------|----------|-----------------------|',
  ...[...perRule]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, e]) => `| ${id} | ${e.findings} | ${e.repos.size} |`),
  '',
  '## Per repository',
  '',
  '| Repository | Framework | TS files | Migrations | Findings | Grade | Time |',
  '|------------|-----------|----------|------------|----------|-------|------|',
  ...rows,
  '',
].join('\n');
if (out) fs.writeFileSync(out, md);
else console.log(md);

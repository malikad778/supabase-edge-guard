/* Generates docs/rules/*.md, the rule table in README.md and schema.json from the rule metadata. */
import fs from 'node:fs';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { configSchema } from '../src/core/config.js';
import { allRules, sg000Meta } from '../src/rules/index.js';
import type { RuleMeta } from '../src/core/types.js';

const root = path.resolve(import.meta.dirname, '..');

function lang(m: RuleMeta, which: 'bad' | 'good'): string {
  const text = which === 'bad' ? m.badExample : m.goodExample;
  if (m.layer === 'sql' || /^\s*(create|alter|revoke|grant|insert)\b/i.test(text)) return 'sql';
  if (m.id === 'SG016' || m.id === 'SG017') return 'text';
  return 'ts';
}

function page(m: RuleMeta): string {
  const lines = [
    `# ${m.id} - ${m.name}`,
    '',
    `**Severity:** ${m.severity} · **Layer:** ${m.layer} · **Auto-fix:** ${m.fixable}`,
    '',
    `> ${m.summary}`,
    '',
    '## Why it matters',
    '',
    m.incident,
    '',
    '## Bad',
    '',
    '```' + lang(m, 'bad'),
    m.badExample,
    '```',
    '',
    '## Good',
    '',
    '```' + lang(m, 'good'),
    m.goodExample,
    '```',
    '',
    '## Suppressing',
    '',
    'Only suppress after you have confirmed the finding is a false positive. A reason is mandatory; suppressions without one are ignored and reported as `SG000`.',
    '',
    '```',
    `// edge-guard-disable-next-line ${m.id} -- <why this is safe>`,
    '```',
    '',
    `In SQL files use \`-- edge-guard-disable-next-line ${m.id} -- <reason>\`. Use \`edge-guard-disable-file\` to cover a whole file, or set \`"rules": { "${m.id}": "off" }\` in the config.`,
  ];
  if (m.references.length > 0) lines.push('', '## References', '', ...m.references.map((r) => `- ${r}`));
  return `${lines.join('\n')}\n`;
}

const metas = [...allRules.map((r) => r.meta), sg000Meta];
fs.mkdirSync(path.join(root, 'docs/rules'), { recursive: true });
for (const m of metas) fs.writeFileSync(path.join(root, 'docs/rules', `${m.id}.md`), page(m));

const table = [
  '| ID | Name | Severity | Layer | Fix | What it catches |',
  '|----|------|----------|-------|-----|-----------------|',
  ...allRules.map(
    (r) =>
      `| [${r.meta.id}](docs/rules/${r.meta.id}.md) | ${r.meta.name} | ${r.meta.severity} | ${r.meta.layer} | ${r.meta.fixable} | ${r.meta.summary} |`,
  ),
].join('\n');

const readmePath = path.join(root, 'README.md');
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, 'utf8');
  const next = readme.replace(
    /<!-- RULES:START -->[\s\S]*<!-- RULES:END -->/,
    `<!-- RULES:START -->\n${table}\n<!-- RULES:END -->`,
  );
  if (next !== readme) fs.writeFileSync(readmePath, next);
}

const schema = zodToJsonSchema(configSchema, { name: 'SupabaseEdgeGuardConfig', $refStrategy: 'none' });
fs.writeFileSync(path.join(root, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
console.log(`Generated ${metas.length} rule pages and schema.json`);

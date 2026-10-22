/* Scaffold a new rule: pnpm new-rule SG019 MyRuleName ts|sql|cross|config */
import fs from 'node:fs';
import path from 'node:path';

const [id, name, layer = 'ts'] = process.argv.slice(2);
if (!id || !/^SG\d{3}$/.test(id) || !name || !/^[A-Z][A-Za-z0-9]+$/.test(name)) {
  console.error('usage: pnpm new-rule SG019 PascalCaseName [ts|sql|cross|config]');
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, '..');
const slug = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const file = `${id.toLowerCase()}-${slug}.ts`;
const varName = id.toLowerCase();
const target = path.join(root, 'src/rules', file);
if (fs.existsSync(target)) {
  console.error(`${target} already exists`);
  process.exit(2);
}

fs.writeFileSync(
  target,
  `import type { Finding, Rule } from '../core/types.js';

export const ${varName}: Rule = {
  meta: {
    id: '${id}',
    name: '${name}',
    severity: 'warning',
    layer: '${layer}',
    summary: 'TODO: one line describing what this rule catches.',
    incident: 'TODO: the real-world failure this prevents (2-3 sentences).',
    badExample: 'TODO',
    goodExample: 'TODO',
    fixable: 'none',
    references: [],
  },
  check(ctx) {
    const out: Finding[] = [];
    void ctx; // TODO: inspect ctx.ts / ctx.sql and call ctx.report({ ruleId: '${id}', message, file, line, column })
    return out;
  },
};
`,
);

const indexPath = path.join(root, 'src/rules/index.ts');
let index = fs.readFileSync(indexPath, 'utf8');
index = index.replace(
  '\nexport const allRules',
  `import { ${varName} } from './${file.replace(/\.ts$/, '.js')}';\n\nexport const allRules`,
);
index = index.replace(/(allRules: Rule\[\] = \[[\s\S]*?)(\n\];)/, `$1\n  ${varName},$2`);
fs.writeFileSync(indexPath, index);

fs.mkdirSync(path.join(root, 'tests/rules'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'tests/rules', `${varName}.test.ts`),
  `import { afterAll, describe, expect, it } from 'vitest';
import { cleanupProjects, only, scanFiles } from '../helpers.js';

afterAll(cleanupProjects);

describe('${id} ${name}', () => {
  it.todo('flags the bad example');
  it.todo('accepts the good example');
  it('does not crash on an empty project', () => {
    expect(only(scanFiles({}).findings, '${id}')).toHaveLength(0);
  });
});
`,
);
console.log(
  `Created src/rules/${file} and tests/rules/${varName}.test.ts, registered in src/rules/index.ts.`,
);
console.log(
  'Next: fill in the rule, add a fixture to the example projects if relevant, then run `pnpm gen-docs`.',
);

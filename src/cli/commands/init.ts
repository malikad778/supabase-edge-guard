import fs from 'node:fs';
import path from 'node:path';

const CONFIG = {
  $schema: 'https://raw.githubusercontent.com/malikad778/supabase-edge-guard/main/schema.json',
  migrationsDir: 'supabase/migrations',
  functionsDir: 'supabase/functions',
  failOn: 'error',
  ignoreTables: [] as string[],
  rules: {} as Record<string, string>,
};

const WORKFLOW = `name: edge-guard
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  security-events: write
  pull-requests: write
jobs:
  edge-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: malikad778/supabase-edge-guard@v0
`;

const HUSKY_LINE = 'npx supabase-edge-guard --changed-only --fail-on error';

export interface InitResult {
  created: string[];
  skipped: string[];
  updated: string[];
}

export function runInit(root: string, force = false): InitResult {
  const res: InitResult = { created: [], skipped: [], updated: [] };
  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs) && !force) {
      res.skipped.push(rel);
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    res.created.push(rel);
  };
  write('supabase-edge-guard.config.json', `${JSON.stringify(CONFIG, null, 2)}\n`);
  write('.github/workflows/edge-guard.yml', WORKFLOW);

  const huskyDir = path.join(root, '.husky');
  if (fs.existsSync(huskyDir) && fs.statSync(huskyDir).isDirectory()) {
    const hook = path.join(huskyDir, 'pre-commit');
    const existing = fs.existsSync(hook) ? fs.readFileSync(hook, 'utf8') : '';
    if (existing.includes('supabase-edge-guard')) res.skipped.push('.husky/pre-commit');
    else {
      const next = `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${HUSKY_LINE}\n`;
      fs.writeFileSync(hook, next);
      (existing === '' ? res.created : res.updated).push('.husky/pre-commit');
    }
  }
  return res;
}

/* Synthetic benchmark: pnpm bench [files=1000] [migrations=200] */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/core/scanner.js';

const nFiles = Number(process.argv[2] ?? 1000);
const nMig = Number(process.argv[3] ?? 200);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-bench-'));
const write = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
write('package.json', JSON.stringify({ dependencies: { next: '14.2.0' } }));
for (let i = 0; i < nFiles; i++) {
  write(
    `app/m${i}/page.tsx`,
    i % 3 === 0
      ? `import { createClient } from '@supabase/supabase-js';\nconst c = createClient('u','k');\nexport async function f${i}() { return (await c.from('t${i % 50}').select('*')).data; }\n`
      : `export const v${i} = ${i};\n`,
  );
}
for (let i = 0; i < nMig; i++) {
  write(
    `supabase/migrations/${20240101000000 + i}_m${i}.sql`,
    `create table public.t${i} (id uuid primary key, user_id uuid references auth.users(id));\nalter table public.t${i} enable row level security;\ncreate policy p${i} on public.t${i} using (user_id = (select auth.uid()));\ncreate index on public.t${i} (user_id);\n`,
  );
}
const runs: number[] = [];
for (let i = 0; i < 3; i++) {
  const t = performance.now();
  scan({ root, baseline: false });
  runs.push(Math.round(performance.now() - t));
}
console.log(`${nFiles} TS files + ${nMig} migrations: ${runs.join(' ms, ')} ms (3 runs)`);
fs.rmSync(root, { recursive: true, force: true });

import net from 'node:net';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { scan } from '../src/core/scanner.js';
import { cleanupProjects, makeProject, NEXT_PKG } from './helpers.js';

afterAll(cleanupProjects);

describe('performance', () => {
  it('scans 1000 TS files + 200 migrations in under 5 seconds', () => {
    const files: Record<string, string> = { 'package.json': NEXT_PKG };
    for (let i = 0; i < 1000; i++) {
      const supa = i % 3 === 0;
      files[`app/mod${i}/page${i}.tsx`] = supa
        ? `import { createClient } from '@supabase/supabase-js';\nconst c = createClient('u','k');\nexport async function f${i}() {\n  const { data } = await c.from('t${i % 50}').select('*');\n  return data;\n}\n`
        : `export const v${i} = ${i};\nexport function g${i}(a: number) { return a + ${i}; }\n`;
    }
    for (let i = 0; i < 200; i++) {
      files[`supabase/migrations/${String(20240101000000 + i)}_m${i}.sql`] =
        `create table public.t${i} (id uuid primary key, user_id uuid references auth.users(id));\nalter table public.t${i} enable row level security;\ncreate policy p${i} on public.t${i} using (user_id = (select auth.uid()));\ncreate index on public.t${i} (user_id);\n`;
    }
    const root = makeProject(files);
    const t = Date.now();
    const r = scan({ root, baseline: false });
    const ms = Date.now() - t;
    expect(r.stats.tsFiles).toBe(1000);
    expect(r.stats.migrations).toBe(200);
    expect(ms).toBeLessThan(5000);
  });
});

describe('zero network access', () => {
  it('scanning the example project performs no network calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network call attempted: fetch');
    });
    const connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('network call attempted: socket');
    });
    try {
      const r = scan({
        root: path.resolve(import.meta.dirname, '../examples/vulnerable-nextjs-app'),
        baseline: false,
      });
      expect(r.findings.length).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      connectSpy.mockRestore();
    }
  });
});

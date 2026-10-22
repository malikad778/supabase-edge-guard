import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'tsup';

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

/** Build the CLI once before the test run so e2e tests exercise the real bundle. */
export default async function setup(): Promise<void> {
  const root = path.resolve(import.meta.dirname, '..');
  const dist = path.join(root, 'dist', 'cli', 'main.js');
  if (existsSync(dist) && statSync(dist).mtimeMs >= newestMtime(path.join(root, 'src'))) return;
  await build({ config: path.join(root, 'tsup.config.ts'), silent: true });
}

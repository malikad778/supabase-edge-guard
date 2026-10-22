import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { baseName, readText, toPosix } from '../utils/fs.js';
import { HARD_IGNORE, type ResolvedConfig } from './config.js';

export interface DiscoveredFiles {
  tsFiles: string[];
  sqlFiles: string[];
  tomlFile: string | null;
  envFiles: string[];
  gitignore: string | null;
}

/** Files larger than this are bundles / generated output, not source; skipped for performance. */
export const MAX_SOURCE_BYTES = 1_000_000;

const TS_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

function normalizeInclude(p: string): string {
  const posix = toPosix(p).replace(/^\.\//, '');
  return posix;
}

export function discoverFiles(root: string, config: ResolvedConfig): DiscoveredFiles {
  const cwd = path.resolve(root);
  const ignore = [...HARD_IGNORE, ...config.exclude.map(normalizeInclude)];
  const include = config.include.map(normalizeInclude);

  const all = fg.sync(include, {
    cwd,
    dot: true,
    onlyFiles: true,
    ignore,
    unique: true,
    followSymbolicLinks: false,
  });
  const tsFiles = all
    .map(toPosix)
    .filter((f) => TS_EXT.test(f) && !f.endsWith('.d.ts') && !f.endsWith('.d.mts') && !f.endsWith('.d.cts'))
    .sort();

  // Edge function sources must be scanned even when include patterns miss them.
  const fnGlob = `${config.functionsDir}/**/*.{ts,tsx,js,jsx,mjs,mts}`;
  const fnFiles = fg
    .sync([fnGlob], { cwd, dot: true, onlyFiles: true, ignore: HARD_IGNORE, unique: true })
    .map(toPosix)
    .filter((f) => !f.endsWith('.d.ts'));
  const tsSet = new Set(tsFiles);
  for (const f of fnFiles) tsSet.add(f);
  for (const f of [...tsSet]) {
    try {
      if (fs.statSync(path.join(cwd, f)).size > MAX_SOURCE_BYTES) tsSet.delete(f);
    } catch {
      tsSet.delete(f);
    }
  }

  const sqlFiles = fg
    .sync([`${config.migrationsDir}/**/*.sql`], {
      cwd,
      dot: true,
      onlyFiles: true,
      ignore: HARD_IGNORE,
      unique: true,
    })
    .map(toPosix)
    .sort((a, b) => {
      const ba = baseName(a);
      const bb = baseName(b);
      return ba < bb ? -1 : ba > bb ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });

  const tomlRel = 'supabase/config.toml';
  const tomlFile = readText(path.join(cwd, tomlRel)) !== null ? tomlRel : null;

  const envFiles = fg
    .sync(['.env*', 'supabase/.env*', `${config.functionsDir}/**/.env*`], {
      cwd,
      dot: true,
      onlyFiles: true,
      ignore: HARD_IGNORE,
      unique: true,
    })
    .map(toPosix)
    .sort();

  return {
    tsFiles: [...tsSet].sort(),
    sqlFiles,
    tomlFile,
    envFiles,
    gitignore: readText(path.join(cwd, '.gitignore')),
  };
}

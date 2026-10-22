import { execFileSync } from 'node:child_process';
import { toPosix } from '../utils/fs.js';

function git(root: string, args: string[]): string[] | null {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).filter((l) => l !== '');
  } catch {
    return null;
  }
}

/** Files changed vs HEAD (or a base ref) plus untracked files, relative to root. Null when not a git repo. */
export function changedFiles(root: string, baseRef?: string): Set<string> | null {
  const set = new Set<string>();
  const parts: (string[] | null)[] = [];
  if (baseRef) parts.push(git(root, ['diff', '--name-only', '--relative', `${baseRef}...HEAD`]));
  parts.push(git(root, ['diff', '--name-only', '--relative', 'HEAD']));
  parts.push(git(root, ['ls-files', '--others', '--exclude-standard']));
  if (parts.every((p) => p === null)) return null;
  for (const p of parts) for (const f of p ?? []) set.add(toPosix(f));
  return set;
}

/** True when `git status --porcelain` reports changes. False when clean or not a git repo. */
export function isGitDirty(root: string): boolean {
  const out = git(root, ['status', '--porcelain']);
  return out !== null && out.length > 0;
}

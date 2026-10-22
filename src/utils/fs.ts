import fs from 'node:fs';
import path from 'node:path';

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function relPosix(root: string, abs: string): string {
  return toPosix(path.relative(root, abs));
}

export function readText(abs: string): string | null {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

export function fileExists(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

export function dirExists(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** True when `abs` is inside (or equal to) `root`. */
export function isInside(root: string, abs: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function baseName(p: string): string {
  const posix = toPosix(p);
  const i = posix.lastIndexOf('/');
  return i === -1 ? posix : posix.slice(i + 1);
}

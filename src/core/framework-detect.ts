import path from 'node:path';
import { dirExists, readText } from '../utils/fs.js';
import type { Framework } from './types.js';

function readDeps(root: string): Set<string> {
  const text = readText(path.join(root, 'package.json'));
  const deps = new Set<string>();
  if (text === null) return deps;
  try {
    const pkg: unknown = JSON.parse(text);
    if (typeof pkg === 'object' && pkg !== null) {
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const section = (pkg as Record<string, unknown>)[key];
        if (typeof section === 'object' && section !== null)
          for (const name of Object.keys(section)) deps.add(name);
      }
    }
  } catch {
    /* ignore invalid package.json */
  }
  return deps;
}

export function detectFramework(root: string): Framework {
  const deps = readDeps(root);
  if (deps.has('next')) {
    const hasApp = dirExists(path.join(root, 'app')) || dirExists(path.join(root, 'src', 'app'));
    const hasPages = dirExists(path.join(root, 'pages')) || dirExists(path.join(root, 'src', 'pages'));
    if (!hasApp && hasPages) return 'next-pages';
    return 'next-app';
  }
  for (const d of deps) {
    if (d.startsWith('@tanstack/') && d.includes('start')) return 'tanstack-start';
  }
  if (deps.has('vite') || deps.has('lovable-tagger')) return 'lovable-vite';
  return 'generic';
}

export function frameworkLabel(f: Framework): string {
  switch (f) {
    case 'next-app':
      return 'Next.js (app router)';
    case 'next-pages':
      return 'Next.js (pages router)';
    case 'tanstack-start':
      return 'TanStack Start';
    case 'lovable-vite':
      return 'Lovable / Vite';
    default:
      return 'generic';
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, type ScanOptions, type ScanResult } from '../src/core/scanner.js';
import type { Finding } from '../src/core/types.js';

const created: string[] = [];

/** Write a project to a fresh temp dir and return its root. */
export function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
  created.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

export function cleanupProjects(): void {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export function scanFiles(
  files: Record<string, string>,
  opts: Partial<ScanOptions> = {},
): ScanResult & { root: string } {
  const root = makeProject(files);
  const result = scan({ root, baseline: false, ...opts });
  return Object.assign(result, { root });
}

export function ruleIds(findings: Finding[]): string[] {
  return findings.map((f) => f.ruleId).sort();
}

export function only(findings: Finding[], id: string): Finding[] {
  return findings.filter((f) => f.ruleId === id);
}

export const NEXT_PKG = JSON.stringify({ dependencies: { next: '14.2.0', '@supabase/supabase-js': '^2' } });
export const VITE_PKG = JSON.stringify({
  dependencies: { '@supabase/supabase-js': '^2' },
  devDependencies: { vite: '^5' },
});
export const TANSTACK_PKG = JSON.stringify({
  dependencies: { '@tanstack/react-start': '^1', '@supabase/supabase-js': '^2' },
});

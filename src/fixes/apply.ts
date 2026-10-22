import fs from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { isGitDirty } from '../core/git.js';
import type { Finding, TextEdit } from '../core/types.js';
import { baseName, isInside, toPosix } from '../utils/fs.js';
import { migrationPath } from './migration-name.js';

export class DirtyTreeError extends Error {
  constructor() {
    super(
      'Refusing to modify files: the git working tree has uncommitted changes. Commit or stash them, or pass --allow-dirty.',
    );
    this.name = 'DirtyTreeError';
  }
}

export interface ApplyOptions {
  root: string;
  unsafe?: boolean;
  dryRun?: boolean;
  allowDirty?: boolean;
  migrationsDir?: string;
}

export interface SkippedFix {
  finding: Finding;
  reason: 'unsafe' | 'overlap' | 'missing-file' | 'outside-root';
}

export interface ApplyResult {
  applied: Finding[];
  skipped: SkippedFix[];
  /** Relative paths written (or that would be written in dry-run). */
  files: string[];
  /** Unified diffs, one per touched file. */
  diffs: string[];
}

interface Range {
  start: number;
  end: number;
  text: string;
}

function overlaps(a: Range, b: Range): boolean {
  if (a.start === b.start && a.end === b.end && a.text === b.text) return false;
  return a.start < b.end && b.start < a.end;
}

function listMigrationNames(abs: string): string[] {
  try {
    return fs.readdirSync(abs, { recursive: true }).map((f) => toPosix(String(f)));
  } catch {
    return [];
  }
}

export function applyFixes(findings: Finding[], opts: ApplyOptions): ApplyResult {
  const root = path.resolve(opts.root);
  const migrationsDir = opts.migrationsDir ?? 'supabase/migrations';
  if (!opts.dryRun && !opts.allowDirty && isGitDirty(root)) throw new DirtyTreeError();

  const result: ApplyResult = { applied: [], skipped: [], files: [], diffs: [] };
  const texts = new Map<string, string>();
  const accepted = new Map<string, Range[]>();
  const sqlSections: { ruleId: string; description: string; content: string }[] = [];
  const otherNewFiles: { file: string; content: string }[] = [];
  const seenSql = new Set<string>();

  const load = (rel: string): string | null => {
    if (texts.has(rel)) return texts.get(rel) as string;
    const abs = path.resolve(root, rel);
    if (!isInside(root, abs)) return null;
    try {
      const t = fs.readFileSync(abs, 'utf8');
      texts.set(rel, t);
      return t;
    } catch {
      return null;
    }
  };

  for (const finding of findings) {
    const fix = finding.fix;
    if (!fix) continue;
    if (!fix.safe && !opts.unsafe) {
      result.skipped.push({ finding, reason: 'unsafe' });
      continue;
    }
    let reason: SkippedFix['reason'] | null = null;
    for (const e of fix.edits) {
      if (!isInside(root, path.resolve(root, e.file))) reason = 'outside-root';
      else if (load(e.file) === null) reason = 'missing-file';
      if (reason) break;
    }
    if (!reason) {
      const pending = new Map<string, Range[]>();
      for (const e of fix.edits) {
        const range: Range = { start: e.start, end: e.end, text: e.text };
        const existing = [...(accepted.get(e.file) ?? []), ...(pending.get(e.file) ?? [])];
        if (existing.some((r) => overlaps(r, range))) {
          reason = 'overlap';
          break;
        }
        pending.set(e.file, [...(pending.get(e.file) ?? []), range]);
      }
      if (!reason) {
        for (const [file, ranges] of pending) {
          const cur = accepted.get(file) ?? [];
          for (const r of ranges) {
            if (!cur.some((c) => c.start === r.start && c.end === r.end && c.text === r.text)) cur.push(r);
          }
          accepted.set(file, cur);
        }
      }
    }
    if (reason) {
      result.skipped.push({ finding, reason });
      continue;
    }
    for (const nf of fix.newFiles ?? []) {
      const rel = toPosix(nf.file);
      if (rel.startsWith(`${migrationsDir}/`) && rel.endsWith('.sql')) {
        const key = nf.content.trim();
        if (!seenSql.has(key)) {
          seenSql.add(key);
          sqlSections.push({ ruleId: finding.ruleId, description: fix.description, content: nf.content });
        }
      } else if (!otherNewFiles.some((o) => o.file === rel))
        otherNewFiles.push({ file: rel, content: nf.content });
    }
    result.applied.push(finding);
  }

  // text edits
  for (const [file, ranges] of accepted) {
    const original = texts.get(file);
    if (original === undefined) continue;
    let updated = original;
    const unique: TextEdit[] = [];
    for (const r of ranges) unique.push({ file, start: r.start, end: r.end, text: r.text });
    unique.sort((a, b) => b.start - a.start);
    for (const e of unique) updated = updated.slice(0, e.start) + e.text + updated.slice(e.end);
    if (updated === original) continue;
    result.files.push(file);
    result.diffs.push(
      createTwoFilesPatch(`a/${file}`, `b/${file}`, original, updated, '', '', { context: 3 }),
    );
    if (!opts.dryRun) fs.writeFileSync(path.resolve(root, file), updated);
  }

  // new files
  if (sqlSections.length > 0) {
    const existing = listMigrationNames(path.resolve(root, migrationsDir)).map((n) => baseName(n));
    const rel = migrationPath(migrationsDir, existing, 'edge_guard_fixes');
    const body = [
      '-- Generated by supabase-edge-guard. Review before applying.',
      '',
      ...sqlSections.map((s) => `-- === ${s.ruleId}: ${s.description} ===\n${s.content.trimEnd()}\n`),
    ].join('\n');
    result.files.push(rel);
    result.diffs.push(createTwoFilesPatch('/dev/null', `b/${rel}`, '', body, '', '', { context: 3 }));
    if (!opts.dryRun) {
      const abs = path.resolve(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
  }
  for (const nf of otherNewFiles) {
    const abs = path.resolve(root, nf.file);
    if (!isInside(root, abs) || fs.existsSync(abs)) continue;
    result.files.push(nf.file);
    result.diffs.push(
      createTwoFilesPatch('/dev/null', `b/${nf.file}`, '', nf.content, '', '', { context: 3 }),
    );
    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, nf.content);
    }
  }
  return result;
}

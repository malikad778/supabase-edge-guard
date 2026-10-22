import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { scan } from '../../src/core/scanner.js';
import { applyFixes, DirtyTreeError } from '../../src/fixes/apply.js';
import { migrationPath, nextMigrationTimestamp } from '../../src/fixes/migration-name.js';
import { cleanupProjects, makeProject, NEXT_PKG, only } from '../helpers.js';

afterAll(cleanupProjects);

const EX = path.resolve(import.meta.dirname, '../../examples/vulnerable-nextjs-app');

function copyExample(): string {
  const root = makeProject({});
  fs.cpSync(EX, root, { recursive: true, filter: (src) => !src.includes('node_modules') });
  return root;
}

describe('applyFixes', () => {
  it('fixing SG005 + SG010 (+SG001/SG004/SG007) removes them on re-scan and leaves the rest', () => {
    const root = copyExample();
    const before = scan({ root, baseline: false });
    const res = applyFixes(before.findings, { root, allowDirty: true });
    expect(res.skipped.every((s) => s.reason === 'unsafe')).toBe(true);
    const after = scan({ root, baseline: false });
    for (const id of ['SG001', 'SG004', 'SG005', 'SG007', 'SG010'])
      expect(only(after.findings, id)).toHaveLength(0);
    expect(after.findings.length).toBeLessThan(before.findings.length);
    // one merged migration, not one per fix
    const added = fs
      .readdirSync(path.join(root, 'supabase/migrations'))
      .filter((f) => f.endsWith('edge_guard_fixes.sql'));
    expect(added).toHaveLength(1);
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations', added[0]!), 'utf8');
    expect(sql).toContain('-- === SG010:');
    expect(sql).toContain('-- === SG004:');
    // the SG001 rewrite is syntactically valid TypeScript-ish and uses getUser
    const mw = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8');
    expect(mw).toContain('auth.getUser()');
    expect(mw).not.toContain('getSession');
  });

  it('unsafe fixes need --unsafe and then clear SG013/SG014', () => {
    const root = copyExample();
    const first = scan({ root, baseline: false });
    applyFixes(first.findings, { root, allowDirty: true });
    const mid = scan({ root, baseline: false });
    expect(only(mid.findings, 'SG013')).toHaveLength(1);
    const res = applyFixes(mid.findings, { root, allowDirty: true, unsafe: true });
    expect(res.applied.map((f) => f.ruleId).sort()).toEqual(['SG013', 'SG014']);
    const after = scan({ root, baseline: false });
    expect(only(after.findings, 'SG013')).toHaveLength(0);
    expect(only(after.findings, 'SG014')).toHaveLength(0);
  });

  it('is idempotent: a second run changes nothing', () => {
    const root = copyExample();
    applyFixes(scan({ root, baseline: false }).findings, { root, allowDirty: true, unsafe: true });
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).length;
    const second = applyFixes(scan({ root, baseline: false }).findings, {
      root,
      allowDirty: true,
      unsafe: true,
    });
    expect(second.applied).toHaveLength(0);
    expect(fs.readdirSync(path.join(root, 'supabase/migrations')).length).toBe(files);
  });

  it('dry-run changes nothing and produces diffs', () => {
    const root = copyExample();
    const snapshot = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8');
    const res = applyFixes(scan({ root, baseline: false }).findings, { root, dryRun: true });
    expect(res.diffs.length).toBeGreaterThan(0);
    expect(res.diffs.join('\n')).toContain('-    data: { session },');
    expect(fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8')).toBe(snapshot);
    expect(fs.readdirSync(path.join(root, 'supabase/migrations'))).toHaveLength(1);
  });

  it('refuses to touch a dirty git tree unless allowed', () => {
    const root = copyExample();
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], {
        cwd: root,
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'x');
    fs.appendFileSync(path.join(root, 'middleware.ts'), '\n// dirty\n');
    const findings = scan({ root, baseline: false }).findings;
    expect(() => applyFixes(findings, { root })).toThrow(DirtyTreeError);
    expect(() => applyFixes(findings, { root, allowDirty: true })).not.toThrow();
  });

  it('skips overlapping edits instead of corrupting the file', () => {
    const root = makeProject({ 'supabase/migrations/1.sql': 'create table t (id int);' });
    const text = 'create table t (id int);';
    const mk = (start: number, end: number, t: string) => ({
      ruleId: 'SGX',
      ruleName: 'x',
      severity: 'warning' as const,
      message: 'm',
      file: 'supabase/migrations/1.sql',
      line: 1,
      column: 1,
      docsUrl: '',
      fix: {
        description: 'd',
        safe: true,
        edits: [{ file: 'supabase/migrations/1.sql', start, end, text: t }],
      },
    });
    const res = applyFixes([mk(0, 6, 'CREATE'), mk(3, 9, 'ATE T')], { root, allowDirty: true });
    expect(res.applied).toHaveLength(1);
    expect(res.skipped.map((s) => s.reason)).toEqual(['overlap']);
    expect(fs.readFileSync(path.join(root, 'supabase/migrations/1.sql'), 'utf8')).toBe(
      `CREATE${text.slice(6)}`,
    );
  });

  it('never writes outside the project root', () => {
    const root = makeProject({});
    const f = {
      ruleId: 'SGX',
      ruleName: 'x',
      severity: 'warning' as const,
      message: 'm',
      file: 'a',
      line: 1,
      column: 1,
      docsUrl: '',
      fix: { description: 'd', safe: true, edits: [{ file: '../evil.txt', start: 0, end: 0, text: 'x' }] },
    };
    const res = applyFixes([f], { root, allowDirty: true });
    expect(res.skipped[0]?.reason).toBe('outside-root');
  });

  it('SG001 fix output is parseable and preserves unrelated code', () => {
    const root = makeProject({
      'package.json': NEXT_PKG,
      'app/a.ts':
        "'use server';\nexport async function f(supabase: any) {\n  const { data: { session } } = await supabase.auth.getSession();\n  if (!session) return null; // keep\n  return session.user.id;\n}\n",
    });
    applyFixes(scan({ root, baseline: false }).findings, { root, allowDirty: true });
    expect(fs.readFileSync(path.join(root, 'app/a.ts'), 'utf8')).toBe(
      "'use server';\nexport async function f(supabase: any) {\n  const { data: { user } } = await supabase.auth.getUser();\n  if (!user) return null; // keep\n  return user.id;\n}\n",
    );
  });
});

describe('migration naming', () => {
  it('is later than every existing migration, even future-dated ones', () => {
    const now = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(nextMigrationTimestamp([], now)).toBe('20260101000000');
    expect(nextMigrationTimestamp(['supabase/migrations/20300101000000_x.sql'], now)).toBe('20300101000001');
    expect(nextMigrationTimestamp(['001_init.sql'], now)).toBe('20260101000000');
    expect(migrationPath('supabase/migrations', [], 'SG010: Enable RLS!', now)).toBe(
      'supabase/migrations/20260101000000_sg010_enable_rls.sql',
    );
  });
});

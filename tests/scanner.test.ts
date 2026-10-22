import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeBaseline } from '../src/core/baseline.js';
import { ConfigError, loadConfig, resolveConfig } from '../src/core/config.js';
import { detectFramework } from '../src/core/framework-detect.js';
import { computeScore, gradeFor } from '../src/core/score.js';
import { scan } from '../src/core/scanner.js';
import { isGitIgnored } from '../src/config-files/env-files.js';
import { toPosix } from '../src/utils/fs.js';
import { cleanupProjects, makeProject, NEXT_PKG, only, scanFiles, VITE_PKG } from './helpers.js';

afterAll(cleanupProjects);

const BAD_SQL = 'create table public.t (id int);\n';

describe('suppressions', () => {
  it('suppresses with a reason (SQL --, TS //, block comments)', () => {
    const sql = scanFiles({
      'supabase/migrations/1.sql':
        '-- edge-guard-disable-next-line SG010 -- internal lookup table\ncreate table public.t (id int);',
    });
    expect(only(sql.findings, 'SG010')).toHaveLength(0);
    expect(sql.stats.suppressed).toBe(1);

    const ts = scanFiles({
      'package.json': NEXT_PKG,
      'app/a.ts':
        "'use server';\nexport async function f(s: any) {\n  // edge-guard-disable-next-line SG001 -- reading locale only\n  return s.auth.getSession();\n}\nexport async function g(s: any) {\n  /* edge-guard-disable-next-line SG001 -- block form */\n  return s.auth.getSession();\n}",
    });
    expect(only(ts.findings, 'SG001')).toHaveLength(0);
  });

  it('ignores suppressions without a reason and reports SG000', () => {
    const r = scanFiles({
      'supabase/migrations/1.sql': '-- edge-guard-disable-next-line SG010\ncreate table public.t (id int);',
    });
    expect(only(r.findings, 'SG010')).toHaveLength(1);
    expect(only(r.findings, 'SG000')[0]).toMatchObject({
      ruleName: 'SuppressionWithoutReason',
      severity: 'info',
      line: 1,
    });
  });

  it('supports file-level suppression and only suppresses the named rules', () => {
    const r = scanFiles({
      'supabase/migrations/1.sql': `-- edge-guard-disable-file SG010 -- sandbox\n${BAD_SQL}create view public.v as select 1;\ncreate table public.u (id int);`,
    });
    expect(only(r.findings, 'SG010')).toHaveLength(0);
  });

  it('applies only to the next line', () => {
    const r = scanFiles({
      'supabase/migrations/1.sql': `-- edge-guard-disable-next-line SG010 -- why\n\n${BAD_SQL}`,
    });
    expect(only(r.findings, 'SG010')).toHaveLength(1);
  });
});

describe('baseline', () => {
  it('hides baselined findings regardless of line shifts, shows new ones', () => {
    const root = makeProject({ 'supabase/migrations/1.sql': BAD_SQL });
    const first = scan({ root, baseline: false });
    writeBaseline(path.join(root, '.edge-guard-baseline.json'), first.findings);
    expect(scan({ root }).findings).toHaveLength(0);
    fs.writeFileSync(
      path.join(root, 'supabase/migrations/1.sql'),
      `-- shifted\n\n${BAD_SQL}create table public.new_one (id int);\n`,
    );
    const after = scan({ root });
    expect(after.findings.map((f) => f.message)).toEqual([expect.stringContaining('public.new_one')]);
    expect(after.stats.baselined).toBe(1);
    expect(scan({ root, baseline: false }).findings).toHaveLength(2);
  });

  it('rejects a corrupt baseline with a clear error', () => {
    const root = makeProject({ '.edge-guard-baseline.json': '{nope' });
    expect(() => scan({ root })).toThrow(/not valid JSON/);
  });
});

describe('config', () => {
  it('rules can be turned off or re-levelled', () => {
    const off = scanFiles({
      'supabase/migrations/1.sql': BAD_SQL,
      'supabase-edge-guard.config.json': '{"rules":{"SG010":"off"}}',
    });
    expect(only(off.findings, 'SG010')).toHaveLength(0);
    const lvl = scanFiles({
      'supabase/migrations/1.sql': BAD_SQL,
      'supabase-edge-guard.config.json': '{"rules":{"sg010":"info"}}',
    });
    expect(only(lvl.findings, 'SG010')[0]?.severity).toBe('info');
  });

  it('supports custom migration dirs and package.json#edgeGuard', () => {
    const r = scanFiles({
      'db/m/1.sql': BAD_SQL,
      'package.json': JSON.stringify({ edgeGuard: { migrationsDir: 'db/m' } }),
    });
    expect(only(r.findings, 'SG010')).toHaveLength(1);
  });

  it('validates configuration and warns on unknown keys', () => {
    expect(() => resolveConfig({ failOn: 'loud' }, 'x.json')).toThrow(ConfigError);
    expect(resolveConfig({ bogus: 1 }, 'x.json').warnings[0]).toContain('bogus');
    const root = makeProject({ 'supabase-edge-guard.config.json': '{ not json' });
    expect(() => loadConfig(root)).toThrow(/not valid JSON/);
  });

  it('--rules / ignoreRules filter rule execution', () => {
    const files = {
      'supabase/migrations/1.sql': `${BAD_SQL}alter table public.t enable row level security;`,
    };
    expect(scanFiles(files, { rules: ['SG011'] }).findings.map((f) => f.ruleId)).toEqual(['SG011']);
    expect(scanFiles(files, { ignoreRules: ['SG011'] }).findings).toHaveLength(0);
  });
});

describe('framework detection, score, paths', () => {
  it('detects frameworks', () => {
    expect(detectFramework(makeProject({ 'package.json': NEXT_PKG, 'app/page.tsx': '' }))).toBe('next-app');
    expect(detectFramework(makeProject({ 'package.json': NEXT_PKG, 'pages/index.tsx': '' }))).toBe(
      'next-pages',
    );
    expect(detectFramework(makeProject({ 'package.json': VITE_PKG }))).toBe('lovable-vite');
    expect(
      detectFramework(makeProject({ 'package.json': '{"dependencies":{"@tanstack/react-start":"1"}}' })),
    ).toBe('tanstack-start');
    expect(detectFramework(makeProject({}))).toBe('generic');
  });

  it('computes score and grade', () => {
    expect(gradeFor(100)).toBe('A');
    expect(gradeFor(85)).toBe('B');
    expect(gradeFor(75)).toBe('C');
    expect(gradeFor(60)).toBe('D');
    expect(gradeFor(10)).toBe('F');
    const mk = (severity: 'error' | 'warning' | 'info') => ({ severity }) as never;
    expect(computeScore([mk('error'), mk('warning'), mk('info')]).score).toBe(86);
    expect(computeScore(Array.from({ length: 20 }, () => mk('error'))).score).toBe(0);
  });

  it('normalises Windows paths and handles CRLF sources', () => {
    expect(toPosix('supabase\\migrations\\1.sql')).toBe('supabase/migrations/1.sql');
    const r = scanFiles({
      'supabase/migrations/1.sql': 'create table a (id int);\r\ncreate table b (id int);\r\n',
    });
    expect(only(r.findings, 'SG010').map((f) => f.line)).toEqual([1, 2]);
    expect(only(r.findings, 'SG010')[0]?.snippet).toBe('create table a (id int);');
  });

  it('gitignore matcher handles globs, anchors, directories and negation', () => {
    expect(isGitIgnored('.env*\n', '.env.local')).toBe(true);
    expect(isGitIgnored('/.env\n', '.env')).toBe(true);
    expect(isGitIgnored('*.local\n', '.env.local')).toBe(true);
    expect(isGitIgnored('.env*\n!.env.local\n', '.env.local')).toBe(false);
    expect(isGitIgnored('# .env\n', '.env')).toBe(false);
    expect(isGitIgnored(null, '.env')).toBe(false);
  });

  it('survives unparsable TS and reports SG000', () => {
    const r = scanFiles({
      'package.json': NEXT_PKG,
      'app/a.ts': "'use server';\nexport function ((( { supabase",
    });
    expect(only(r.findings, 'SG000').some((f) => f.ruleName === 'ParseError')).toBe(true);
  });

  it('is deterministic', () => {
    const files = { 'supabase/migrations/1.sql': `${BAD_SQL}create table public.u (id int);` };
    const root = makeProject(files);
    const normalize = (findings: ReturnType<typeof scan>['findings']) =>
      findings.map((f) => ({
        ...f,
        fix: f.fix
          ? {
              ...f.fix,
              newFiles: f.fix.newFiles?.map((nf) => ({
                ...nf,
                file: nf.file.replace(/\d{14}/, '<TIMESTAMP>'),
              })),
            }
          : undefined,
      }));
    const run1 = normalize(scan({ root, baseline: false }).findings);
    const run2 = normalize(scan({ root, baseline: false }).findings);
    expect(run1).toEqual(run2);
  });
});

describe('--changed-only', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd, stdio: 'ignore' },
    );

  it('limits findings to changed and untracked files', () => {
    const root = makeProject({ 'supabase/migrations/1.sql': 'create table public.a (id int);' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    expect(scan({ root, baseline: false, changedOnly: true }).findings).toHaveLength(0);
    fs.writeFileSync(path.join(root, 'supabase/migrations/2.sql'), 'create table public.b (id int);');
    const r = scan({ root, baseline: false, changedOnly: true });
    expect(r.findings.map((f) => f.file)).toEqual(['supabase/migrations/2.sql']);
    expect(scan({ root, baseline: false }).findings).toHaveLength(2);
  });

  it('warns and reports everything outside a git repo', () => {
    const root = makeProject({ 'supabase/migrations/1.sql': BAD_SQL });
    const r = scan({ root, baseline: false, changedOnly: true });
    expect(r.findings).toHaveLength(1);
    expect(r.warnings.join(' ')).toContain('not a git repository');
  });
});

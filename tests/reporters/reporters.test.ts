import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ScanResult } from '../../src/core/scanner.js';
import { scan } from '../../src/core/scanner.js';
import { getReporter, REPORT_FORMATS } from '../../src/reporters/index.js';
import { cleanupProjects, scanFiles } from '../helpers.js';
import { validate } from './mini-schema.js';

afterAll(cleanupProjects);

const EXAMPLE = path.resolve(import.meta.dirname, '../../examples/vulnerable-nextjs-app');
const render = (format: (typeof REPORT_FORMATS)[number], r: ScanResult, color = false) =>
  getReporter(format)(r, { color });

describe('reporters', () => {
  const example = scan({ root: EXAMPLE, baseline: false });
  const clean = scanFiles({
    'supabase/migrations/1.sql':
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t using (user_id = (select auth.uid()));',
  });

  it('SARIF output validates against the official SARIF 2.1.0 schema', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, 'sarif-schema-2.1.0.json'), 'utf8'),
    ) as Record<string, never>;
    for (const result of [example, clean]) {
      const sarif = JSON.parse(render('sarif', result)) as {
        runs: { results: unknown[]; tool: { driver: { rules: { id: string }[] } } }[];
      };
      expect(validate(schema, schema, sarif)).toEqual([]);
      expect(sarif.runs[0]?.results).toHaveLength(result.findings.length);
    }
    const sarif = JSON.parse(render('sarif', example)) as {
      runs: {
        results: { ruleId: string; ruleIndex: number }[];
        tool: { driver: { rules: { id: string }[] } };
      }[];
    };
    const run = sarif.runs[0]!;
    for (const res of run.results) expect(run.tool.driver.rules[res.ruleIndex]?.id).toBe(res.ruleId);
  });

  it('the validator actually rejects invalid SARIF', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, 'sarif-schema-2.1.0.json'), 'utf8'),
    ) as Record<string, never>;
    expect(validate(schema, schema, { version: '2.1.0', runs: 'nope' }).length).toBeGreaterThan(0);
    expect(validate(schema, schema, { version: '9.9', runs: [] }).length).toBeGreaterThan(0);
  });

  it('JSON output is parseable and complete', () => {
    const j = JSON.parse(render('json', example)) as {
      score: number;
      findings: unknown[];
      summary: { errors: number };
    };
    expect(j.findings).toHaveLength(example.findings.length);
    expect(j.summary.errors).toBeGreaterThan(0);
  });

  it('pretty output: SG010 first, colors only when requested', () => {
    const plain = render('pretty', example);
    expect(plain).not.toMatch(/\u001b\[/);
    expect(plain.indexOf('SG010')).toBeLessThan(plain.indexOf('SG001'));
    expect(plain).toContain('Score ');
    expect(plain).toContain('fix available → run with --fix');
    expect(render('pretty', example, true)).toMatch(/\u001b\[/);
    expect(render('pretty', clean)).toContain('No issues found');
  });

  it('GitHub annotations are escaped and well-formed', () => {
    const out = render('github', example).trim().split('\n');
    expect(out).toHaveLength(example.findings.length);
    for (const l of out)
      expect(l).toMatch(/^::(error|warning|notice) file=[^,]+,line=\d+,col=\d+,title=SG\d{3}::/);
    const fake = {
      ...clean,
      findings: [{ ...example.findings[0]!, file: 'a,b:c.ts', message: '100%\nnext' }],
    } as ScanResult;
    expect(render('github', fake)).toContain('file=a%2Cb%3Ac.ts');
    expect(render('github', fake)).toContain('100%25%0Anext');
  });

  it('markdown has the sticky-comment marker, counts and per-rule details', () => {
    const md = render('markdown', example);
    expect(md.startsWith('<!-- supabase-edge-guard -->')).toBe(true);
    expect(md).toContain('<details>');
    expect(md).toContain('SG010');
    expect(render('markdown', clean)).toContain('No issues found');
  });

  it('html is self-contained, escapes content and embeds the prompt', () => {
    const html = render('html', example);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toMatch(/(?:src|href)="https?:\/\/(?!github\.com)/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).toContain('prefers-color-scheme');
    expect(html).toContain('id="prompt"');
    const evil = {
      ...clean,
      findings: [{ ...example.findings[0]!, message: '<script>alert(1)</script>', snippet: '"><img src=x>' }],
    } as ScanResult;
    const out = render('html', evil);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('lovable prompt lists each issue with file, line and exact fix', () => {
    const p = render('lovable-prompt', example);
    expect(p).toContain('[SG010] In supabase/migrations/20240101000000_init.sql');
    expect(p).toContain('alter table public.orders enable row level security');
    expect(p).toContain('[SG001]');
    expect(p).toMatch(/list every file you changed/);
    expect(render('lovable-prompt', clean)).toContain('No security issues');
  });

  it('badge output is shields.io endpoint JSON', () => {
    const b = JSON.parse(render('badge', example)) as Record<string, unknown>;
    expect(b).toMatchObject({ schemaVersion: 1, label: 'edge-guard', color: 'red' });
    expect(String(b.message)).toMatch(/^F \(0\)$/);
  });
});

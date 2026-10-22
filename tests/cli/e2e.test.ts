import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupProjects, makeProject } from '../helpers.js';

afterAll(cleanupProjects);

const ROOT = path.resolve(import.meta.dirname, '../..');
const BIN = path.join(ROOT, 'bin/supabase-edge-guard.js');
const NEXT = path.join(ROOT, 'examples/vulnerable-nextjs-app');
const LOVABLE = path.join(ROOT, 'examples/vulnerable-lovable-app');

function cli(args: string[], cwd = ROOT) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function golden(name: string): string[] {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/golden', `${name}.json`), 'utf8')) as string[];
}

describe('golden example projects', () => {
  for (const [name, dir] of [
    ['vulnerable-nextjs-app', NEXT],
    ['vulnerable-lovable-app', LOVABLE],
  ] as const) {
    it(`${name}: exact finding set via the built CLI`, () => {
      const r = cli([dir, '--format', 'json', '--no-baseline']);
      expect(r.code).toBe(1);
      const parsed = JSON.parse(r.out) as {
        findings: { ruleId: string; severity: string; file: string; line: number }[];
      };
      expect(parsed.findings.map((f) => `${f.ruleId} ${f.severity} ${f.file}:${f.line}`)).toEqual(
        golden(name),
      );
    });
  }

  it('the Next.js example triggers every one of the 18 rules', () => {
    const ids = new Set(golden('vulnerable-nextjs-app').map((l) => l.split(' ')[0]));
    for (let i = 1; i <= 18; i++) expect(ids.has(`SG${String(i).padStart(3, '0')}`)).toBe(true);
  });
});

describe('CLI behaviour', () => {
  it('--version and --help work', () => {
    expect(cli(['--version']).out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const h = cli(['--help']);
    expect(h.code).toBe(0);
    expect(h.out).toContain('list-rules');
  });

  it('exit codes: 0 clean, 1 findings, 2 usage errors; --fail-on controls the threshold', () => {
    const clean = makeProject({
      'supabase/migrations/1.sql':
        'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to authenticated using (id > 0);',
    });
    expect(cli([clean, '--no-baseline']).code).toBe(0);
    expect(cli([NEXT, '--no-baseline']).code).toBe(1);
  });

  it('info-only findings do not fail by default but fail with --fail-on info', () => {
    const p = makeProject({
      'supabase/migrations/1.sql':
        'create table public.t (id int); alter table public.t enable row level security;',
    });
    expect(cli([p]).code).toBe(0);
    expect(cli([p, '--fail-on', 'info']).code).toBe(1);
    expect(cli([p, '--fail-on', 'never']).code).toBe(0);
    const warn = makeProject({
      'supabase/migrations/1.sql':
        'create table public.t (id int references x(id)); alter table public.t enable row level security;',
    });
    expect(cli([warn]).code).toBe(0);
    expect(cli([warn, '--fail-on', 'warning']).code).toBe(1);
  });

  it('bad usage exits 2 with a readable message', () => {
    expect(cli(['/definitely/not/here']).code).toBe(2);
    expect(cli([NEXT, '--format', 'xml']).code).toBe(2);
    expect(cli([NEXT, '--fail-on', 'loud']).code).toBe(2);
    expect(cli([NEXT, '--bogus-flag']).code).toBe(2);
    const bad = makeProject({ 'supabase-edge-guard.config.json': '{ nope' });
    const r = cli([bad]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('not valid JSON');
  });

  it('--output writes the report file', () => {
    const out = path.join(makeProject({}), 'r.sarif');
    const r = cli([NEXT, '-f', 'sarif', '-o', out]);
    expect(r.code).toBe(1);
    expect((JSON.parse(fs.readFileSync(out, 'utf8')) as { version: string }).version).toBe('2.1.0');
  });

  it('--fix applies fixes (exit reflects what remains) and --dry-run changes nothing', () => {
    const root = makeProject({});
    fs.cpSync(LOVABLE, root, { recursive: true, filter: (src) => !src.includes('node_modules') });
    const dry = cli([root, '--fix', '--dry-run']);
    expect(dry.out).toContain('--- a/supabase/functions/send-email/index.ts');
    expect(fs.readdirSync(path.join(root, 'supabase/migrations'))).toHaveLength(1);
    const fixed = cli([root, '--fix', '--allow-dirty', '--no-baseline']);
    expect(fixed.err).toMatch(/Applied \d+ fix\(es\)/);
    expect(fs.readFileSync(path.join(root, 'supabase/functions/send-email/index.ts'), 'utf8')).toContain(
      'auth.getUser()',
    );
    const rescan = JSON.parse(cli([root, '-f', 'json', '--no-baseline']).out) as {
      findings: { ruleId: string }[];
    };
    expect(
      rescan.findings.some((f) => f.ruleId === 'SG005' || f.ruleId === 'SG010' || f.ruleId === 'SG001'),
    ).toBe(false);
  });

  it('explain / list-rules / init / baseline', () => {
    expect(cli(['explain', 'sg010']).out).toContain('TableWithoutRls');
    expect(cli(['explain', 'SG999']).code).toBe(2);
    const rules = JSON.parse(cli(['list-rules', '--json']).out) as { id: string }[];
    expect(rules.map((r) => r.id)).toEqual([
      ...Array.from({ length: 18 }, (_, i) => `SG${String(i + 1).padStart(3, '0')}`),
      'SG000',
    ]);
    const root = makeProject({ '.husky/pre-commit': 'npm test\n' });
    const init = cli(['init', root]);
    expect(init.out).toContain('created  supabase-edge-guard.config.json');
    expect(fs.readFileSync(path.join(root, '.husky/pre-commit'), 'utf8')).toContain('supabase-edge-guard');
    expect(cli(['init', root]).out).toContain('skipped');
    const bl = makeProject({ 'supabase/migrations/1.sql': 'create table public.t (id int);' });
    expect(cli(['baseline', bl]).out).toContain('Wrote 1 finding');
    expect(cli([bl]).code).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('survives a closed pipe', () => {
    const r = spawnSync('sh', ['-c', `node ${BIN} ${NEXT} | head -n 1`], { encoding: 'utf8' });
    expect(r.stderr).not.toContain('EPIPE');
  });
});

describe('MCP server', () => {
  it('speaks JSON-RPC over stdio: initialize, tools/list, tools/call', async () => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: unknown[] = [];
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const l = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (l) lines.push(JSON.parse(l));
      }
    });
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'scan_project', arguments: { path: LOVABLE } },
    });
    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'suggest_fix', arguments: { path: LOVABLE, ruleId: 'SG010' } },
    });
    for (let i = 0; i < 100 && lines.length < 4; i++) await new Promise((r) => setTimeout(r, 100));
    child.kill();
    const byId = new Map(
      (lines as { id: number; result: Record<string, unknown> }[]).map((l) => [l.id, l.result]),
    );
    expect((byId.get(2)?.tools as { name: string }[]).map((t) => t.name).sort()).toEqual([
      'explain_finding',
      'scan_project',
      'suggest_fix',
    ]);
    const scanText = ((byId.get(3)?.content as { text: string }[])[0] as { text: string }).text;
    expect((JSON.parse(scanText) as { findings: unknown[] }).findings).toHaveLength(7);
    expect(((byId.get(4)?.content as { text: string }[])[0] as { text: string }).text).toContain('[SG010]');
  });
});

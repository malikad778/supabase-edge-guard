import fs from 'node:fs';
import path from 'node:path';
import { Command, CommanderError } from 'commander';
import { BaselineError, DEFAULT_BASELINE, writeBaseline } from '../core/baseline.js';
import { ConfigError } from '../core/config.js';
import { scan, type ScanOptions, type ScanResult } from '../core/scanner.js';
import type { Severity } from '../core/types.js';
import { REPO_URL, VERSION } from '../core/version.js';
import { DirtyTreeError, applyFixes } from '../fixes/apply.js';
import { REPORT_FORMATS, getReporter, type ReportFormat } from '../reporters/index.js';
import { allRules, getRuleMeta, sg000Meta } from '../rules/index.js';
import { runInit } from './commands/init.js';

interface ScanCliOptions {
  format: string;
  output?: string;
  fix?: boolean;
  unsafe?: boolean;
  dryRun?: boolean;
  allowDirty?: boolean;
  failOn?: string;
  rules?: string;
  ignoreRules?: string;
  baseline?: string | boolean;
  changedOnly?: boolean;
  base?: string;
  color?: boolean;
  quiet?: boolean;
}

export interface RunIO {
  out: (s: string) => void;
  err: (s: string) => void;
  isTTY: boolean;
}

const defaultIO: RunIO = {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
  isTTY: Boolean(process.stdout.isTTY),
};

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

function csv(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  return v
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s !== '');
}

export function exitCodeFor(result: ScanResult, failOn: string | undefined): number {
  const level = failOn ?? result.config.failOn;
  if (level === 'never') return 0;
  const threshold = SEVERITY_RANK[level as Severity] ?? SEVERITY_RANK.error;
  return result.findings.some((f) => SEVERITY_RANK[f.severity] >= threshold) ? 1 : 0;
}

function buildScanOptions(root: string, o: ScanCliOptions): ScanOptions {
  const opts: ScanOptions = { root };
  const rules = csv(o.rules);
  const ignore = csv(o.ignoreRules);
  if (rules) opts.rules = rules;
  if (ignore) opts.ignoreRules = ignore;
  if (o.baseline === false) opts.baseline = false;
  else if (typeof o.baseline === 'string') opts.baseline = o.baseline;
  if (o.changedOnly) opts.changedOnly = true;
  if (o.base) opts.baseRef = o.base;
  return opts;
}

function resolveRoot(p: string | undefined): string {
  const root = path.resolve(p ?? '.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new ConfigError(`Path not found or not a directory: ${root}`);
  }
  return root;
}

export async function run(argv: string[], io: RunIO = defaultIO): Promise<number> {
  let exitCode = 0;
  const program = new Command();
  program
    .name('supabase-edge-guard')
    .description(
      'Static analyzer for Supabase security mistakes across Next.js, TanStack Start, Lovable and SQL migrations.',
    )
    .version(VERSION, '-v, --version')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });

  program
    .command('scan [path]', { isDefault: true })
    .description('Scan a project (default command)')
    .option('-f, --format <format>', `output format: ${REPORT_FORMATS.join('|')}`, 'pretty')
    .option('-o, --output <file>', 'write the report to a file instead of stdout')
    .option('--fix', 'apply safe automatic fixes')
    .option('--unsafe', 'with --fix, also apply fixes that may change behaviour')
    .option('--dry-run', 'show the diffs --fix would apply, change nothing')
    .option('--allow-dirty', 'allow --fix on a git working tree with uncommitted changes')
    .option('--fail-on <level>', 'exit 1 at this severity or above: error|warning|info|never')
    .option('--rules <ids>', 'only run these rules (comma separated)')
    .option('--ignore-rules <ids>', 'skip these rules (comma separated)')
    .option('--baseline <path>', `baseline file (default ${DEFAULT_BASELINE})`)
    .option('--no-baseline', 'ignore any baseline file')
    .option('--changed-only', 'only report findings in files changed vs git HEAD')
    .option('--base <ref>', 'with --changed-only, also include changes since this git ref')
    .option('--no-color', 'disable colors')
    .option('--quiet', 'less output')
    .action((p: string | undefined, o: ScanCliOptions) => {
      const root = resolveRoot(p);
      if (!REPORT_FORMATS.includes(o.format as ReportFormat)) {
        throw new ConfigError(`Unknown format "${o.format}". Use one of: ${REPORT_FORMATS.join(', ')}`);
      }
      if (o.failOn && !['error', 'warning', 'info', 'never'].includes(o.failOn)) {
        throw new ConfigError(`Invalid --fail-on "${o.failOn}". Use error, warning, info or never.`);
      }
      const scanOpts = buildScanOptions(root, o);
      let result = scan(scanOpts);
      const color = o.color !== false && io.isTTY && !process.env.NO_COLOR && !o.output;
      const fmt = o.format as ReportFormat;

      if (o.fix || o.dryRun) {
        const applied = applyFixes(result.findings, {
          root,
          unsafe: Boolean(o.unsafe),
          dryRun: Boolean(o.dryRun),
          allowDirty: Boolean(o.allowDirty),
          migrationsDir: result.config.migrationsDir,
        });
        if (o.dryRun) {
          const diffText = applied.diffs.join('\n');
          (fmt === 'pretty' ? io.out : io.err)(
            diffText === '' ? 'No automatic fixes available.\n' : `${diffText}\n`,
          );
          io.err(
            `Dry run: ${applied.applied.length} fix(es) would be applied, ${applied.skipped.length} skipped.\n`,
          );
        } else {
          const before = result.findings.length;
          result = scan(scanOpts);
          const fixed = Math.max(0, before - result.findings.length);
          const unsafeSkipped = applied.skipped.filter((s) => s.reason === 'unsafe').length;
          io.err(
            `Applied ${applied.applied.length} fix(es) to ${applied.files.length} file(s): fixed ${fixed} / remaining ${result.findings.length}.` +
              (unsafeSkipped > 0 ? ` ${unsafeSkipped} more need --unsafe.` : '') +
              '\n',
          );
          for (const f of applied.files) io.err(`  wrote ${f}\n`);
        }
      }

      const text = getReporter(fmt)(result, { color, quiet: Boolean(o.quiet) });
      if (o.output) {
        fs.mkdirSync(path.dirname(path.resolve(o.output)), { recursive: true });
        fs.writeFileSync(path.resolve(o.output), text);
        io.err(`Report written to ${o.output}\n`);
      } else io.out(text);
      exitCode = exitCodeFor(result, o.failOn);
    });

  program
    .command('init [path]')
    .description('Create a config file, a GitHub workflow and (if present) a husky pre-commit hook')
    .option('--force', 'overwrite existing files')
    .action((p: string | undefined, o: { force?: boolean }) => {
      const root = resolveRoot(p);
      const res = runInit(root, Boolean(o.force));
      for (const f of res.created) io.out(`created  ${f}\n`);
      for (const f of res.updated) io.out(`updated  ${f}\n`);
      for (const f of res.skipped) io.out(`skipped  ${f} (already exists; use --force to overwrite)\n`);
    });

  program
    .command('explain <rule>')
    .description('Explain a rule: what it catches, why it matters, bad/good examples')
    .action((id: string) => {
      const m = getRuleMeta(id);
      if (!m) {
        io.err(`Unknown rule "${id}". Run "supabase-edge-guard list-rules".\n`);
        exitCode = 2;
        return;
      }
      io.out(
        [
          `${m.id} ${m.name}  [${m.severity}] [${m.layer}] fix: ${m.fixable}`,
          '',
          m.summary,
          '',
          m.incident,
          '',
          'Bad:',
          ...m.badExample.split('\n').map((l) => `  ${l}`),
          '',
          'Good:',
          ...m.goodExample.split('\n').map((l) => `  ${l}`),
          '',
          ...m.references.map((r) => `Reference: ${r}`),
          `Docs: ${REPO_URL}/blob/main/docs/rules/${m.id}.md`,
          '',
        ].join('\n'),
      );
    });

  program
    .command('list-rules')
    .description('List all rules')
    .option('--json', 'output JSON')
    .action((o: { json?: boolean }) => {
      const metas = [...allRules.map((r) => r.meta), sg000Meta];
      if (o.json) io.out(`${JSON.stringify(metas, null, 2)}\n`);
      else
        for (const m of metas)
          io.out(`${m.id}  ${m.severity.padEnd(7)} ${m.layer.padEnd(6)} ${m.name} - ${m.summary}\n`);
    });

  program
    .command('baseline [path]')
    .description('Record current findings in a baseline file so only new findings are reported')
    .option('--output <file>', 'baseline file path', DEFAULT_BASELINE)
    .action((p: string | undefined, o: { output: string }) => {
      const root = resolveRoot(p);
      const result = scan({ root, baseline: false });
      const target = path.resolve(root, o.output);
      const n = writeBaseline(target, result.findings);
      io.out(`Wrote ${n} finding(s) to ${path.relative(process.cwd(), target) || target}\n`);
    });

  program
    .command('mcp')
    .description('Start the MCP server on stdio (tools: scan_project, explain_finding, suggest_fix)')
    .action(async () => {
      const { startMcpServer } = await import('../mcp/server.js');
      await startMcpServer();
      // keep the process alive; the stdio transport owns the event loop
      await new Promise<void>(() => undefined);
    });

  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode === 0 ? 0 : 2;
    }
    if (err instanceof ConfigError || err instanceof BaselineError || err instanceof DirtyTreeError) {
      io.err(`error: ${err.message}\n`);
      return 2;
    }
    io.err(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return 2;
  }
  return exitCode;
}

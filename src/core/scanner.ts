import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseEnvFile, type EnvFile } from '../config-files/env-files.js';
import { TomlParseError, parseSupabaseConfig, type SupabaseConfig } from '../config-files/toml.js';
import { allRules } from '../rules/index.js';
import { buildSchemaIndex } from '../sql/schema-index.js';
import { buildTsIndex } from '../ts/project.js';
import { createLineMap, type LineMap } from '../utils/line-map.js';
import { readText } from '../utils/fs.js';
import { applyBaseline, DEFAULT_BASELINE, readBaseline } from './baseline.js';
import { defaultConfig, loadConfig, type ResolvedConfig } from './config.js';
import { discoverFiles } from './file-discovery.js';
import { detectFramework } from './framework-detect.js';
import { changedFiles } from './git.js';
import { computeScore, type Grade } from './score.js';
import { applySuppressions } from './suppressions.js';
import type { Finding, Framework, ProjectContext, ReportInput, Rule } from './types.js';
import { DOCS_BASE } from './version.js';

export interface ScanOptions {
  root: string;
  /** Only run these rule ids. */
  rules?: string[];
  ignoreRules?: string[];
  /** Path to a baseline file; `false` disables baseline; undefined = default file if present. */
  baseline?: string | false;
  changedOnly?: boolean;
  baseRef?: string;
  /** Pre-resolved config (skips loading from disk). */
  config?: ResolvedConfig;
  /** Override rule set (tests). */
  ruleList?: Rule[];
}

export interface ScanStats {
  tsFiles: number;
  parsedTsFiles: number;
  migrations: number;
  durationMs: number;
  rulesRun: number;
  suppressed: number;
  baselined: number;
}

export interface ScanResult {
  root: string;
  framework: Framework;
  findings: Finding[];
  score: number;
  grade: Grade;
  stats: ScanStats;
  config: ResolvedConfig;
  /** Findings after suppression/baseline/changed-only filtering is already applied to `findings`. */
  warnings: string[];
}

function sg000(name: string, message: string, file: string, line = 1, column = 1): Finding {
  return {
    ruleId: 'SG000',
    ruleName: name,
    severity: 'info',
    message,
    file,
    line,
    column,
    docsUrl: `${DOCS_BASE}/SG000.md`,
  };
}

export function scan(options: ScanOptions): ScanResult {
  const started = performance.now();
  const root = path.resolve(options.root);
  const config = options.config ?? loadConfig(root);
  const warnings = [...config.warnings];

  const discovered = discoverFiles(root, config);
  const framework = detectFramework(root);

  const sqlFiles: { file: string; text: string }[] = [];
  for (const f of discovered.sqlFiles) {
    const text = readText(path.join(root, f));
    if (text !== null) sqlFiles.push({ file: f, text });
  }
  const sql = buildSchemaIndex(sqlFiles);
  const ts = buildTsIndex(discovered.tsFiles, { root, framework, functionsDir: config.functionsDir });

  const extraFindings: Finding[] = [];
  for (const pe of ts.parseErrors) {
    extraFindings.push(
      sg000('ParseError', `Could not fully parse file: ${pe.message}`, pe.file, pe.line, pe.column),
    );
  }

  let supabaseConfig: SupabaseConfig | null = null;
  if (discovered.tomlFile) {
    const raw = readText(path.join(root, discovered.tomlFile)) ?? '';
    try {
      supabaseConfig = parseSupabaseConfig(discovered.tomlFile, raw);
    } catch (err) {
      if (err instanceof TomlParseError) {
        extraFindings.push(
          sg000(
            'ParseError',
            `Invalid TOML in ${discovered.tomlFile}: ${err.message}`,
            discovered.tomlFile,
            err.line,
          ),
        );
      } else throw err;
    }
  }

  const envFiles: EnvFile[] = [];
  for (const f of discovered.envFiles) {
    const text = readText(path.join(root, f));
    if (text !== null) envFiles.push(parseEnvFile(f, text));
  }

  // text lookup for snippets
  const allTexts = new Map<string, string>(ts.texts);
  for (const f of sqlFiles) allTexts.set(f.file, f.text);
  for (const e of envFiles) allTexts.set(e.file, e.text);
  if (supabaseConfig) allTexts.set(supabaseConfig.file, supabaseConfig.raw);
  const lineMaps = new Map<string, LineMap>();
  const snippetFor = (file: string, line: number): string | undefined => {
    const text = allTexts.get(file);
    if (text === undefined) return undefined;
    let lm = lineMaps.get(file);
    if (!lm) {
      lm = createLineMap(text);
      lineMaps.set(file, lm);
    }
    const s = lm.lineText(line).trim();
    return s === '' ? undefined : s.length > 240 ? `${s.slice(0, 237)}...` : s;
  };

  const only = options.rules ? new Set(options.rules.map((r) => r.toUpperCase())) : null;
  const ignore = new Set((options.ignoreRules ?? []).map((r) => r.toUpperCase()));
  const candidateRules = options.ruleList ?? allRules;
  const enabled = candidateRules.filter((r) => {
    if (only && !only.has(r.meta.id)) return false;
    if (ignore.has(r.meta.id)) return false;
    if (config.rules[r.meta.id] === 'off') return false;
    if (r.meta.frameworks && !r.meta.frameworks.includes(framework)) return false;
    return true;
  });

  const findings: Finding[] = [...extraFindings];
  for (const rule of enabled) {
    const override = config.rules[rule.meta.id];
    const ctx: ProjectContext = {
      root,
      config,
      framework,
      ts,
      sql,
      supabaseConfig,
      envFiles,
      gitignore: discovered.gitignore,
      report(f: ReportInput): Finding {
        const { severity, ...rest } = f;
        const sev = override && override !== 'off' ? override : (severity ?? rule.meta.severity);
        const snippet = rest.snippet ?? snippetFor(rest.file, rest.line);
        const out: Finding = {
          ...rest,
          ruleName: rule.meta.name,
          severity: sev,
          docsUrl: `${DOCS_BASE}/${rule.meta.id}.md`,
        };
        if (snippet !== undefined) out.snippet = snippet;
        return out;
      },
    };
    try {
      findings.push(...rule.check(ctx));
    } catch (err) {
      findings.push(
        sg000(
          'InternalError',
          `Rule ${rule.meta.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          '.',
          1,
        ),
      );
    }
  }

  // suppressions
  const sup = applySuppressions(findings, allTexts);
  let result = [...sup.kept, ...sup.extra];
  let baselined = 0;

  // baseline
  if (options.baseline !== false) {
    const baselinePath = path.resolve(root, options.baseline ?? DEFAULT_BASELINE);
    const entries = readBaseline(baselinePath);
    if (entries) {
      const b = applyBaseline(result, entries);
      result = b.kept;
      baselined = b.baselined.length;
    }
  }

  // changed-only
  if (options.changedOnly) {
    const changed = changedFiles(root, options.baseRef ?? process.env.GITHUB_BASE_REF_REMOTE);
    if (changed) result = result.filter((f) => changed.has(f.file));
    else warnings.push('--changed-only: not a git repository, reporting all findings.');
  }

  result.sort((a, b) =>
    a.file < b.file
      ? -1
      : a.file > b.file
        ? 1
        : a.line - b.line || a.column - b.column || (a.ruleId < b.ruleId ? -1 : 1),
  );

  const s = computeScore(result);
  return {
    root,
    framework,
    findings: result,
    score: s.score,
    grade: s.grade,
    config,
    warnings,
    stats: {
      tsFiles: discovered.tsFiles.length,
      parsedTsFiles: ts.files.length,
      migrations: sqlFiles.length,
      durationMs: Math.round(performance.now() - started),
      rulesRun: enabled.length,
      suppressed: sup.suppressed.length,
      baselined,
    },
  };
}

export { defaultConfig };

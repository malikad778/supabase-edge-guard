export { scan } from './core/scanner.js';
export type { ScanOptions, ScanResult, ScanStats } from './core/scanner.js';
export { applyFixes, DirtyTreeError } from './fixes/apply.js';
export type { ApplyOptions, ApplyResult } from './fixes/apply.js';
export { allRules, getRule, getRuleMeta } from './rules/index.js';
export { getReporter, REPORT_FORMATS } from './reporters/index.js';
export type { ReportFormat, ReportOptions } from './reporters/index.js';
export { loadConfig, resolveConfig, defaultConfig } from './core/config.js';
export type { ResolvedConfig } from './core/config.js';
export { computeScore } from './core/score.js';
export type {
  Finding,
  Fix,
  TextEdit,
  NewFile,
  Rule,
  RuleMeta,
  Severity,
  Boundary,
  Framework,
  ProjectContext,
} from './core/types.js';
export { VERSION } from './core/version.js';

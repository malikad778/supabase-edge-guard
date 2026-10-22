import type { ScanResult } from '../core/scanner.js';
import type { RuleMeta } from '../core/types.js';

export interface ReportOptions {
  color?: boolean;
  quiet?: boolean;
  rules?: RuleMeta[];
}

export type Reporter = (result: ScanResult, opts: ReportOptions) => string;

export type ReportFormat =
  'pretty' | 'json' | 'sarif' | 'github' | 'markdown' | 'html' | 'lovable-prompt' | 'badge';

export const REPORT_FORMATS: ReportFormat[] = [
  'pretty',
  'json',
  'sarif',
  'github',
  'markdown',
  'html',
  'lovable-prompt',
  'badge',
];

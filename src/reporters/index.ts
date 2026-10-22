import { badgeReporter } from './badge.js';
import { githubReporter } from './github.js';
import { htmlReporter } from './html.js';
import { jsonReporter } from './json.js';
import { lovablePromptReporter } from './lovable-prompt.js';
import { markdownReporter } from './markdown.js';
import { prettyReporter } from './pretty.js';
import { sarifReporter } from './sarif.js';
import type { ReportFormat, Reporter } from './types.js';

export type { ReportFormat, ReportOptions, Reporter } from './types.js';
export { REPORT_FORMATS } from './types.js';

const reporters: Record<ReportFormat, Reporter> = {
  pretty: prettyReporter,
  json: jsonReporter,
  sarif: sarifReporter,
  github: githubReporter,
  markdown: markdownReporter,
  html: htmlReporter,
  'lovable-prompt': lovablePromptReporter,
  badge: badgeReporter,
};

export function getReporter(format: ReportFormat): Reporter {
  return reporters[format];
}

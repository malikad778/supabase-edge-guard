import { computeScore } from '../core/score.js';
import { VERSION } from '../core/version.js';
import type { Reporter } from './types.js';

export const jsonReporter: Reporter = (result) => {
  const s = computeScore(result.findings);
  return `${JSON.stringify(
    {
      tool: { name: 'supabase-edge-guard', version: VERSION },
      framework: result.framework,
      score: result.score,
      grade: result.grade,
      summary: { errors: s.errors, warnings: s.warnings, infos: s.infos },
      stats: result.stats,
      findings: result.findings,
    },
    null,
    2,
  )}\n`;
};

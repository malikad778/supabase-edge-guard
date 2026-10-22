import type { Reporter } from './types.js';

const COLORS: Record<string, string> = { A: 'brightgreen', B: 'green', C: 'yellow', D: 'orange', F: 'red' };

export const badgeReporter: Reporter = (result) =>
  `${JSON.stringify(
    {
      schemaVersion: 1,
      label: 'edge-guard',
      message: `${result.grade} (${result.score})`,
      color: COLORS[result.grade] ?? 'lightgrey',
    },
    null,
    2,
  )}\n`;

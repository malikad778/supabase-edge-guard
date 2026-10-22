import type { Finding } from './types.js';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScoreResult {
  score: number;
  grade: Grade;
  errors: number;
  warnings: number;
  infos: number;
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export function computeScore(findings: Finding[]): ScoreResult {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const f of findings) {
    if (f.severity === 'error') errors++;
    else if (f.severity === 'warning') warnings++;
    else infos++;
  }
  const score = Math.max(0, 100 - 10 * errors - 3 * warnings - infos);
  return { score, grade: gradeFor(score), errors, warnings, infos };
}

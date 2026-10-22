import { fingerprint } from '../core/baseline.js';
import type { Finding, RuleMeta, Severity } from '../core/types.js';
import { REPO_URL, VERSION } from '../core/version.js';
import { allRules, sg000Meta } from '../rules/index.js';
import type { Reporter } from './types.js';

function level(s: Severity): 'error' | 'warning' | 'note' {
  return s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'note';
}

function location(file: string, line: number, column: number, finding?: Finding): Record<string, unknown> {
  const region: Record<string, unknown> = { startLine: Math.max(1, line), startColumn: Math.max(1, column) };
  if (finding?.endLine !== undefined) region.endLine = finding.endLine;
  if (finding?.endColumn !== undefined) region.endColumn = finding.endColumn;
  if (finding?.snippet !== undefined) region.snippet = { text: finding.snippet };
  return {
    physicalLocation: {
      artifactLocation: { uri: file, uriBaseId: '%SRCROOT%' },
      region,
    },
  };
}

export const sarifReporter: Reporter = (result, opts) => {
  const metas: RuleMeta[] = opts.rules ?? [...allRules.map((r) => r.meta), sg000Meta];
  const ruleIndex = new Map(metas.map((m, i) => [m.id, i]));
  const rules = metas.map((m) => ({
    id: m.id,
    name: m.name,
    shortDescription: { text: m.summary },
    fullDescription: { text: m.incident },
    helpUri: `${REPO_URL}/blob/main/docs/rules/${m.id}.md`,
    help: { text: `${m.incident}\n\nBad:\n${m.badExample}\n\nGood:\n${m.goodExample}` },
    defaultConfiguration: { level: level(m.severity) },
    properties: { tags: ['security', m.layer], precision: 'medium' },
  }));

  const results = result.findings.map((f) => {
    const r: Record<string, unknown> = {
      ruleId: f.ruleId,
      level: level(f.severity),
      message: { text: f.message },
      locations: [location(f.file, f.line, f.column, f)],
      partialFingerprints: { 'edgeGuardFingerprint/v1': fingerprint(f) },
    };
    const idx = ruleIndex.get(f.ruleId);
    if (idx !== undefined) r.ruleIndex = idx;
    if (f.related && f.related.length > 0) {
      r.relatedLocations = f.related.map((rel, i) => ({
        id: i,
        ...location(rel.file, rel.line, 1),
        message: { text: rel.note },
      }));
    }
    return r;
  });

  return `${JSON.stringify(
    {
      $schema:
        'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'supabase-edge-guard',
              version: VERSION,
              semanticVersion: VERSION,
              informationUri: REPO_URL,
              rules,
            },
          },
          columnKind: 'utf16CodeUnits',
          invocations: [{ executionSuccessful: true }],
          results,
        },
      ],
    },
    null,
    2,
  )}\n`;
};

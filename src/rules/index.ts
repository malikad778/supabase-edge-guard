import type { Rule, RuleMeta } from '../core/types.js';
import { sg001 } from './sg001-get-session.js';
import { sg002 } from './sg002-service-role-no-auth.js';
import { sg003 } from './sg003-service-role-client-bundle.js';
import { sg004 } from './sg004-security-definer-rpc.js';
import { sg005 } from './sg005-rls-initplan.js';
import { sg006 } from './sg006-permissive-policy.js';
import { sg007 } from './sg007-unindexed-columns.js';
import { sg008 } from './sg008-storage-policy.js';
import { sg009 } from './sg009-shared-client-session.js';
import { sg010 } from './sg010-table-without-rls.js';
import { sg011 } from './sg011-rls-without-policies.js';
import { sg012 } from './sg012-user-metadata-policy.js';
import { sg013 } from './sg013-definer-search-path.js';
import { sg014 } from './sg014-view-security-invoker.js';
import { sg015 } from './sg015-update-without-check.js';
import { sg016 } from './sg016-verify-jwt-false.js';
import { sg017 } from './sg017-public-env-secret.js';
import { sg018 } from './sg018-llm-no-limits.js';

export const allRules: Rule[] = [
  sg001,
  sg002,
  sg003,
  sg004,
  sg005,
  sg006,
  sg007,
  sg008,
  sg009,
  sg010,
  sg011,
  sg012,
  sg013,
  sg014,
  sg015,
  sg016,
  sg017,
  sg018,
];

export const sg000Meta: RuleMeta = {
  id: 'SG000',
  name: 'ScannerDiagnostics',
  severity: 'info',
  layer: 'config',
  summary:
    'Diagnostics from the scanner itself: unparsable files, suppressions without a reason, internal rule errors.',
  incident:
    'Not a security rule. SG000 reports problems that reduce what the scanner could analyse: a file that failed to parse (ParseError), an edge-guard-disable comment without a reason (SuppressionWithoutReason), or a rule that crashed (InternalError).',
  badExample: '// edge-guard-disable-next-line SG001',
  goodExample:
    '// edge-guard-disable-next-line SG001 -- session only used to read the locale, never for authorization',
  fixable: 'none',
  references: [],
};

export function getRule(id: string): Rule | undefined {
  return allRules.find((r) => r.meta.id === id.toUpperCase());
}

export function getRuleMeta(id: string): RuleMeta | undefined {
  if (id.toUpperCase() === 'SG000') return sg000Meta;
  return getRule(id)?.meta;
}

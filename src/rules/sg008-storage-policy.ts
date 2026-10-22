import type { Finding, PolicyInfo, ProjectContext, Rule } from '../core/types.js';
import { maskExprLiterals } from '../sql/sql-utils.js';
import { enclosingBoundary } from '../ts/boundary.js';

const WRITE_CMDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'ALL']);
const OWNER_RE = /storage\s*\.\s*foldername\s*\(|\bowner(?:_id)?\b|auth\s*\.\s*uid\s*\(/i;

function policyText(p: PolicyInfo): string {
  return `${p.using ?? ''} ${p.withCheck ?? ''}`;
}

function mentionsBucket(p: PolicyInfo, bucket: string): boolean {
  const text = policyText(p);
  const esc = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`bucket_id\\s*(?:=\\s*'${esc}'|in\\s*\\([^)]*'${esc}'[^)]*\\))`, 'i').test(text);
}

function storageWritePolicies(ctx: ProjectContext): PolicyInfo[] {
  return ctx.sql.policies.filter(
    (p) => p.schema === 'storage' && p.table === 'objects' && WRITE_CMDS.has(p.command),
  );
}

export const sg008: Rule = {
  meta: {
    id: 'SG008',
    name: 'StorageWriteUnprotected',
    severity: 'error',
    layer: 'cross',
    summary:
      'Storage bucket written from the browser without an owner-scoped storage.objects policy (or public bucket writable by anon).',
    incident:
      "Storage access is governed by RLS policies on storage.objects. A policy that only checks bucket_id lets any authenticated user overwrite or delete anyone's files; " +
      'a public bucket with an anon write policy lets the whole internet upload.',
    badExample:
      'create policy "upload avatars" on storage.objects for insert to authenticated\n  with check (bucket_id = \'avatars\');',
    goodExample:
      'create policy "upload own avatars" on storage.objects for insert to authenticated\n  with check (bucket_id = \'avatars\' and (storage.foldername(name))[1] = (select auth.uid())::text);',
    fixable: 'none',
    references: ['https://supabase.com/docs/guides/storage/security/access-control'],
  },
  check(ctx) {
    const out: Finding[] = [];
    const writePolicies = storageWritePolicies(ctx);

    for (const call of ctx.ts.calls) {
      if (call.kind !== 'storageUpload' || !call.bucket) continue;
      const file = ctx.ts.byPath.get(call.file);
      if (!file) continue;
      if (enclosingBoundary(call.node, file.boundaryInfo) !== 'client') continue;
      if (!['upload', 'update', 'remove'].includes(call.storageOp ?? '')) continue;
      const matching = writePolicies.filter((p) => mentionsBucket(p, call.bucket as string));
      if (matching.length === 0) {
        out.push(
          ctx.report({
            ruleId: 'SG008',
            message: `Browser code writes to storage bucket "${call.bucket}" but no storage.objects INSERT/UPDATE/DELETE policy scopes that bucket to its owner.`,
            file: call.file,
            line: call.line,
            column: call.column,
          }),
        );
      } else if (
        matching.every(
          (p) =>
            !OWNER_RE.test(
              maskExprLiterals(policyText(p)).replace(/storage\s*\.\s*foldername/gi, 'storage.foldername'),
            ) && !OWNER_RE.test(policyText(p)),
        )
      ) {
        const p = matching[0] as PolicyInfo;
        const f = ctx.report({
          ruleId: 'SG008',
          message: `Browser code writes to storage bucket "${call.bucket}" and its policy "${p.name}" has no ownership constraint, so any user can overwrite other users' files.`,
          file: call.file,
          line: call.line,
          column: call.column,
          related: [{ file: p.file, line: p.line, note: `policy "${p.name}" on storage.objects` }],
        });
        out.push(f);
      }
    }

    for (const bucket of ctx.sql.buckets) {
      if (!bucket.public) continue;
      for (const p of writePolicies) {
        if (!mentionsBucket(p, bucket.id)) continue;
        const open = p.roles.length === 0 || p.roles.includes('anon') || p.roles.includes('public');
        if (!open) continue;
        out.push(
          ctx.report({
            ruleId: 'SG008',
            message: `Public bucket "${bucket.id}" has write policy "${p.name}" open to anon/public: anyone on the internet can modify its files.`,
            file: p.file,
            line: p.line,
            column: 1,
            related: [
              { file: bucket.file, line: bucket.line, note: `bucket "${bucket.id}" created as public` },
            ],
          }),
        );
      }
    }
    return out;
  },
};

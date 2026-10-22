import { Node, SyntaxKind } from 'ts-morph';
import type { Finding, Rule } from '../core/types.js';
import { lineCol } from '../ts/ast-utils.js';
import { clientChain } from '../ts/import-graph.js';

const ID_RE = /SERVICE_ROLE|serviceRoleKey|SERVICE_KEY/;
const STR_RE = /SERVICE_ROLE/;

export const sg003: Rule = {
  meta: {
    id: 'SG003',
    name: 'ServiceRoleInClientBundle',
    severity: 'error',
    layer: 'cross',
    summary: 'service_role key referenced from code that is bundled for the browser.',
    incident:
      'Anything reachable from a "use client" module (or any module in a Vite SPA) ends up in the public JavaScript bundle. ' +
      'Shipping the service_role key there hands every visitor a credential that bypasses all RLS. Leaked keys of this kind are routinely scraped within hours.',
    badExample:
      "'use client';\nimport { createClient } from '@supabase/supabase-js';\nconst supabase = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);",
    goodExample:
      "'use client';\nconst supabase = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);\n// service_role lives only in server-only modules",
    fixable: 'none',
    references: [
      'https://supabase.com/docs/guides/api/api-keys',
      'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const file of ctx.ts.files) {
      if (!ctx.ts.clientReachable.has(file.path)) continue;
      let hit: Node | undefined;
      for (const n of file.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
        if (!ID_RE.test(n.getText())) continue;
        const parent = n.getParent();
        if (parent && Node.isImportSpecifier(parent)) continue;
        hit = n;
        break;
      }
      if (!hit) {
        for (const n of [
          ...file.sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
          ...file.sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
        ]) {
          if (STR_RE.test(n.getLiteralText())) {
            if (!hit || n.getStart() < hit.getStart()) hit = n;
          }
        }
      }
      if (!hit) continue;
      const chain = clientChain(ctx.ts.clientReach, file.path);
      const { line, column } = lineCol(hit);
      const via =
        chain.length > 1 ? ` (imported by client code via ${chain.join(' → ')})` : ' (client component)';
      const f = ctx.report({
        ruleId: 'SG003',
        message: `The service_role key is referenced in code bundled for the browser${via}; anyone can extract it and bypass all RLS.`,
        file: file.path,
        line,
        column,
      });
      if (chain.length > 1)
        f.related = [
          { file: chain[0] as string, line: 1, note: 'client entry that pulls this module into the bundle' },
        ];
      out.push(f);
    }
    return out;
  },
};

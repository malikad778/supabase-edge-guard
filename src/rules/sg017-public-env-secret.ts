import type { Finding, Rule } from '../core/types.js';
import { isGitIgnored } from '../config-files/env-files.js';
import { createLineMap } from '../utils/line-map.js';

const PUBLIC_PREFIX = /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_)/;
const SECRETISH =
  /(?:SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|STRIPE_SK|(?:OPENAI|ANTHROPIC)[A-Z0-9_]*(?:KEY|TOKEN))/i;
const ENV_REF =
  /(?:process\.env|import\.meta\.env)\s*(?:\.\s*|\[\s*['"])([A-Z][A-Z0-9_]*)|Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g;

export function isPublicSecretName(name: string): boolean {
  return PUBLIC_PREFIX.test(name) && SECRETISH.test(name.replace(PUBLIC_PREFIX, ''));
}

export const sg017: Rule = {
  meta: {
    id: 'SG017',
    name: 'PublicEnvSecretOrUnignoredEnv',
    severity: 'error',
    layer: 'config',
    summary:
      'Secret-looking variable with a public prefix (NEXT_PUBLIC_/VITE_/PUBLIC_), or .env files not git-ignored.',
    incident:
      'Variables prefixed NEXT_PUBLIC_, VITE_ or PUBLIC_ are inlined into the browser bundle by design. Naming a secret that way publishes it. ' +
      'Committing .env / .env.local publishes it through version control instead.',
    badExample: 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...',
    goodExample:
      'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # no public prefix, read only on the server\n# .gitignore\n.env*.local',
    fixable: 'none',
    references: ['https://nextjs.org/docs/app/building-your-application/configuring/environment-variables'],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const env of ctx.envFiles) {
      if (/\.(?:example|sample|template)$/.test(env.file)) continue;
      for (const e of env.entries) {
        if (!isPublicSecretName(e.key)) continue;
        out.push(
          ctx.report({
            ruleId: 'SG017',
            message: `${e.key} has a public prefix, so its value is embedded in the browser bundle; rename it without NEXT_PUBLIC_/VITE_/PUBLIC_ and read it only on the server.`,
            file: env.file,
            line: e.line,
            column: 1,
          }),
        );
      }
    }
    for (const [file, text] of ctx.ts.texts) {
      if (!text.includes('env')) continue;
      const lm = createLineMap(text);
      ENV_REF.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ENV_REF.exec(text))) {
        const name = m[1] ?? m[2] ?? '';
        if (!isPublicSecretName(name)) continue;
        const { line, column } = lm.offsetToLineCol(m.index);
        out.push(
          ctx.report({
            ruleId: 'SG017',
            message: `Code reads ${name}, a secret-looking variable with a public prefix that ships to the browser.`,
            file,
            line,
            column,
          }),
        );
      }
    }
    for (const env of ctx.envFiles) {
      if (env.file !== '.env' && env.file !== '.env.local') continue;
      if (isGitIgnored(ctx.gitignore, env.file)) continue;
      out.push(
        ctx.report({
          ruleId: 'SG017',
          severity: 'warning',
          message: `${env.file} exists but is not covered by .gitignore, so its secrets may be committed.`,
          file: env.file,
          line: 1,
          column: 1,
        }),
      );
    }
    return out;
  },
};

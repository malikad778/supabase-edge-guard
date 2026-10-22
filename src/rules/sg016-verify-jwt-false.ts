import type { Finding, Rule } from '../core/types.js';

const GUARD_RES = [
  /authorization/i,
  /\bgetUser\s*\(/,
  /constructEvent|timingSafeEqual|verifySignature|verifyWebhook|createHmac|\bhmac\b|svix|stripe-signature|x-hub-signature|x-signature/i,
  /headers\.get\(\s*['"][^'"]*(?:secret|token|signature|auth|key)[^'"]*['"]/i,
  /\bjwtVerify\b|\bverifyJwt\b|\bjwt\.verify\b/,
];

export const sg016: Rule = {
  meta: {
    id: 'SG016',
    name: 'EdgeFunctionVerifyJwtDisabled',
    severity: 'warning',
    layer: 'config',
    summary:
      'Edge function has verify_jwt = false and no Authorization / webhook-signature check in its code.',
    incident:
      'verify_jwt = false makes the Supabase gateway skip JWT verification, which is correct for webhooks - but only if the function authenticates the caller itself. ' +
      'Otherwise it is an unauthenticated endpoint, often running with the service_role key.',
    badExample:
      '# supabase/config.toml\n[functions.sync-users]\nverify_jwt = false\n// index.ts never inspects the request headers',
    goodExample:
      "// verify a shared secret or signature before doing any work\nif (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 });",
    fixable: 'none',
    references: ['https://supabase.com/docs/guides/functions/auth'],
  },
  check(ctx) {
    const out: Finding[] = [];
    const cfg = ctx.supabaseConfig;
    if (!cfg) return out;
    const dir = ctx.config.functionsDir;
    for (const fn of Object.values(cfg.functions)) {
      if (fn.verifyJwt !== false) continue;
      const prefix = `${dir}/${fn.name}/`;
      const sources = [...ctx.ts.texts.entries()].filter(([p]) => p.startsWith(prefix));
      if (sources.length === 0) continue;
      const combined = sources.map(([, t]) => t).join('\n');
      if (GUARD_RES.some((re) => re.test(combined))) continue;
      out.push(
        ctx.report({
          ruleId: 'SG016',
          message: `Edge function "${fn.name}" sets verify_jwt = false and its code never checks an Authorization header or webhook signature, so anyone can invoke it.`,
          file: cfg.file,
          line: fn.verifyJwtLine ?? fn.headerLine,
          column: 1,
        }),
      );
    }
    return out;
  },
};

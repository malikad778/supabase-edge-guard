import { Node, SyntaxKind } from 'ts-morph';
import type { Finding, Rule } from '../core/types.js';
import { lineCol } from '../ts/ast-utils.js';
import { enclosingBoundary } from '../ts/boundary.js';

const LLM_FUNCS = new Set(['streamText', 'generateText', 'streamObject', 'generateObject']);
const LLM_CALLEE_RES = [
  /(?:^|\.)chat\.completions\.create$/,
  /(?:^|\.)responses\.create$/,
  /(?:^|\.)(?:anthropic|anthropicClient)\.messages\.(?:create|stream)$/i,
];
const LLM_HOSTS = /api\.openai\.com|api\.anthropic\.com/;

const GUARD_RES = [
  /export\s+(?:const|let|var)\s+maxDuration\b/,
  /export\s+const\s+runtime\s*=\s*['"]edge['"]/,
  /AbortSignal\.timeout\s*\(/,
  /@upstash\/ratelimit/,
  /\bratelimit(?:er)?\b/i,
  /\brateLimit\s*\(/,
  /\bwaitUntil\s*\(/,
  /\blimiter\.limit\s*\(/,
];

export const sg018: Rule = {
  meta: {
    id: 'SG018',
    name: 'LlmCallWithoutLimits',
    severity: 'warning',
    layer: 'ts',
    summary: 'Server-side LLM call with no timeout, max duration or rate limit in the same file.',
    incident:
      'An unauthenticated or unthrottled route that forwards prompts to a paid LLM API is a billing-drain endpoint: one script can burn the monthly budget in minutes, ' +
      'and a hung upstream request can pin serverless functions until they time out.',
    badExample:
      "export async function POST(req: Request) {\n  const { prompt } = await req.json();\n  return streamText({ model: openai('gpt-4o'), prompt }).toDataStreamResponse();\n}",
    goodExample:
      "export const maxDuration = 30;\nexport async function POST(req: Request) {\n  const { success } = await ratelimit.limit(ip);\n  if (!success) return new Response('Too many requests', { status: 429 });\n  ...\n}",
    fixable: 'none',
    references: [
      'https://vercel.com/docs/functions/configuring-functions/duration',
      'https://github.com/upstash/ratelimit-js',
    ],
  },
  check(ctx) {
    const out: Finding[] = [];
    for (const file of ctx.ts.files) {
      if (
        !['server', 'edge', 'middleware'].includes(file.boundary) &&
        file.boundaryInfo.source !== 'createServerFn'
      )
        continue;
      if (GUARD_RES.some((re) => re.test(file.text))) continue;
      for (const call of file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        let isLlm = false;
        if (Node.isIdentifier(callee) && LLM_FUNCS.has(callee.getText())) isLlm = true;
        else if (LLM_CALLEE_RES.some((re) => re.test(callee.getText().replace(/\s+/g, '')))) isLlm = true;
        else if (Node.isIdentifier(callee) && callee.getText() === 'fetch') {
          const a = call.getArguments()[0];
          if (
            a &&
            (Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a)) &&
            LLM_HOSTS.test(a.getLiteralText())
          )
            isLlm = true;
        }
        if (!isLlm) continue;
        if (enclosingBoundary(call, file.boundaryInfo) === 'client') continue;
        const { line, column } = lineCol(call);
        out.push(
          ctx.report({
            ruleId: 'SG018',
            message:
              'Server-side LLM call has no timeout, maxDuration or rate limit in this file, so a single caller can drain your API budget.',
            file: file.path,
            line,
            column,
          }),
        );
        break;
      }
    }
    return out;
  },
};

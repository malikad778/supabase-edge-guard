import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scan } from '../core/scanner.js';
import { VERSION } from '../core/version.js';
import { getRuleMeta } from '../rules/index.js';
import { describeFinding } from '../reporters/lovable-prompt.js';

function text(t: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: t }] };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'supabase-edge-guard', version: VERSION });

  server.registerTool(
    'scan_project',
    {
      description: 'Scan a project directory for Supabase security issues. Returns findings as JSON.',
      inputSchema: { path: z.string().describe('Absolute or relative path to the project root') },
    },
    async ({ path }) => {
      try {
        const r = scan({ root: path });
        return text(
          JSON.stringify(
            { score: r.score, grade: r.grade, framework: r.framework, stats: r.stats, findings: r.findings },
            null,
            2,
          ),
        );
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.registerTool(
    'explain_finding',
    {
      description: 'Explain a rule id (e.g. SG010): what it catches, why it matters, bad and good examples.',
      inputSchema: { ruleId: z.string().describe('Rule id such as SG001') },
    },
    async ({ ruleId }) => {
      const m = getRuleMeta(ruleId);
      if (!m) return { isError: true, content: [{ type: 'text' as const, text: `Unknown rule ${ruleId}` }] };
      return text(
        [
          `${m.id} ${m.name} [${m.severity}]`,
          m.summary,
          '',
          m.incident,
          '',
          'Bad:',
          m.badExample,
          '',
          'Good:',
          m.goodExample,
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'suggest_fix',
    {
      description:
        'Scan a project and return a fix plan for the findings of one rule (or all rules if omitted).',
      inputSchema: {
        path: z.string().describe('Project root'),
        ruleId: z.string().optional().describe('Limit to this rule id'),
      },
    },
    async ({ path, ruleId }) => {
      try {
        const r = scan({ root: path, ...(ruleId ? { rules: [ruleId] } : {}) });
        if (r.findings.length === 0) return text('No findings.');
        return text(r.findings.map((f, i) => describeFinding(f, i + 1)).join('\n\n'));
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

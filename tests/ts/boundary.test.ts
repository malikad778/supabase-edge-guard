import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  classifyBoundary,
  classifyBoundaryText,
  enclosingBoundary,
  leadingDirectives,
} from '../../src/ts/boundary.js';
import {
  buildImportGraph,
  computeClientReachable,
  extractImports,
  parseTsconfigAliases,
  resolveSpecifier,
} from '../../src/ts/import-graph.js';

const sfOf = (path: string, text: string) =>
  new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true }).createSourceFile(`/${path}`, text);

describe('boundary classification', () => {
  const cases: [string, string, string][] = [
    ['supabase/functions/x/index.ts', 'export {}', 'edge'],
    ['middleware.ts', 'export {}', 'middleware'],
    ['src/middleware.ts', 'export {}', 'middleware'],
    ['proxy.ts', 'export {}', 'middleware'],
    ['lib/middleware.ts', 'export {}', 'unknown'],
    ['app/a.tsx', "'use client';\nexport {}", 'client'],
    ['app/a.tsx', '// c\n/* d */\n"use client"\nexport {}', 'client'],
    ['app/actions.ts', "'use server'\nexport {}", 'server'],
    ['app/api/x/route.ts', 'export {}', 'server'],
    ['src/app/api/x/route.ts', 'export {}', 'server'],
    ['pages/api/x.ts', 'export {}', 'server'],
    ['app/page.tsx', 'export default () => null', 'server'],
    ['app/dash/layout.tsx', 'export default () => null', 'server'],
    ['app/components/Button.tsx', 'export {}', 'unknown'],
    ['lib/util.ts', 'export {}', 'unknown'],
    ['src/routes/a.tsx', 'export const f = createServerFn()', 'server'],
  ];
  for (const [p, text, expected] of cases) {
    it(`${p} -> ${expected}`, () => {
      expect(classifyBoundaryText(p, text, 'generic').boundary).toBe(expected);
    });
  }

  it("'use client' beats route paths", () => {
    expect(classifyBoundaryText('app/page.tsx', "'use client'\nexport {}", 'next-app').boundary).toBe(
      'client',
    );
  });

  it('lovable-vite treats src/ as client but not edge functions', () => {
    expect(classifyBoundaryText('src/pages/A.tsx', '', 'lovable-vite').boundary).toBe('client');
    expect(classifyBoundaryText('supabase/functions/a/index.ts', '', 'lovable-vite').boundary).toBe('edge');
  });

  it('classifyBoundary works on source files', () => {
    expect(classifyBoundary(sfOf('app/a.tsx', "'use client'\nexport {}"), 'next-app')).toBe('client');
  });

  it('reads multiple leading directives', () => {
    expect([...leadingDirectives("'use strict';\n'use client';\nimport x from 'y'")].sort()).toEqual([
      'use client',
      'use strict',
    ]);
    expect(leadingDirectives("import x from 'y'\n'use client'").size).toBe(0);
  });

  it('function-level use server and createServerFn handlers are server contexts', () => {
    const text = `
      export function a() { 'use server'; return supa.auth.getSession(); }
      export const b = createServerFn().handler(async () => supa.auth.getSession());
      export function c() { return supa.auth.getSession(); }`;
    const sf = sfOf('src/routes/x.tsx', text);
    const info = classifyBoundaryText('src/routes/x.tsx', text, 'tanstack-start');
    const calls = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((n) => n.getText() === 'supa.auth.getSession()');
    expect(calls.map((c) => enclosingBoundary(c, info))).toEqual(['server', 'server', 'unknown']);
  });
});

describe('import graph', () => {
  it('extracts value imports and skips type-only imports', () => {
    const imports = extractImports(
      `import a from './a'; import type { T } from './t'; export * from './b'; const c = await import('./c'); const d = require('./d');`,
    );
    expect(imports.sort()).toEqual(['./a', './b', './c', './d']);
  });

  it('resolves relative, index, extension-mapped and alias specifiers', () => {
    const files = new Set(['src/a.ts', 'src/lib/index.ts', 'src/b.tsx', 'src/c.ts']);
    const aliases = parseTsconfigAliases(
      '{ /* c */ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], "lib": ["src/lib/index.ts"] }, }, }',
      files,
    );
    expect(resolveSpecifier('src/x.ts', './a', files, aliases)).toBe('src/a.ts');
    expect(resolveSpecifier('src/x.ts', './lib', files, aliases)).toBe('src/lib/index.ts');
    expect(resolveSpecifier('src/x.ts', './c.js', files, aliases)).toBe('src/c.ts');
    expect(resolveSpecifier('src/x.ts', '@/b', files, aliases)).toBe('src/b.tsx');
    expect(resolveSpecifier('src/x.ts', 'lib', files, aliases)).toBe('src/lib/index.ts');
    expect(resolveSpecifier('src/x.ts', 'react', files, aliases)).toBeNull();
  });

  it('client reachability skips server modules and follows cycles', () => {
    const texts = new Map([
      ['app/C.tsx', "'use client';\nimport './a'; import './actions';"],
      ['app/a.ts', "import './b';"],
      ['app/b.ts', "import './a'; export const k = 1;"],
      ['app/actions.ts', "'use server'; import './secret';"],
      ['app/secret.ts', 'export const s = 1;'],
    ]);
    const graph = buildImportGraph(texts, []);
    const boundaries = new Map(
      [...texts].map(([f, t]) => [f, classifyBoundaryText(f, t, 'next-app').boundary] as const),
    );
    const reach = computeClientReachable(graph, boundaries);
    expect([...reach.reachable].sort()).toEqual(['app/C.tsx', 'app/a.ts', 'app/b.ts']);
  });
});

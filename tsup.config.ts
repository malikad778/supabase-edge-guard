import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/main.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  splitting: true,
  sourcemap: false,
  external: ['@modelcontextprotocol/sdk'],
  define: { __SEG_VERSION__: JSON.stringify(pkg.version) },
});

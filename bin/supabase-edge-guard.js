#!/usr/bin/env node
import('../dist/cli/main.js').catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});

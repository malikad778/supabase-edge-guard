import { readFileSync } from 'node:fs';

declare const __SEG_VERSION__: string | undefined;

function readVersion(): string {
  if (typeof __SEG_VERSION__ === 'string') return __SEG_VERSION__;
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const v = (parsed as { version: unknown }).version;
      if (typeof v === 'string') return v;
    }
  } catch {
    /* fall through */
  }
  return '0.0.0-dev';
}

export const VERSION: string = readVersion();
export const REPO_URL = 'https://github.com/malikad778/supabase-edge-guard';
export const DOCS_BASE = `${REPO_URL}/blob/main/docs/rules`;

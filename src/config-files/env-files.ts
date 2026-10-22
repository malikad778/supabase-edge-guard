export interface EnvEntry {
  key: string;
  line: number;
}

export interface EnvFile {
  file: string;
  text: string;
  entries: EnvEntry[];
}

export function parseEnvFile(file: string, text: string): EnvFile {
  const entries: EnvEntry[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
    if (m && m[1]) entries.push({ key: m[1], line: i + 1 });
  });
  return { file, text, entries };
}

function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? '';
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

/**
 * Minimal .gitignore matcher for root-level files: answers whether `relPath` (e.g. '.env.local')
 * is ignored by the given .gitignore text. Later negations win.
 */
export function isGitIgnored(gitignore: string | null, relPath: string): boolean {
  if (gitignore === null) return false;
  let ignored = false;
  for (const rawLine of gitignore.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.startsWith('/') || line.slice(0, -1).includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const re = globToRegex(line);
    const segments = relPath.split('/');
    let matches = false;
    if (anchored) matches = re.test(relPath);
    else matches = segments.some((seg, idx) => re.test(seg) && (!dirOnly || idx < segments.length - 1));
    if (dirOnly && anchored)
      matches = segments.slice(0, -1).some((_, idx) => re.test(segments.slice(0, idx + 1).join('/')));
    if (matches) ignored = !negate;
  }
  return ignored;
}

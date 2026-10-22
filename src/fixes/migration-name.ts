import { baseName } from '../utils/fs.js';

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function formatTimestamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function parseTimestamp(ts: string): Date {
  return new Date(
    Date.UTC(
      Number(ts.slice(0, 4)),
      Number(ts.slice(4, 6)) - 1,
      Number(ts.slice(6, 8)),
      Number(ts.slice(8, 10)),
      Number(ts.slice(10, 12)),
      Number(ts.slice(12, 14)),
    ),
  );
}

/**
 * Timestamp (YYYYMMDDHHMMSS, UTC) for a new migration: now, but always later than every existing
 * 14-digit-prefixed migration so the new file sorts (and therefore applies) last.
 */
export function nextMigrationTimestamp(existingFiles: string[], now: Date = new Date()): string {
  let latest = 0;
  for (const f of existingFiles) {
    const m = /^(\d{14})/.exec(baseName(f));
    if (m?.[1]) latest = Math.max(latest, parseTimestamp(m[1]).getTime());
  }
  const t = Math.max(now.getTime(), latest + 1000);
  return formatTimestamp(new Date(t));
}

export function migrationPath(
  migrationsDir: string,
  existingFiles: string[],
  suffix: string,
  now?: Date,
): string {
  const safe = suffix
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `${migrationsDir}/${nextMigrationTimestamp(existingFiles, now)}_${safe}.sql`;
}

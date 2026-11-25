import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;
const CAST = /(_at|transaction_date|trial_end_date)::text/;
const COMMENT_START = /^\s*(\/\/|\*|\/\*|--)/;
const TEST_FILE = /\.test\.ts$|[\\/]__tests__[\\/]/;

// `trial_end_date::text` is a date column read as a plain date string, not a timestamp.
const EXEMPT_COUNTS: Record<string, number> = {
  'notifications/trial-email-database.ts': 2,
  'scheduled/jobs/saas-metrics-snapshot.ts': 1,
};

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    return entry.name.endsWith('.ts') && !TEST_FILE.test(path) ? [path] : [];
  });
}

function castLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => CAST.test(line) && !COMMENT_START.test(line));
}

describe('timestamp casts in workers/src', () => {
  it('never casts a timestamp column to text, apart from the exempt date columns', () => {
    const offenders: Record<string, number> = {};
    for (const path of listSources(SRC)) {
      const count = castLines(path).length;
      if (count > 0) offenders[relative(SRC, path).split('\\').join('/')] = count;
    }
    expect(offenders).toEqual(EXEMPT_COUNTS);
  });

  it('matches only non-comment cast lines', () => {
    expect(CAST.test('sent_at::text AS "sentAt"')).toBe(true);
    expect(COMMENT_START.test(' * old `sent_at::text` shape')).toBe(true);
    expect(COMMENT_START.test('  sent_at::text AS "sentAt"')).toBe(false);
  });
});

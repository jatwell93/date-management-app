#!/usr/bin/env node
/**
 * Static regression test for the Worker's Cron Trigger configuration (task 3.3a).
 *
 * The scheduled jobs get exactly one hourly tick, `0 * * * *` under
 * `[env.production.triggers]` — dispatch to individual jobs happens in code
 * (`workers/src/scheduled/`), not in more cron expressions.
 *
 * The trigger must stay absent from `[env.development]`: the dev deployment's
 * Hyperdrive binding reuses the production id, so a dev cron would run the jobs
 * against the production database.
 *
 * Dependency-free line-based scanner, matching the style of
 * scripts/verify-observability-config.test.js. A full TOML parser is
 * deliberately avoided: this asserts a handful of literal safety properties and
 * should not acquire a dependency to do it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WRANGLER_PATH = path.join(__dirname, '..', 'workers', 'wrangler.toml');

/**
 * Return the `crons` array literal declared inside a given `[env.<env>.triggers]`
 * table, or undefined when the table (or key) is absent. Reads only up to the
 * next `[...]` table header so a neighbouring env's value is never misattributed.
 */
function readTriggersCrons(contents, envName) {
  const lines = contents.split(/\r?\n/);
  const header = `[env.${envName}.triggers]`;
  let inTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inTable = line === header;
      continue;
    }
    if (!inTable) continue;
    const match = line.match(/^crons\s*=\s*(.+)$/);
    if (match) return match[1];
  }
  return undefined;
}

test('production declares exactly the hourly cron tick', () => {
  const contents = fs.readFileSync(WRANGLER_PATH, 'utf8');
  assert.equal(readTriggersCrons(contents, 'production'), '["0 * * * *"]');
});

test("development declares no cron triggers (its Hyperdrive id is production's)", () => {
  const contents = fs.readFileSync(WRANGLER_PATH, 'utf8');
  assert.equal(readTriggersCrons(contents, 'development'), undefined);
  assert.equal(readTriggersCrons(contents, 'role_check'), undefined);
});

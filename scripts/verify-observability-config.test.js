#!/usr/bin/env node
/**
 * Static regression test for Worker observability configuration (task 1.10).
 *
 * `workers/wrangler.toml` is what `wrangler deploy` pushes, so it — not the
 * dashboard — decides whether Workers Logs stay on. This file previously read:
 *
 *   [observability]
 *   enabled = false          # master switch OFF
 *   [observability.logs]
 *   enabled = true           # but logs claim ON
 *   [observability.traces]
 *   enabled = true           # and traces claim ON
 *
 * Cloudflare does not document which wins when the two disagree, and the live
 * dashboard showed logging enabled — so the file and reality had diverged, and a
 * deploy could have silently turned logging off with nothing to catch it.
 *
 * Dependency-free line-based scanner, matching the style of
 * scripts/verify-workers-deploy-bindings.test.js. A full TOML parser is
 * deliberately avoided: this asserts a handful of literal safety properties and
 * should not acquire a dependency to do it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WRANGLER_PATH = path.join(__dirname, '..', 'workers', 'wrangler.toml');

/**
 * Return the `enabled = <bool>` value declared inside a given TOML table,
 * reading only up to the next table header so a neighbouring section's value is
 * never misattributed. Returns undefined when the table or key is absent.
 */
function readEnabledFlag(contents, tableName) {
  const lines = contents.split(/\r?\n/);
  let inTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line === '') continue;

    if (line.startsWith('[')) {
      inTable = line === `[${tableName}]`;
      continue;
    }
    if (!inTable) continue;

    const match = /^enabled\s*=\s*(true|false)\s*$/.exec(line);
    if (match) return match[1] === 'true';
  }

  return undefined;
}

const contents = fs.readFileSync(WRANGLER_PATH, 'utf8');

test('wrangler.toml declares the observability master switch', () => {
  assert.notEqual(
    readEnabledFlag(contents, 'observability'),
    undefined,
    '[observability] must declare an explicit `enabled` flag',
  );
});

test('the observability master switch is enabled', () => {
  assert.equal(
    readEnabledFlag(contents, 'observability'),
    true,
    '[observability] enabled must be true — wrangler.toml is what deploys, so a false ' +
      'here can silently disable Workers Logs regardless of the dashboard state',
  );
});

test('Workers Logs are enabled', () => {
  assert.equal(readEnabledFlag(contents, 'observability.logs'), true);
});

test('Workers Traces are enabled', () => {
  assert.equal(readEnabledFlag(contents, 'observability.traces'), true);
});

test('the master switch never contradicts the nested observability blocks', () => {
  const master = readEnabledFlag(contents, 'observability');
  for (const table of ['observability.logs', 'observability.traces']) {
    const nested = readEnabledFlag(contents, table);
    if (nested === true) {
      assert.equal(
        master,
        true,
        `[${table}] is enabled while [observability] is not — Cloudflare does not ` +
          'document which wins, so the two must agree rather than relying on precedence',
      );
    }
  }
});

test('readEnabledFlag does not leak a value across a table boundary', () => {
  const sample = ['[observability]', 'enabled = true', '', '[other]', 'enabled = false'].join('\n');
  assert.equal(readEnabledFlag(sample, 'observability'), true);
  assert.equal(readEnabledFlag(sample, 'other'), false);
  assert.equal(readEnabledFlag(sample, 'observability.logs'), undefined);
});

test('readEnabledFlag ignores commented-out declarations', () => {
  const sample = ['[observability]', '# enabled = false', 'enabled = true'].join('\n');
  assert.equal(readEnabledFlag(sample, 'observability'), true);
});

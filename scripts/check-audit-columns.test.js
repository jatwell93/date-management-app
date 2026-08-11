'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTables, splitRow, analyseTables } = require('./check-audit-columns');

/** Build a markdown table with `count` rows, calling `cell(i, col)` per cell. */
function table(headers, count, cell) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (let i = 0; i < count; i += 1) {
    lines.push(`| ${headers.map((_, col) => cell(i, col)).join(' | ')} |`);
  }
  return lines.join('\n');
}

function findingsFor(markdown) {
  const tables = parseTables(markdown);
  assert.equal(tables.length, 1, 'fixture should contain exactly one table');
  return analyseTables(tables, 'fixture.md');
}

const levels = (findings, level) => findings.filter((f) => f.level === level);

test('splitRow honours escaped pipes inside cells', () => {
  assert.deepEqual(splitRow('| a | b \\| c | d |'), ['a', 'b | c', 'd']);
});

test('parseTables skips the separator row and keeps headers', () => {
  const tables = parseTables(table(['A', 'B'], 3, (i, c) => `v${i}${c}`));
  assert.equal(tables[0].headers.length, 2);
  assert.equal(tables[0].rows.length, 3);
});

test('parseTables separates two tables split by prose', () => {
  const md = `${table(['A'], 2, () => 'x')}\n\nsome prose\n\n${table(['B'], 2, () => 'y')}`;
  assert.equal(parseTables(md).length, 2);
});

test('a constant column over the row threshold fails', () => {
  const md = table(['Behaviour', 'Equivalent'], 30, (i, col) =>
    col === 0 ? `behaviour ${i}` : 'none found',
  );
  const fails = levels(findingsFor(md), 'fail');
  assert.equal(fails.length, 1);
  assert.match(fails[0].message, /constant across 30 rows/);
  assert.equal(fails[0].column, 'Equivalent');
});

test('a constant column below the row threshold is ignored', () => {
  const md = table(['Behaviour', 'Equivalent'], 5, (i, col) =>
    col === 0 ? `behaviour ${i}` : 'none found',
  );
  assert.deepEqual(findingsFor(md), []);
});

test('a heavily dominant but non-constant column warns rather than fails', () => {
  const md = table(['Behaviour', 'Equivalent'], 100, (i, col) => {
    if (col === 0) return `behaviour ${i}`;
    return i === 0 ? 'workers/src/a.test.ts:4' : 'none found';
  });
  const findings = findingsFor(md);
  assert.equal(levels(findings, 'fail').length, 0);
  const warns = levels(findings, 'warn');
  assert.equal(warns.length, 1);
  assert.match(warns[0].message, /99\.0% of 100 rows/);
});

test('a healthy distribution produces no findings', () => {
  const md = table(['Behaviour', 'Equivalent'], 40, (i, col) =>
    col === 0 ? `behaviour ${i}` : `workers/src/f${i % 8}.test.ts:${i}`,
  );
  assert.deepEqual(findingsFor(md), []);
});

test('cells admitting the value was never determined fail', () => {
  const md = table(['Behaviour', 'Equivalent'], 30, (i, col) => {
    if (col === 0) return `behaviour ${i}`;
    return i < 10 ? 'unknown - not yet searched' : `workers/src/f${i}.test.ts:1`;
  });
  const fails = levels(findingsFor(md), 'fail');
  assert.equal(fails.length, 1);
  assert.match(fails[0].message, /10 cell\(s\) admit the value was never determined/);
});

// The real Wave B defect: 417 rows recorded no evidence while proposing a
// target that presumes the search came back empty.
test('a decision asserted on a row with no evidence fails', () => {
  const md = table(['Behaviour', 'Existing Worker equivalent?', 'Decision'], 30, (i, col) => {
    if (col === 0) return `behaviour ${i}`;
    if (col === 1) return 'unknown';
    return 'PROPOSED: worker-shaped-rewrite - needs rehoming';
  });
  const fails = levels(findingsFor(md), 'fail');
  const inference = fails.find((f) => /does not follow from its own premise/.test(f.message));
  assert.ok(inference, 'expected an inference finding');
  assert.match(inference.message, /30 of 30 rows/);
});

test('deferring the decision on a row with no evidence is accepted', () => {
  const md = table(['Behaviour', 'Existing Worker equivalent?', 'Decision'], 30, (i, col) => {
    if (col === 0) return `behaviour ${i}`;
    if (col === 1) return 'unknown';
    return 'PROPOSED: unknown - no Worker suite exists for this area yet';
  });
  const findings = findingsFor(md);
  assert.equal(
    findings.filter((f) => /does not follow/.test(f.message)).length,
    0,
    'an explicit unknown decision is honest and must not fail',
  );
});

test('a decision backed by cited evidence is accepted', () => {
  const md = table(['Behaviour', 'Existing Worker equivalent?', 'Decision'], 30, (i, col) => {
    if (col === 0) return `behaviour ${i}`;
    if (col === 1) return `workers/src/f${i % 7}.test.ts:${i} - asserts the same parse`;
    return i % 3 === 0
      ? 'PROPOSED: worker-equivalent-exists - covered upstream'
      : 'PROPOSED: worker-shaped-rewrite - partial coverage only';
  });
  assert.deepEqual(findingsFor(md), []);
});

// Guard against the guard: this check is about distribution, not truth. A
// column of plausible, uniformly wrong values passes, and that is by design —
// documented so nobody mistakes a green run for verified content.
test('a well-distributed column of false values passes (documented blind spot)', () => {
  const md = table(['Behaviour', 'Consumer'], 40, (i, col) =>
    col === 0 ? `behaviour ${i}` : `frontend/src/pages/Fake${i}.tsx:${i}`,
  );
  assert.deepEqual(findingsFor(md), []);
});

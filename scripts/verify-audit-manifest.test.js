'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { tautologicalLines } = require('./verify-audit-manifest');

/** Write `source` to a scratch `.test.ts` and hand the path to `fn`. */
function withSpec(source, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-manifest-'));
  const file = path.join(dir, 'sample.test.ts');
  fs.writeFileSync(file, source);
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a test whose only assertion is expect(true).toBe(true) is flagged', () => {
  withSpec(
    ["it('does a thing', () => {", '  expect(true).toBe(true);', '});', ''].join('\n'),
    (file) => {
      assert.ok(tautologicalLines(file).has(2), 'the assertion line should be flagged');
    },
  );
});

test('the `const expected = true` variant is flagged', () => {
  withSpec(
    [
      "it('does a thing', () => {",
      '  const expected = true;',
      '  expect(expected).toBe(true);',
      '});',
      '',
    ].join('\n'),
    (file) => {
      assert.ok(tautologicalLines(file).has(3));
    },
  );
});

test('a test with a real assertion is not flagged', () => {
  withSpec(
    ["it('does a thing', () => {", '  expect(add(1, 2)).toBe(3);', '});', ''].join('\n'),
    (file) => {
      assert.equal(tautologicalLines(file).size, 0);
    },
  );
});

/**
 * The regression that motivated this test. These placebo blocks carry a prose
 * comment describing the test they stand in for, and that prose contains text
 * like `expect(productsA).toHaveLength(10)`. Counting commented-out assertions
 * as real ones makes a pure-placebo block look mixed, so it escapes the check —
 * which is how the first test in `multi-tenant-isolation.test.ts` slipped past
 * the first version of this function.
 */
test('assertions inside comments do not rescue a placebo block', () => {
  withSpec(
    [
      "it('claims to test isolation', () => {",
      '  /**',
      '   * SCENARIO:',
      '   * - Assert: expect(productsA).toHaveLength(10)',
      '   */',
      '  // and also: expect(productsB).toHaveLength(5)',
      '  const expected = true;',
      '  expect(expected).toBe(true);',
      '});',
      '',
    ].join('\n'),
    (file) => {
      assert.ok(
        tautologicalLines(file).has(8),
        'commented-out assertions must not count toward the real assertion tally',
      );
    },
  );
});

test('a partly-placebo file flags only its placebo block', () => {
  withSpec(
    [
      "it('real one', () => {",
      '  expect(compute()).toBe(42);',
      '});',
      '',
      "it('placebo one', () => {",
      '  expect(true).toBe(true);',
      '});',
      '',
    ].join('\n'),
    (file) => {
      const flagged = tautologicalLines(file);
      assert.ok(!flagged.has(2), 'the real assertion must not be flagged');
      assert.ok(flagged.has(6), 'the placebo assertion must be flagged');
    },
  );
});

test('a test with no assertions at all is not flagged', () => {
  // Nothing to say about it here; an assertion-free test is a different defect,
  // and reporting it as a tautology would misdescribe it.
  withSpec(["it('todo', () => {", '  setup();', '});', ''].join('\n'), (file) => {
    assert.equal(tautologicalLines(file).size, 0);
  });
});

// End-to-end against real repo content, rather than a synthetic fixture: the six
// tests above pin the detector's logic, this one proves it survives contact with
// a genuine file (imports, nested describes, JSDoc, `it.each`).
//
// It used to point at `__tests__/multi-tenant-isolation.test.ts` and assert
// `flagged.has(36)`. That file was the original 8/8 placebo, and chasing it is
// what surfaced the cross-tenant leak fixed in #462 — which then rewrote it into
// a skipped pointer, and the hardcoded line number broke. The lesson is not to
// re-pin a different line: the expectation is now DERIVED from the file, so it
// tracks edits instead of rotting on them.
//
// `handlers/handlers.test.ts` is the replacement subject (20/20 placebo, and
// unchanged by #462). If it is ever legitimately fixed, this test reports that
// as a skip rather than a failure — the fixture-based tests carry the real load.
test('a real Worker placebo file is detected end to end', (t) => {
  const file = path.join('workers', 'src', 'handlers', 'handlers.test.ts');
  if (!fs.existsSync(file)) return t.skip(`${file} not present`);

  // Located independently of the detector. This is not a reimplementation of it:
  // the detector's actual work is stripping comments and deciding whether a whole
  // block is pure placebo, neither of which this line-level scan attempts.
  const placebo = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line, i) => (/^\s*expect\(expected\)\.toBe\(true\);?\s*$/.test(line) ? i + 1 : 0))
    .filter(Boolean);

  if (placebo.length === 0) return t.skip(`${file} no longer contains placebo assertions`);

  const flagged = tautologicalLines(file);
  for (const line of placebo) {
    assert.ok(
      flagged.has(line),
      `line ${line} is \`expect(expected).toBe(true)\` but was not flagged`,
    );
  }
  assert.ok(
    flagged.size >= placebo.length,
    `expected at least ${placebo.length} flagged lines, got ${flagged.size}`,
  );
});

test('a real Worker test file yields no findings', () => {
  const file = path.join('workers', 'src', 'middleware', 'require-role.test.ts');
  if (!fs.existsSync(file)) return;
  assert.equal(tautologicalLines(file).size, 0);
});

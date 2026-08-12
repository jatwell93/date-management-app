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

test('the real Worker placebo file is detected end to end', () => {
  const file = path.join('workers', 'src', '__tests__', 'multi-tenant-isolation.test.ts');
  if (!fs.existsSync(file)) return; // suite is meaningful without the fixture
  const flagged = tautologicalLines(file);
  assert.ok(flagged.has(36), 'line 36 is `expect(expected).toBe(true)` in the first test');
  assert.ok(flagged.size > 100, `expected most of the file to be flagged, got ${flagged.size}`);
});

test('a real Worker test file yields no findings', () => {
  const file = path.join('workers', 'src', 'middleware', 'require-role.test.ts');
  if (!fs.existsSync(file)) return;
  assert.equal(tautologicalLines(file).size, 0);
});

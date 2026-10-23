// The complexity baseline may only shrink. Every entry must still exist, so a
// deleted or renamed file cannot leave a stale exemption behind for whatever
// later takes its path, and the list may not grow past MAX_ENTRIES.
//
// When you fix a file and remove it from eslint.complexity-baseline.js, lower
// MAX_ENTRIES to the new length. Never raise it: fix the new code instead.
// Factory runs cannot edit either file (both are on the no_go baseline in
// scripts/check-no-go.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASELINE = require('../eslint.complexity-baseline.js');
const MAX_ENTRIES = 61;

test('every complexity-baseline entry is an existing file', () => {
  const missing = BASELINE.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, [], 'remove these from eslint.complexity-baseline.js');
});

test('the baseline has no duplicates and is sorted', () => {
  assert.deepEqual(BASELINE, [...new Set(BASELINE)].sort());
});

test('the baseline never grows', () => {
  assert.ok(
    BASELINE.length <= MAX_ENTRIES,
    `baseline has ${BASELINE.length} entries; the limit is ${MAX_ENTRIES}. Fix the new code instead of exempting it.`,
  );
});
